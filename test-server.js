const EventEmitter = require('events');
const net = require('net');
const server = net.createServer();

class BattleshipEmitter extends EventEmitter {}
const b_emit = new BattleshipEmitter();

//Versions supported by server
const versions = [1.0];

//Load battleshipt application configuration
//This specifies the size of the grid, what ships to use, etc.
const config = require("./server-config.json");
const {users, grid_shape, ships_by_id, ships, guess_map} = config;

//load helper functions that help play battleship
const {clone_grid, validate_sunk, validate_win, validate_placement} = require("./server_helpers.js");


//Contains all valid commands for a given state.
//Commands that are not contained in the array for a given state are discarded.
const state_map = {
  "negotiate_version": ["CONNECT", "QUIT"],
  "auth_user": ["USER", "QUIT"],
  "auth_password": ["PASSWORD", "QUIT"],
  "connected": ["JOIN", "CREATE", "QUIT"],
  "waiting": ["GQUIT", "QUIT"],
  "init_game": ["PLACE", "CONFIRM", "GQUIT", "QUIT"],
  "confirm": ["GQUIT", "QUIT"],
  "rematch": ["GQUIT", "QUIT"],
  "play_game": ["GUESS", "GQUIT"],
  "finish_game": ["REMATCH", "GQUIT", "QUIT"]
}

//given a connection, which has a state. make sure command is allowable in state using the state map.
//returns true or false if the command can be executed.
function validate_state(conn_wrapper, command) {
  let current_state = conn_wrapper.state;
  return state_map[current_state] && state_map[current_state].includes(command)
}

function parseMessage(message) {
  let components;

  //process escpaed whitespace, otherwise split message on space.
  if (message.includes(':')) {
    let ind = message.indexOf(':');
    let esc_param = message.slice(ind + 1, message.length);
    let upto_esc = message.slice(0, ind - 1);
    components = upto_esc.split(" ");
    components.push(esc_param);
  } else {
    components = message.split(" ");
  }

  command = components[0];
  params = components.splice(1, components.length - 1);
  return {command: command, params: params}
}

function executeCommand(command, parameters, conn_wrapper) {
  if (commands.includes(command)) {
    b_emit.emit(command, parameters, conn_wrapper)
  } else {
    console.log("COMMAND NOT FOUND");
    conn_wrapper.socket.write("ERR " + command + " :" + command + " is not a valid command");
  }
}

const commands = ['CONNECT', 'QUIT', 'CREATE', 'JOIN', 'PLACE', 'GQUIT', 'CONFIRM', 'REMATCH', "WINNER", "GUESS", "USER", "PASSWORD"];
const states = ['negotiate_version', 'auth_user', 'auth_password', 'connected', 'waiting', 'init_game', 'confirm', 'play_game', 'finish_game', 'rematch'];

let game_instances = {}

server.listen(7999, function() {
  console.log('server listening to %j', server.address());
});

server.on('connection', handleConnection);

function handleConnection(conn) {
  var client_address = conn.remoteAddress + ':' + conn.remotePort;
  conn.on('data', onConnData);
  conn.once('close', onConnClose);
  conn.on('error', onConnError);
  console.log("Client connected: ", client_address);

  let conn_wrapper = {
    socket: conn,
    state: 'negotiate_version',
    username: null,
    game: null,
    grid: clone_grid(grid_shape) //deep clone grid,
  }

  function onConnData(data) {
    console.log('connection data from %s: %j', client_address, data);
    let messages = data.toString('UTF8').trim().split('\n');

    for (let i = 0; i < messages.length; i++) {
      let {command, params} = parseMessage(messages[i]);
      let is_allowable = validate_state(conn_wrapper, command);
      if (is_allowable) {
        executeCommand(command, params, conn_wrapper)
      } else {
        conn_wrapper.socket.write("ERR " + command + " :Current state is not supported for this command")
      }
    }
  }

  function onConnClose() {
    console.log('connection from %s closed', client_address);
  }

  function onConnError(err) {
    console.log('Connection %s error: %s', client_address, err.message);
  }
}

function cleanupInstance(instance_name) {
  //If no clients are in an instance, delete it
  if (game_instances[instance_name].length === 0) {
    console.log("Removing Game Instance: ", instance_name);
    delete game_instances[instance_name]
  }
}

b_emit.on('USER', (params, conn_wrapper) => {
  let username = params[0];
  if (username in users) {
    conn_wrapper.username = username;
    conn_wrapper.state = 'auth_password';
    conn_wrapper.socket.write('OK USER ' + username);
  }
});

