const EventEmitter = require('events');
const net = require('net');
const server = net.createServer();

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const commands = ['QUIT', 'CREATE', 'JOIN', 'PLACE', 'GQUIT', 'CONFIRM', 'REMATCH', "WINNER", "GUESS"];
const states = ['auth_user', 'auth_password', 'connected', 'waiting', 'init_game', 'confirm', 'play_game'];

let current_state = 'connected'
let game_instances = {}

server.listen(9000, function() {
  console.log('server listening to %j', server.address());
});

server.on('connection', handleConnection);

function executeCommand(command, parameters, conn_wrapper) {
  if (commands.includes(command)) {
    myEmitter.emit(command, parameters, conn_wrapper)
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
  conn.on('data', onConnData);
  conn.once('close', onConnClose);
  conn.on('error', onConnError);

  console.log("Client connected: ", remoteAddress);

  let conn_wrapper = {socket: conn, state: 'connected'}

  function onConnData(data) {
    console.log('connection data from %s: %j', remoteAddress, data);
    messages = data.toString('UTF8').trim().split('\n');

    console.log("MESSAGES", messages);

    for (let i = 0; i < messages.length; i++) {
      let {command, params} = parseMessage(messages[i])
      executeCommand(command, params, conn_wrapper)
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
  //If no clients are in an instance, delete it
  if (game_instances[instance_name].length === 0) {
    delete game_instances[instance_name]
  }
}

myEmitter.on('GQUIT', function(params, conn_wrapper) {
  let instance_name;
  [instance_name] = params;

  console.log("game_instances", game_instances)



  game_instance = game_instances[instance_name]
  index = game_instance.indexOf(conn_wrapper)

  if (index > -1) {
    game_instance.splice(index, 1);
    conn_wrapper.state = 'connected';
  }

  cleanupInstance(instance_name)
});

myEmitter.on('PLACE', function(params, conn_wrapper) {
  let instance_name, ship, loc, orient;
  [instance_name, ship, loc, orient] = params;
  instance = game_instances[instance_name];
  //broadcast(instance, [ship, loc, orient], conn)

  instance.forEach(function (wrapper) {
    if (wrapper === conn_wrapper) return;
    var remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;
    wrapper.socket.write("OK " + remoteAddress);
  });
});

myEmitter.on('GUESS', function(params, conn_wrapper) {
  console.log("LETS SEE STATE", conn_wrapper.state);
});

myEmitter.on('CONFIRM', function(params, conn_wrapper) {
  let name;
  let confirm_count = 0;
  [name] = params;
  instance = game_instances[name];

  if (instance) {
    conn_wrapper.socket.write("OK CONFIRM");
    conn_wrapper.state = 'confirm';

    instance.forEach(function (wrapper) {
      if (wrapper.state === 'confirm') {
        confirm_count += 1;
      }
    });

    if (confirm_count === 2) {
      instance.forEach(function (wrapper) {
        wrapper.state = 'play_game';
      });
    }
  } else {
    console.log("Game does not exist");
  }
});

myEmitter.on('JOIN', function(params, conn_wrapper) {
  console.log("Server: JOIN");

  if (params.length > 1) {
    //TODO SEND ERROR
    console.log("Too many parameters");
    conn_wrapper.socket.write("ERR JOIN");
    return
  }

  name = params[0]

  if (game_instances[name]) {
    conn_wrapper.socket.write("OK JOIN");
    conn_wrapper.state = 'init_game';
    game_instances[name].push(conn_wrapper);
    game_instances[name].forEach(function(wrapper) { wrapper.state = 'init_game'; });
  } else {
    console.log("Game does not exist");
    conn_wrapper.socket.write("ERR JOIN");
  }

});

myEmitter.on('CREATE', function(params, conn_wrapper) {
  console.log("Server: Create");
  console.log("Current state", conn_wrapper.state);

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

  game_instances[name] = [conn_wrapper]
  conn_wrapper.socket.write("OK CREATE " + name +'\n')
  conn_wrapper.state = 'waiting';
});

myEmitter.on('QUIT', function(params, conn_wrapper) {
  console.log("Server: QUIT");
  conn_wrapper.socket.destroy()
});
