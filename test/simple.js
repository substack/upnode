var upnode = require('../');
var dnode = require('dnode');
var test = require('tap').test;

test('simple', function (t) {
    t.plan(8);
    
    var port = Math.floor(Math.random() * 5e4 + 1e4);
    var up = upnode.connect(port);
    
    var counts = { up : 0, down : 0, reconnect : 0 };
    up.on('up', function () { counts.up ++ });
    up.on('down', function () { counts.down ++ });
    up.on('reconnect', function () { counts.reconnect ++ });

    var messages = [];
    var iv = setInterval(function () {
        up(function (remote) {
            remote.time(function (t) {
                messages.push(t);
            });
        });
    }, 250);
    
    up.once('reconnect', function () {
        up.once('up', function () {
            up.once('down', function () {
                up.once('up', finish);
                setTimeout(on, 50);
            });
            setTimeout(off, 50);
        });
        setTimeout(on, 50);
    });
    
    function finish () {
        var r0 = messages.slice(0,3).reduce(function (acc, x) {
            if (x > acc.max) acc.max = x;
            if (x < acc.min) acc.min = x;
            return acc;
        }, { min : Infinity, max : -Infinity });
        t.ok(r0.max < Date.now());
        t.ok(r0.max > Date.now() - 5000);
        t.ok(r0.max - r0.min < 10);
        
        t.ok(messages[0] < messages[messages.length-1]);
        t.ok(messages.length > 5);
        
        t.equal(counts.up, 2);
        t.equal(counts.down, 1);
        t.ok(counts.reconnect >= 2);
        
        off();
        up.close();
        clearInterval(iv);
        t.end();
    }
    
    var server;
    function on () {
        server = dnode(function (client, conn) {
            this.time = function (cb) { cb(Date.now()) };
        });
        server.use(upnode.ping);
        server.listen(port);
    }
    
    function off () {
        server.end();
        server.close();
    }
});

test('does not leak on.close listeners', function(t) {
    t.plan(1);
    var port = Math.floor(Math.random() * 5e4 + 1e4);
    var up = upnode.connect(port);
    var count = 0;
    var iterations = 3;
    on();

    up.once('close', function() {
        t.equal(up.listeners('close').length, 0);
        t.end();
    })
    up.on('up', function() {
        iterations--;
        off();
    })

    up.on('down', function() {
        if (iterations === 0) return done();
        on();
    })
    function done () {
        up.close();
    }

    var server;
    function on () {
        setTimeout(function() {
            server = dnode();
            server.use(upnode.ping);
            server.listen(port);
        }, 100)
    }

    function off () {
        setTimeout(function() {
            server.end();
            server.close();
        }, 100)
    }
});
