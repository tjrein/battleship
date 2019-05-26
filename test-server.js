const EventEmitter = require('events');
const utf8 = require('utf8')
var net = require('net');
var server = net.createServer();

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const commands = ['QUIT']
const states = ['auth_user', 'auth_password', 'connected', 'waiting', 'init_game']

let current_state = 'connected'
let game_instances = []

server.listen(9000, function() {
  console.log('server listening to %j', server.address());
});

server.on('connection', handleConnection);

function executeCommand(command, parameters, conn) {
  if (commands.includes(command)) {
    myEmitter.emit(command, parameters, conn)
  } else {
    console.log("COMMAND NOT FOUND")
  }
}

function parseMessage(message) {
  components = message.split(' ')
  command = components[0]
  params = components.splice(1, components.length - 1)

  return {command: command, params: params}
}

function handleConnection(conn) {
  var remoteAddress = conn.remoteAddress + ':' + conn.remotePort;
  console.log('new client connection from %s', remoteAddress);

  conn.on('data', onConnData);
  conn.once('close', onConnClose);
  conn.on('error', onConnError);

  function onConnData(data) {
    console.log('connection data from %s: %j', remoteAddress, data);
    messages = data.toString('UTF8').trim().split('\n')

    for (let i = 0; i < messages.length; i++) {
      let {command, params} = parseMessage(messages[i])
      executeCommand(command, params, conn)
    }

    //conn.write(data);
  }
  function onConnClose() {
    console.log('connection from %s closed', remoteAddress);
  }
  function onConnError(err) {
    console.log('Connection %s error: %s', remoteAddress, err.message);
  }
}

myEmitter.on('QUIT', function(params, conn) {
  console.log("Server: Quit")
  conn.destroy()
});
