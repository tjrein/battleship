const EventEmitter = require('events');
const utf8 = require('utf8')
var net = require('net');
var server = net.createServer();

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const commands = ['QUIT', 'CREATE', 'JOIN', 'PLACE', 'GQUIT', 'CONFIRM', 'REMATCH', "WINNER"]
const states = ['auth_user', 'auth_password', 'connected', 'waiting', 'init_game']

let current_state = 'connected'
let game_instances = {}

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
  }

  function onConnClose() {
    console.log('connection from %s closed', remoteAddress);
  }

  function onConnError(err) {
    console.log('Connection %s error: %s', remoteAddress, err.message);
  }
}

function broadcast(instance, params, sender) {
  instance.forEach(function (conn) {
    if (conn === sender) return;
    var remoteAddress = sender.remoteAddress + ':' + sender.remotePort;
    conn.write("OK " + remoteAddress);
  });
}

function cleanupInstance(instance_name) {
  if (game_instances[instance_name].length === 0) {
    delete game_instances[instance_name]
  }
}

myEmitter.on('GQUIT', function(params, conn) {
  let instance_name;
  [instance_name] = params;

  game_instance = game_instances[instance_name]

  console.log("LENGTH OF GAME INSTANCE", game_instance.length)

  index = game_instance.indexOf(conn)

  if (index > -1) {
    game_instance.splice(index, 1);
  }

  cleanupInstance(instance_name)

});

myEmitter.on('PLACE', function(params, conn) {
  let instance_name, ship, loc, orient;
  [instance_name, ship, loc, orient] = params;
  instance = game_instances[instance_name]
  broadcast(instance, [ship, loc, orient], conn)
});

myEmitter.on('JOIN', function(params, conn) {
  console.log("Server: JOIN");

  if (params.length > 1) {
    //TODO SEND ERROR
    console.log("Too many parameters");
    return
  }

  name = params[0]

  if (game_instances[name]) {
    game_instances[name].push(conn)
    conn.write("OK JOIN")
  } else {
    console.log("GAME does not exist")
    return
  }

});

myEmitter.on('CREATE', function(params, conn) {
  console.log("Server: CREATE");

  if (params.length > 1) {
    //TODO SEND ERROR
    console.log("Too many parameters");
    return
  }

  name = params[0]

  if (game_instances[name]) {
    console.log("GAME " + name + " already exists");
    return
  }

  game_instances[name] = [conn]
  conn.write("OK CREATE")

});

myEmitter.on('QUIT', function(params, conn) {
  console.log("Server: QUIT");
  conn.destroy()
});
