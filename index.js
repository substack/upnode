var dnode = require('dnode');
var parseArgs = require('dnode/lib/parse_args');
var net = require('net');
var EventEmitter = require('events').EventEmitter;

var serverHandle = require('./lib/server_handle');

var upnode = module.exports = function (cons) {
    var self = {};
    self.connect = function () {
        var args = [].slice.call(arguments);
        var up = createConnectionUp();
        if (!self._ups) self._ups = [];
        self._ups.push(up);
        return connect.apply(null, [ up, cons ].concat(args));
    };
    
    self.writable = true;
    self.readable = true;
    
    var names = Object.keys(EventEmitter.prototype).concat(
        'pipe', 'write', 'end', 'destroy'
    );
    names.forEach(function (name) {
        self[name] = function (buf) {
            var h = self._serverHandle;
            if (!h) h = self._serverHandle = serverHandle(cons);
            return h[name].apply(h, arguments);
        };
    });
    
    self.listen = function () {
        var args = parseArgs(arguments);
        
        var server = net.createServer();
        server._ds = [];
        
        server.on('connection', function (stream) {
            var d = serverHandle(cons);
            d.stream = stream;
            d.pipe(stream).pipe(d);
            
            server._ds.push(d);
            d.once('done', function () {
                var ix = server._ds.indexOf(d);
                if (ix >= 0) server._ds.splice(ix, 1);
            });
        });
        
        if (args.port) {
            server.listen(args.port, args.host, args.block);
        }
        else if (args.path) {
            server.listen(args.path, args.block);
        }
        else throw new Error("no port or path given to .listen()");
        
        if (!self.close) {
            self._servers = [];
            self.close = function () {
                self._closed = true;
                self._servers.forEach(function (s) {
                    if (!s._closed) s.close();
                    s._closed = true;
                });
            };
        }
        self._servers.push(server);
        
        if (!server.end) server.end = function () {
            (self._servers || []).forEach(function (server) {
                (server._ds || []).forEach(function (c) {
                    c.destroy();
                });
            });
        };
        
        self.end = function () {
            if (!self._closed) self.close();
            
            (self._servers || []).forEach(function (server) {
                server.end();
            });
            (self._ups || []).forEach(function (up) {
                up.end();
            });
        };
        
        return server;
    };
    
    return self;
};

function createConnectionUp () {
    var up = function (t, fn) {
        if (typeof t === 'function') {
            fn = t;
            t = 0;
        }
        
        if (up.remote) fn(up.remote, up.conn)
        else if (t) {
            var f = function () {
                clearTimeout(to);
                fn.apply(null, arguments);
            };
            var to = setTimeout(function () {
                var ix = up.queue.indexOf(f);
                if (ix >= 0) up.queue.splice(ix, 1);
                fn();
            }, t);
            up.queue.push(f);
        }
        else up.queue.push(fn)
    };
    up.conn = null;
    up.remote = null;
    up.queue = [];
    
    up.close = function () {
        up.closed = true;
        if (up.conn) up.conn.end();
        up.emit('close');
    };
    var emitter = new EventEmitter;
    Object.keys(EventEmitter.prototype).forEach(function (name) {
        if (typeof emitter[name] === 'function') {
            up[name] = emitter[name].bind(emitter);
        }
        else up[name] = emitter[name];
    });
    
    return up;
}

upnode.connect = function () {
    return upnode({}).connect.apply(null, arguments);
};

upnode.listen = function () {
    return upnode({}).listen.apply(null, arguments);
};

function connect (up, cons) {
    if (up.closed) return;
    
    var opts = parseArgs([].slice.call(arguments, 2));
    var reconnect = (function (args) {
        return function () {
            up.emit('reconnect');
            connect.apply(null, args);
        };
    })(arguments);
    
    var cb = opts.block || function (remote, conn) {
        conn.emit('up', remote);
    };
    
    if (opts.ping === undefined) opts.ping = 10000;
    if (opts.timeout === undefined) opts.timeout = 5000;
    if (opts.reconnect === undefined) opts.reconnect = 1000;
    if (opts.createStream === undefined) {
        opts.createStream = function () {
            return net.connect(opts.port, opts.host);
        }
    }
    
    var client = dnode(function (remote, conn) {
        var res = cons || {};
        if (typeof cons === 'function') {
            res = cons.call(this, remote, conn);
            if (res === undefined) res = this;
        }
        
        if (!res) res = {};
        if (!res.ping) res.ping = function (cb) {
            if (typeof cb === 'function') cb();
        };
        
        return res;
    });
    
    client.once('up', function (r) {
        up.remote = r;
        up.queue.forEach(function (fn) { fn(up.remote, up.conn) });
        up.queue = [];
        up.emit('up', r);
    });
    
    client.on('remote', function (remote) {
        up.conn = client;
        if (opts.ping && typeof remote.ping !== 'function') {
            up.emit('error', new Error(
                'Remote does not implement ping. '
                + 'Add server.use(require(\'upnode\').ping) to the remote.'
            ));
        }
        else if (opts.ping) {
            pinger = setInterval(function () {
                var t0 = Date.now();
                var to = opts.timeout && setTimeout(function () {
                    clearInterval(pinger);
                    up.conn.end();
                    stream.destroy();
                }, opts.timeout);
                
                remote.ping(function () {
                    var elapsed = Date.now() - t0;
                    if (to) clearTimeout(to);
                    up.emit('ping', elapsed);
                });
            }, opts.ping);
        }
    });
    
    var alive = true;
    var onend = function () {
        var isUp = Boolean(up.conn);
        up.conn = null;
        up.remote = null;
        up.stream = null;
        stream.destroy();
        
        if (alive && !up.closed) setTimeout(reconnect, opts.reconnect);
        if (pinger) clearInterval(pinger);
        alive = false;
        if (isUp) up.emit('down');
    };
    var pinger = null;
    
    client.on('remote', function (remote) {
        up.emit('remote', remote, client);
        up.stream = stream;
        cb.call(this, remote, client);
    });
    var stream = opts.createStream();
    client.stream = stream;
    stream.pipe(client).pipe(stream);
    
    stream.on('error', onend);
    stream.on('end', onend);
    stream.on('close', onend);
    
    client.on('error', onend);
    
    return up;
}