b_emit.on('PASSWORD', (params, conn_wrapper) => {
  let password = params[0];
  username = conn_wrapper.username;

  if (password === users[username].password) {
    conn_wrapper.socket.write('OK PASSWORD');
    conn_wrapper.state = 'connected';
  } else {
    conn_wrapper.socket.write('ERR PASSWORD');
  }
});

b_emit.on('GQUIT', function(params, conn_wrapper) {
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
      let player = conn_wrapper.username;

      other_player.socket.write("OPP GQUIT " + player + "\n");
      other_player.state = 'waiting';
    }
  }

  cleanupInstance(instance_name)
});

b_emit.on('CONNECT', (params, conn_wrapper) => {
  let [desired_version] = params;

  //Get all versions upto client requested version and select the highest one.
  let supported_versions = versions.filter(version => version <= desired_version);
  let negotiated_version = Math.max(...supported_versions);

  conn_wrapper.socket.write("OK CONNECT " + negotiated_version);
  conn_wrapper.state = 'auth_user';
});

b_emit.on('PLACE', function(params, conn_wrapper) {
  let [ship_name, loc, orient] = params;
  let instance_name = conn_wrapper.game;
  let grid = conn_wrapper.grid;
  let ship = ships[ship_name]
  let instance = game_instances[instance_name];
  let positions = validate_placement(ships, guess_map, ship_name, loc, orient, conn_wrapper);

  if (!positions) {
    return conn_wrapper.socket.write("ERR PLACE invalid placement");
  }

  //if this ship has been already placed previously,
  //replace indices with 0.
  for (row of grid) {
    let ind = row.indexOf(ship.id);
    if (ind > -1) {
      row[ind] = 0;
    }
  }

  for (position of positions) {
    grid[position[0]][position[1]] = ship.id;
  }

  for (row of grid) {
    console.log(row);
  }

  instance.forEach(function (wrapper) {
    if (wrapper === conn_wrapper) {
      wrapper.socket.write("OK PLACE\n");
    } else {
      let opponent = conn_wrapper.username;
      wrapper.socket.write("OPP PLACE " + opponent);
    }
  });
});

b_emit.on('CONFIRM', function(params, conn_wrapper) {
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
          let opponent = conn_wrapper.username;
          wrapper.socket.write("OPP CONFIRM " + opponent + "\n");
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
    //TODO ERROR
    console.log("Game does not exist");
  }
});

b_emit.on('JOIN', function(params, conn_wrapper) {
  console.log("Server: JOIN");

  if (params.length > 1) {
    //TODO SEND ERROR
    let reason = ":Too many parameters";
    return conn_wrapper.socket.write("ERR JOIN " + reason + "\n");
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
        //var remoteAddress = conn_wrapper.socket.remoteAddress + ':' + conn_wrapper.socket.remotePort;
        let opponent_name = conn_wrapper.username;
        wrapper.socket.write("OPP JOIN " + opponent_name + '\n');
      }
    });

  } else {
    let reason = ":Game \'" + name + "\' does not exist";
    conn_wrapper.socket.write("ERR JOIN " + reason + "\n");
  }
});

b_emit.on('REMATCH', (params, conn_wrapper) => {
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
          let opponent = conn_wrapper.username;
          wrapper.socket.write("OPP REMATCH " + username + "\n");
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

b_emit.on('GUESS', (params, conn_wrapper) => {
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
        player.socket.write("WINNER " + conn_wrapper.username + "\n");
        opponent.socket.write("WINNER " + conn_wrapper.username + "\n");
        player.state = 'finish_game';
        opponent.state = 'finish_game';
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

b_emit.on('CREATE', function(params, conn_wrapper) {
  console.log("Server: Create");
  if (params.length > 1) {
    console.log("Too many parameters");
    return conn_wrapper.socket.write('ERR CREATE :Too many parameters\n')
  }

  name = params[0];

  if (game_instances[name]) {
    let reason = "Game: \'" + name + "\' already exists";
    return conn_wrapper.socket.write("ERR CREATE " + ':'.concat(reason));
  }

  game_instances[name] = [conn_wrapper];
  conn_wrapper.socket.write("OK CREATE " + ':'.concat(name) +'\n');
  conn_wrapper.game = name;
  conn_wrapper.state = 'waiting';
});

b_emit.on('QUIT', function(params, conn_wrapper) {
  conn_wrapper.socket.destroy()
});
