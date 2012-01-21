var upnode = require('../');
var dnode = require('dnode');
var test = require('tap').test;

test('authenticate state', function (t) {
    var port = Math.floor(Math.random() * 5e4 + 1e4);
    
    var up = upnode.connect(port, function (remote, conn) {
        remote.auth('moo', 'hax', function (err, res) {
            if (err) console.error(err)
            else conn.emit('up', res)
        });
    });
    
    var times = 10;
    var iv = setInterval(function () {
        up(function (remote) {
            remote.beep(function (s) {
                times --;
                if (times === 5) {
                    server.end();
                    server.close();
                    connect();
                }
                else if (times === 0) {
                    up.close();
                    server.end();
                    server.close();
                    clearInterval(iv);
                    t.end();
                }
            });
        });
    }, 200);
    
    var server = null;
    function connect () {
        server = dnode(function (client, conn) {
            this.auth = function (user, pass, cb) {
                if (user === 'moo' && pass === 'hax') {
                    cb(null, {
                        beep : function (fn) { fn(new Date().toString()) }
                    });
                }
                else cb('ACCESS DENIED')
            };
        });
        server.use(upnode.server);
        server.listen(port);
    }
    connect();
});
