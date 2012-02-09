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
    
    return { connect : connect.bind(null, up, cons) };
};

upnode.ping = function (client, conn) {
    if (!this.ping) this.ping = function (cb) { cb() };
};

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
