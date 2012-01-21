var upnode = require('../');
var dnode = require('dnode');
var test = require('tap').test;

test('timeout', function (t) {
    t.plan(2);
    
    var port = Math.floor(Math.random() * 5e4 + 1e4);
    var up = upnode.connect(port);
    
    up(10, function (remote) {
        t.ok(!remote);
        
        on();
        up(1000, function (remote) {
            t.ok(remote);
            off();
            up.close();
            t.end();
        });
    });
    
    var server;
    function on () {
        server = dnode({});
        server.use(upnode.server);
        server.listen(port);
    }
    
    function off () {
        server.end();
        server.close();
    }
});
