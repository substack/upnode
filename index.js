var dnode = require('dnode');
var EventEmitter = require('events').EventEmitter;

var upnode = module.exports = function (cons) {
    var self = {};
    self.connect = function () {
        var args = [].slice.call(arguments);
        var up = createConnectionUp();
        return connect.apply(null, [ up, cons ].concat(args));
    };
    
    self.listen = function () {
        var args = [].slice.call(arguments);
        var server = dnode(cons);
        server.use(upnode.ping);
        server.use(function (remote, conn) {
            var iv = setInterval(function () {
                if (typeof remote.ping === 'function') {
                    var to = setTimeout(function () {
                        conn.end();
                    }, 10 * 10000);
                    
                    remote.ping(function () {
                        clearTimeout(to);
                    });
                }
            }, 10 * 1000);
            
            conn.once('end', function () {
                clearInterval(iv);
            });
            conn.once('disconnect', function () { conn.emit('end') });
            conn.once('close', function () { conn.emit('end') });
            conn.once('error', function () { conn.emit('end') })
        });
        server.listen.apply(server, args);
        
        if (!self.close) {
            self._servers = [];
            self.close = function () {
                self._servers.forEach(function (s) { s.close() });
            };
        }
        self._servers.push(server);
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

upnode.ping = function (client, conn) {
    if (!this.ping) this.ping = function (cb) {
        if (typeof cb === 'function') cb()
    };
};

upnode.connect = function () {
    return upnode({}).connect.apply(null, arguments);
};

upnode.listen = function () {
    return upnode({}).listen.apply(null, arguments);
};

function connect (up, cons) {
    if (up.closed) return;
    
    var argv = [].slice.call(arguments, 2).reduce(function (acc, arg) {
        if (typeof arg === 'function') acc.cb = arg
        else if (typeof arg === 'object') {
            Object.keys(arg).forEach(function (key) {
                acc.opts[key] = arg;
            });
            acc.args.push(arg);
        }
        else acc.args.push(arg)
        
        return acc;
    }, { args : [], opts : {} });
    
    var args_ = arguments;
    function reconnect () {
        up.emit('reconnect');
        connect.apply(null, args_);
    }
    
    var cb = argv.cb || function (remote, conn) {
        conn.emit('up', remote);
    };
    
    var opts = {
        ping : argv.opts.ping === undefined
            ? 10000 : argv.opts.ping,
        timeout : argv.opts.timeout === undefined
            ? 5000 : argv.opts.timeout,
        reconnect : argv.opts.reconnect === undefined
            ? 1000 : argv.opts.reconnect,
    };
    
    var client = dnode(function (remote, conn) {
        up.conn = conn;
        
        conn.once('up', function (r) {
            up.remote = r;
            up.queue.forEach(function (fn) { fn(up.remote, up.conn) });
            up.queue = [];
            up.emit('up', r);
        });
        
        conn.on('ready', function () {
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
                        conn.end();
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
    
    var alive = true;
    var onend = function () {
        up.conn = null;
        stream.destroy();
        
        if (alive && !up.closed) setTimeout(reconnect, opts.reconnect);
        if (pinger) clearInterval(pinger);
        alive = false;
    };
    var pinger = null;
    
    client.connect.apply(client, argv.args.concat(function (remote, conn) {
        conn.once('end', function () {
            up.emit('down');
        });
        
        up.conn = conn;
        up.emit('remote', remote);
        
        cb.call(this, remote, conn);
    }));
    
    var stream = client.streams[0];
    stream.on('error', function () {
        if (up.conn) onend()
    });
    stream.on('end', onend);
    stream.on('close', onend);
    
    client.on('error', function () {
        if (up.conn) onend()
    });
    
    return up;
}
