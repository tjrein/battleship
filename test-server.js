const EventEmitter = require('events');
const net = require('net');
const server = net.createServer();

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const users = {
  "foo": {'password': 'password'},
  "bar": {'password': 'password'}
}

const grid_shape = [ [0, 0, 0],
                     [0, 0, 0],
                     [0, 0, 0] ]

const ships_by_id = {
  5: 'destroyer'
}

const ships =  {
  'destroyer': {size: 2, id: 5}
}

const guess_map = {
  'a1': [0, 0],
  'b1': [0, 1],
  'c1': [0, 2],
  'a2': [1, 0],
  'b2': [1, 1],
  'c2': [1, 2],
  'a3': [2, 0],
  'b3': [2, 1],
  'c3': [2, 2],
}

function clone_grid(grid) {
  return JSON.parse(JSON.stringify(grid))
}

function validate_sunk(id, grid) {
  for (let i=0; i < grid.length; i++) {
    let row = grid[i];
    if (row.includes(id)) return false;
  }
  return true;
}

function validate_win(grid) {
  for (let i = 0; i < grid.length; i++) {
    let row = grid[i];
    let pass = row.every(position => position === 0 || position === 'x');

    if (!pass) return false;
  }

  return true;
}

function validate_placement(ship_name, location, orientation, conn_wrapper) {
  //TODO MORE VALIDATION

  let ship = ships[ship_name];
  let grid = conn_wrapper.grid;

  let positions = [];
  starting_position = guess_map[location];
  positions.push(starting_position);

  if (!ship) {
    console.log("Not a valid ship!");
    return false
  }

  for (i=0; i < ship.size - 1; i++) {
    let last_entry = positions[positions.length - 1];
    let new_entry = [];
    if (orientation ===  'h') {
      new_entry = [last_entry[0], last_entry[1] + 1];
    }

    if (orientation === 'v') {
      new_entry = [last_entry[0] + 1, last_entry[1]];
    }
    positions.push(new_entry);
  }

  for (position of positions) {
    grid[position[0]][position[1]] = ship.id;
  }

  console.log("grid", grid);
}


const commands = ['QUIT', 'CREATE', 'JOIN', 'PLACE', 'GQUIT', 'CONFIRM', 'REMATCH', "WINNER", "GUESS", "USER", "PASSWORD"];
const states = ['auth_user', 'auth_password', 'set_nick', 'connected', 'waiting', 'init_game', 'confirm', 'play_game'];

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

  let conn_wrapper = {
    socket: conn,
    state: 'auth_user',
    username: null,
    game: null,
    grid: JSON.parse(JSON.stringify(grid_shape)) //deep clone grid,
  }

  function onConnData(data) {
    console.log('connection data from %s: %j', remoteAddress, data);
    messages = data.toString('UTF8').trim().split('\n');

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
    conn.write("OK PLACE" + remoteAddress);
  });
}

function cleanupInstance(instance_name) {
  //If no clients are in an instance, delete it
  if (game_instances[instance_name].length === 0) {
    console.log("Removing Game Instance: ", instance_name);
    delete game_instances[instance_name]
  }
}

myEmitter.on('USER', (params, conn_wrapper) => {
  console.log("SHIT")
  let username = params[0];
  if (username in users) {
    conn_wrapper.username = username;
    conn_wrapper.socket.write('OK USER ' + username);
  }
});

myEmitter.on('PASSWORD', (params, conn_wrapper) => {
  let password = params[0];
  username = conn_wrapper.username;

  if (password === users[username].password) {
    conn_wrapper.socket.write('OK PASSWORD');
  } else {
    conn_wrapper.socket.write('ERR PASSWORD');
  }
});

myEmitter.on('GQUIT', function(params, conn_wrapper) {
  let instance_name = conn_wrapper.game;
  let game_instance = game_instances[instance_name]
  let index = game_instance.indexOf(conn_wrapper)

  if (index > -1) {
    game_instance.splice(index, 1);
    conn_wrapper.socket.write("OK GQUIT " + instance_name);
    conn_wrapper.state = 'connected';
    conn_wrapper.game = null;
    conn_wrapper.grid = JSON.parse(JSON.stringify(grid_shape))

    if (game_instance.length) {
      let other_player = game_instance[0];
      let remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;

      other_player.socket.write("OPP_LEFT " + remoteAddress);
      other_player.state = 'waiting';
    }
  }

  cleanupInstance(instance_name)
});

