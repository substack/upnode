var upnode = require('../');
var dnode = require('dnode');
var test = require('tap').test;

test('deprecated ping still works', function (t) {
    var port = Math.floor(Math.random() * 5e4 + 1e4);
    t.plan(1);
    var server = dnode(function (client, conn) {
        this.cat = function (cb) { cb('meow') };
    });
    server.use(upnode.server);
    server.listen(port);

    var up = upnode.connect(port);
    up.once('remote', function(remote) {
        remote.cat(function(says) {
            t.equal('meow', says);
            up.once('up', function() {
                server.end();
                server.close();
                up.close();
                t.end();
            });
            server.once('close', function() {
                server.listen(port);
            });
            server.end();
            server.close();
        })
    })
})
test('deprecated ping still available as \'ping\'', function (t) {
    var port = Math.floor(Math.random() * 5e4 + 1e4);
    t.plan(0);
    var server = dnode();
    server.use(upnode.server);
    server.listen(port);

    var up = upnode.connect(port);
    up.once('remote', function(remote) {
        remote.ping(function(says) {
            server.end();
            server.close();
            up.close();
            t.end();
        })
    })
})
