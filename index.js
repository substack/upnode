var dnode = require('dnode');
var EventEmitter = require('events').EventEmitter;

var upnode = module.exports = function (cons) {
    var up = function (t, fn) {
        if (typeof t === 'function') {
            fn = t;
            t = 0;
        }
        
        if (up.conn) fn(up.remote, up.conn)
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
        up.emit('close');
    };
    
    var emitter = new EventEmitter;
    Object.keys(EventEmitter.prototype).forEach(function (name) {
        if (typeof emitter[name] === 'function') {
            up[name] = emitter[name].bind(emitter);
        }
        else up[name] = emitter[name];
    });
    
    return { connect : connect.bind(null, up, cons) };
};

upnode.server = function (client, conn) {
    this.upnode = this.upnode || {}
    if (!this.upnode.ping) this.upnode.ping = function (cb) { cb() };
    if (!this.ping) {
      this.ping = function(cb) {
          console.warn("DEPRECATED: Connecting dnode trying to use remote.ping method. " +
                      "Upgrade to latest upnode and use upnode.server")
          return this.upnode.ping(cb)
      }
    }
};

upnode.ping = function(client, conn) {
    console.warn("DEPRECATED: upnode.ping Please use upnode.server.")
    return upnode.server(client, conn)
}


upnode.connect = function () {
    return upnode({}).connect.apply(null, arguments);
};

function connect (up, cons) {
    if (up.closed) return;
    
    var argv = [].slice.call(arguments, 1).reduce(function (acc, arg) {
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
        
        up.on('close', function () {
            conn.end();
        });
        
        conn.once('up', function (r) {
            up.remote = r;
            up.queue.forEach(function (fn) { fn(up.remote, up.conn) });
            up.queue = [];
            up.emit('up', r);
        });
        
        conn.on('ready', function () {
            // remote.ping == support older dnode by using remote.ping 
            // in absence of remote.upnode
            var doPing = remote.upnode ? remote.upnode.ping : remote.ping
            if (opts.ping && doPing && typeof doPing !== 'function') {
                up.emit('error', new Error(
                    'Remote does not implement upnode.ping. '
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
                    
                    doPing(function () {
                        var elapsed = Date.now() - t0;
                        if (to) clearTimeout(to);
                        up.emit('ping', elapsed);
                    });
                }, opts.ping);
            }
        });
        
        if (typeof cons === 'function') {
            return cons.call(this, remote, conn);
        }
        else return cons || {};
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