myEmitter.on('PLACE', function(params, conn_wrapper) {
  let instance_name, ship, loc, orient;
  [ship, loc, orient] = params;
  instance_name = conn_wrapper.game;
  instance = game_instances[instance_name];

  validate_placement(ship, loc, orient, conn_wrapper)

  instance.forEach(function (wrapper) {
    if (wrapper === conn_wrapper) {
      wrapper.socket.write("OK PLACE\n");
    } else {
      var remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;
      wrapper.socket.write("OPP_PLACE " + remoteAddress);
    }
  });
});

myEmitter.on('CONFIRM', function(params, conn_wrapper) {
  let instance_name = conn_wrapper.game;
  let confirm_count = 0;
  let instance = game_instances[instance_name];

  if (instance) {
    //conn_wrapper.socket.write("OK CONFIRM");
    conn_wrapper.state = 'confirm';

    instance.forEach(wrapper => {
      if (wrapper.state === 'confirm') {
        confirm_count += 1;
      }
    });

    if (confirm_count === 1) {
      instance.forEach(wrapper => {
        if (wrapper !== conn_wrapper) {
          var remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;
          wrapper.socket.write("OPP_CONFIRM " + remoteAddress);
        } else {
          conn_wrapper.socket.write("OK CONFIRM")
        }
      });
    }

    if (confirm_count === 2) {
      instance.forEach(function (wrapper) {
        wrapper.state = 'play_game';
        wrapper.socket.write("BEGIN");
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
    conn_wrapper.socket.write("OK JOIN " + name + '\n');
    conn_wrapper.state = 'init_game';
    conn_wrapper.game = name;

    game_instances[name].push(conn_wrapper);

    game_instances[name].forEach(wrapper => {
      wrapper.state = 'init_game';

      //let other player know the game has been joined
      if (wrapper !== conn_wrapper) {
        var remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;
        wrapper.socket.write("OPP_JOINED " + remoteAddress);
      }
    });

  } else {
    console.log("Game does not exist");
    conn_wrapper.socket.write("ERR JOIN");
  }
});

myEmitter.on('REMATCH', (params, conn_wrapper) => {
  let instance_name = conn_wrapper.game;
  let rematch_count = 0;
  let instance = game_instances[instance_name];

  if (instance) {
    //conn_wrapper.socket.write("OK CONFIRM");
    conn_wrapper.state = 'rematch';

    instance.forEach(wrapper => {
      if (wrapper.state === 'rematch') {
        rematch_count += 1;
      }
    });

    if (rematch_count === 1) {
      instance.forEach(wrapper => {
        if (wrapper !== conn_wrapper) {
          var remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;
          wrapper.socket.write("OPP_REMATCH " + remoteAddress);
        } else {
          conn_wrapper.socket.write("OK REMATCH")
        }
      });
    }

    if (rematch_count === 2) {
      instance.forEach(function (wrapper) {
        wrapper.grid = clone_grid(grid_shape);
        wrapper.state = 'init_game';
        wrapper.socket.write("REINIT");
      });
    }
  } else {
    console.log("Game does not exist");
  }
});

myEmitter.on('GUESS', (params, conn_wrapper) => {
  let instance = game_instances[conn_wrapper.game];
  let location = params[0];
  let player = conn_wrapper;
  let opponent = instance.filter(wrapper => wrapper !== conn_wrapper)[0];

  let [y, x] = guess_map[location];

  if (opponent.grid[y][x]) {
    let ship_id = opponent.grid[y][x];
    opponent.grid[y][x] = 'x';

    let ship_is_sunk = validate_sunk(ship_id, opponent.grid);

    if (ship_is_sunk) {
      let win_condition = validate_win(opponent.grid);

      if (win_condition) {
        player.socket.write("WINNER " + "Bill");
        opponent.socket.write("WINNER " + "Bill");
      } else {
        player.socket.write("SUNK " + ships_by_id[ship_id]);
      }

    } else {
      player.socket.write("HIT " + location);
    }

  } else {
    player.socket.write("MISS " + location);
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
  conn_wrapper.socket.write("OK CREATE " + name +'\n');
  conn_wrapper.game = name;
  conn_wrapper.state = 'waiting';
});

myEmitter.on('QUIT', function(params, conn_wrapper) {
  console.log("Server: QUIT");
  conn_wrapper.socket.destroy()
});
