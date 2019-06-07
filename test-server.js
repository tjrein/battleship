const EventEmitter = require('events');
const net = require('net');
const server = net.createServer();

class BattleshipEmitter extends EventEmitter {}
const b_emit = new BattleshipEmitter();

//Versions supported by server
const versions = [1.0];

//Load battleshipt application configuration
//This specifies the size of the grid, what ships to use, etc.
const {users, grid_shape, ships_by_id, ships, guess_map} = require("./server-config.json");

//load helper functions that help play battleship
const {clone_grid, validate_sunk, validate_win, validate_placement, convert_position} = require("./server_helpers.js");

//Load state validation
const {validate_message_with_state} = require('./state.js');


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

//object to store game instances
let game_instances = {}

//SERVICE
//bind server to port 7999
server.listen(7999, function() {
  console.log('server listening to %j', server.address());
});

//CONCURRENT
//bind event listenters to sockets as they connect.
//wraps sockets in an object with additional protocol information.
server.on('connection', conn => {
  var client_address = conn.remoteAddress + ':' + conn.remotePort;
  conn.setEncoding('utf8');
  conn.on('data', onConnData);
  conn.once('close', onConnClose);
  conn.on('error', onConnError);
  console.log("Client connected: ", client_address);

  //wrap socket with useful information
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

    //STATEFUL
    for (let i = 0; i < messages.length; i++) {
      //let {command, params} = parseMessage(messages[i]);
      let valid_message = validate_message_with_state(messages[i], conn_wrapper.state, state_map);
      if (valid_message) {
        let [command, params] = valid_message;
        b_emit.emit(command, params, conn_wrapper);
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
});

function cleanupInstance(instance_name) {
  //If no clients are in an instance, delete it
  if (game_instances[instance_name].wrappers.length === 0) {
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
  } else {
    console.log("Not a valid username");
    conn_wrapper.socket.write('ERR USER :Not a registered user');
  }
});

b_emit.on('PASSWORD', (params, conn_wrapper) => {
  let password = params[0];
  username = conn_wrapper.username;

  if (password === users[username].password) {
    conn_wrapper.socket.write('OK PASSWORD');
    conn_wrapper.state = 'connected';
  } else {
    conn_wrapper.socket.write('ERR PASSWORD :Incorrect password');
  }
});

b_emit.on('GQUIT', function(params, conn_wrapper) {
  let instance_name = conn_wrapper.game;
  let game_instance = game_instances[instance_name]
  let index = game_instance.wrappers.indexOf(conn_wrapper)

  if (index > -1) {
    game_instance.wrappers.splice(index, 1);
    conn_wrapper.socket.write("OK GQUIT " + instance_name);
    conn_wrapper.state = 'connected';
    conn_wrapper.game = null;
    conn_wrapper.grid = clone_grid(grid_shape);

    if (game_instance.wrappers.length) {
      let other_player = game_instance.wrappers[0];
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
    return conn_wrapper.socket.write("ERR PLACE :invalid placement");
  }

  //if this ship has been already placed previously,
  //replace indices with 0.
  for (row of grid) {
    let ind = row.indexOf(ship.id);
    if (ind > -1) {
      row[ind] = 0;
    }
  }

  //place piece on grid according to positions, represented by id
  //populate arrayw ith human readble grid positions
  let converted_positions = [];
  for (position of positions) {
    grid[position[0]][position[1]] = ship.id;
    converted_positions.push(convert_position(guess_map, position));
  }

  //format converted_positions into a messaage parameter
  let place_parameter = ':'.concat(converted_positions.join(' '));

  instance.wrappers.forEach(function (wrapper) {
    if (wrapper === conn_wrapper) {
      wrapper.socket.write("OK PLACE " + ship_name + ' ' + place_parameter + "\n");
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
    conn_wrapper.state = 'confirm';

    instance.wrappers.forEach(wrapper => {
      if (wrapper.state === 'confirm') {
        confirm_count += 1;
      }
    });

    if (confirm_count === 1) {
      instance.wrappers.forEach(wrapper => {
        if (wrapper !== conn_wrapper) {
          let opponent = conn_wrapper.username;
          wrapper.socket.write("OPP CONFIRM " + opponent + "\n");
        } else {
          conn_wrapper.socket.write("OK CONFIRM")
        }
      });
    }

    if (confirm_count === 2) {
      let rand_ind = Math.round(Math.random());
      let goes_first = instance.wrappers[rand_ind].username;

      instance.turn = goes_first;

      instance.wrappers.forEach(function (wrapper) {
        wrapper.state = 'play_game';
        wrapper.socket.write("BEGIN " + goes_first + "\n");
      });
    }
  } else {
    //TODO ERROR
    console.log("Game does not exist");
    conn_wrapper.socket.write("ERR CONFIRM :Game does not exist");
  }
});

b_emit.on('JOIN', function(params, conn_wrapper) {
  if (params.length > 1) {
    //TODO SEND ERROR
    let reason = ":Too many parameters";
    return conn_wrapper.socket.write("ERR JOIN " + reason + "\n");
  }

  let name = params[0]

  if (game_instances[name]) {
    conn_wrapper.socket.write("OK JOIN " + ':'.concat(name) + '\n');
    conn_wrapper.state = 'init_game';
    conn_wrapper.game = name;

    game_instances[name].wrappers.push(conn_wrapper);

    game_instances[name].wrappers.forEach(wrapper => {
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

    instance.wrappers.forEach(wrapper => {
      if (wrapper.state === 'rematch') {
        rematch_count += 1;
      }
    });

    if (rematch_count === 1) {
      instance.wrappers.forEach(wrapper => {
        if (wrapper !== conn_wrapper) {
          let opponent = conn_wrapper.username;
          wrapper.socket.write("OPP REMATCH " + username + "\n");
        } else {
          conn_wrapper.socket.write("OK REMATCH\n")
        }
      });
    }

    if (rematch_count === 2) {
      instance.wrappers.forEach(function (wrapper) {
        wrapper.grid = clone_grid(grid_shape);
        wrapper.state = 'init_game';
        wrapper.socket.write("REINIT\n");
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
  let current_turn = instance.turn;

  if (current_turn !== conn_wrapper.username) {
    return conn_wrapper.socket.write("ERR GUESS :It is not your turn");
  }

  let opponent = instance.wrappers.filter(wrapper => wrapper !== conn_wrapper)[0];

  let guess_position = guess_map[location];

  if (!guess_position) {
    return conn_wrapper.socket.write("ERR GUESS :Not a valid grid position");
  }

  let [y, x] = guess_position;

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
        player.socket.write("SUNK " + ships_by_id[ship_id] + ' ' + location + ' ' + opponent.username + '\n');
        opponent.socket.write("OPP SUNK " + opponent.username + "\n");
        instance.turn = opponent.username;
      }

    } else {
      player.socket.write("HIT " + location + ' ' + opponent.username + "\n");
      opponent.socket.write("OPP HIT " + opponent.username + "\n");
      instance.turn = opponent.username;
    }

  } else {
    player.socket.write("MISS " + location + ' ' + opponent.username + "\n");
    opponent.socket.write("OPP MISS " + opponent.username + "\n");
    instance.turn = opponent.username;
  }
});

b_emit.on('CREATE', function(params, conn_wrapper) {
  if (params.length > 1) {
    console.log("ERR CREATE :Too many parameters");
    return conn_wrapper.socket.write('ERR CREATE :Too many parameters\n')
  }

  let name = params[0];

  if (game_instances[name]) {
    let reason = "Game: \'" + name + "\' already exists";
    return conn_wrapper.socket.write("ERR CREATE " + ':'.concat(reason));
  }

  game_instances[name] = { wrappers: [conn_wrapper], turn: null };
  conn_wrapper.socket.write("OK CREATE " + ':'.concat(name) +'\n');
  conn_wrapper.game = name;
  conn_wrapper.state = 'waiting';
});

b_emit.on('QUIT', function(params, conn_wrapper) {
  conn_wrapper.socket.destroy
  conn_wrapper = null; //will be garbage collected
});
