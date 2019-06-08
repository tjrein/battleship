/*
---------------------------------------------------------------------------------
  Name: server.js

  Purpose:
    This file contains the serside implmentation of the Battleship protocol.
    It instantiates a tcp server, attaches a listener on the server for client connections
    As clients connect, listeners are attached to the socket to listen for data transmitted by the client.
    It is asynchrhouns, event-driven architecutre, thus allowing concurrent client connections.

  Date: 06/07/2019

  Author: Tom Rein
--------------------------------------------------------------------------------
*/


//Used to establish TCP connection
const net = require('net');
const server = net.createServer();

//Instantiate emiiter to emit events based around client commands
const EventEmitter = require('events');
class BattleshipEmitter extends EventEmitter {}
const b_emit = new BattleshipEmitter();

//Versions supported by server
const versions = [1.0];

//Load battleshipt application configuration
//This specifies the size of the grid, what ships to use, etc.
const {users, grid_shape, ships_by_id, ships, guess_map} = require("./config.json"); //NOTE: comments are not allowed in JSON files

//load helper functions that help play battleship
const {clone_grid, validate_sunk, validate_win, validate_placement, convert_position} = require("./helpers.js");

//STATEFUL
//Load state validation
const {validate_message_with_state} = require('./state.js');


//STATEFUL
//Contains all valid commands for a given state.
//Commands that are not contained in the array for a given state are discarded.
const state_map = {
  "negotiate_version": ["CONNECT"],
  "auth_user": ["USER", "QUIT"],
  "auth_password": ["PASSWORD", "QUIT"],
  "connected": ["JOIN", "CREATE", "QUIT"],
  "waiting": ["GQUIT"],
  "init_game": ["PLACE", "CONFIRM", "GQUIT"],
  "confirm": ["GQUIT"],
  "rematch": ["GQUIT"],
  "play_game": ["GUESS"],
  "finish_game": ["REMATCH", "GQUIT"]
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
  const client_address = conn.remoteAddress + ':' + conn.remotePort;
  console.log("Client connected: ", client_address);

  //wrap socket with useful information
  let socket_wrapper = {
    socket: conn,
    state: 'negotiate_version',
    username: null,
    game: null,
    grid: clone_grid(grid_shape) //deep clone grid,
  }

  //use UTF8 per design specification.
  socket_wrapper.socket.setEncoding('utf8');

  //CONCURRENT
  //This attaches unique listeners to each socket connection.
  //The data transmitted will be associated with a specific client, and the server will not be blocked.
  socket_wrapper.socket.on('data', data => {
      //split messages on newline.
      //this will generally by one message, but handle multiple messages
      let messages = data.toString('UTF8').trim().split('\n');

      for (let i = 0; i < messages.length; i++) {
        console.log('Message from ' + client_address + ': ' + messages[i]);
        //STATEFUL
        let valid_message = validate_message_with_state(messages[i], socket_wrapper.state, state_map);
        if (valid_message) {
          let [command, params] = valid_message;
          //STATEFUL
          //emit command as event, triggering listeners below.
          //pass the socket_wrapper so we can send messages to the write client.
          b_emit.emit(command, params, socket_wrapper);
        } else {
          socket_wrapper.socket.write("ERR " + command + " :Current state is not supported for this command")
        }
      }
    });

  //log when a client disconnects.
  socket_wrapper.socket.on('close', () => {
    console.log(client_address + " disconnected");
  });
});

function cleanupInstance(instance_name) {
  //If no clients are in an instance, delete it
  if (game_instances[instance_name].wrappers.length === 0) {
    console.log("Removing Game Instance: ", instance_name);
    delete game_instances[instance_name]
  }
}

//STATEFUL
//These event listenters trigger on b_emit(command, params, socket_wraper)
//This means that the client has sent a command.
//Each event listenr will trigger the given callback function when fired.
//All event listeners shouls be considered for stateful requirement, as many update the protocol state for a given client.
b_emit.on('USER', (params, socket_wrapper) => {
  let username = params[0];
  if (username in users) {
    socket_wrapper.username = username;
    socket_wrapper.state = 'auth_password';
    socket_wrapper.socket.write('OK USER ' + username);
  } else {
    console.log("Not a valid username");
    socket_wrapper.socket.write('ERR USER :Not a registered user');
  }
});

b_emit.on('PASSWORD', (params, socket_wrapper) => {
  let password = params[0];
  username = socket_wrapper.username;

  //check if password matches record for password
  if (password === users[username].password) {
    socket_wrapper.socket.write('OK PASSWORD');
    socket_wrapper.state = 'connected';
  } else {
    socket_wrapper.socket.write('ERR PASSWORD :Incorrect password');
  }
});

b_emit.on('GQUIT', (params, socket_wrapper) => {
  let instance_name = socket_wrapper.game;
  let game_instance = game_instances[instance_name];
  let index = game_instance.wrappers.indexOf(socket_wrapper);

  //check to make sure client is in game instance
  //and remove them from game isntance if found
  if (index > -1) {
    game_instance.wrappers.splice(index, 1);
    socket_wrapper.socket.write("OK GQUIT " + instance_name);
    socket_wrapper.state = 'connected';
    socket_wrapper.game = null;
    socket_wrapper.grid = clone_grid(grid_shape);

    //let the other player know this client has left if there is another player in the game instance
    if (game_instance.wrappers.length) {
      let other_player = game_instance.wrappers[0];
      let player = socket_wrapper.username;

      other_player.socket.write("OPP GQUIT " + player + "\n");
      other_player.state = 'waiting';
    }
  } else {
    socket_wrapper.socket.write("ERR GQUIT :You are not part of this game instance");
  }

  //removes instances that have no players
  cleanupInstance(instance_name)
});

b_emit.on('CONNECT', (params, socket_wrapper) => {
  let [desired_version] = params;

  //Get all versions upto client requested version and select the highest one.
  let supported_versions = versions.filter(version => version <= desired_version);
  let negotiated_version = Math.max(...supported_versions);

  socket_wrapper.socket.write("OK CONNECT " + negotiated_version);
  socket_wrapper.state = 'auth_user';
});

b_emit.on('PLACE', function(params, socket_wrapper) {
  let [ship_name, loc, orient] = params;
  let instance_name = socket_wrapper.game;
  let grid = socket_wrapper.grid;
  let ship = ships[ship_name]
  let instance = game_instances[instance_name];
  let positions = validate_placement(ships, guess_map, ship_name, loc, orient, socket_wrapper);

  if (!positions) {
    return socket_wrapper.socket.write("ERR PLACE :invalid placement");
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
    if (wrapper === socket_wrapper) {
      wrapper.socket.write("OK PLACE " + ship_name + ' ' + place_parameter + "\n");
    } else {
      let opponent = socket_wrapper.username;
      wrapper.socket.write("OPP PLACE " + opponent);
    }
  });
});

b_emit.on('CONFIRM', function(params, socket_wrapper) {
  let instance_name = socket_wrapper.game;
  let confirm_count = 0;
  let instance = game_instances[instance_name];

  if (instance) {
    socket_wrapper.state = 'confirm';

    instance.wrappers.forEach(wrapper => {
      if (wrapper.state === 'confirm') {
        confirm_count += 1;
      }
    });

    //let the opponent know that this client has confirmed.
    if (confirm_count === 1) {
      instance.wrappers.forEach(wrapper => {
        if (wrapper !== socket_wrapper) {
          let opponent = socket_wrapper.username;
          wrapper.socket.write("OPP CONFIRM " + opponent + "\n");
        } else {
          socket_wrapper.socket.write("OK CONFIRM")
        }
      });
    }

    //If both clients are in confirm state, select a random player to go goes first.
    if (confirm_count === 2) {
      //generate random index between 0 and 1;
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
    socket_wrapper.socket.write("ERR CONFIRM :Game does not exist");
  }
});

b_emit.on('JOIN', function(params, socket_wrapper) {
  if (params.length > 1) {
    //TODO SEND ERROR
    let reason = ":Too many parameters";
    return socket_wrapper.socket.write("ERR JOIN " + reason + "\n");
  }

  let name = params[0]

  if (game_instances[name]) {
    socket_wrapper.socket.write("OK JOIN " + ':'.concat(name) + '\n');
    socket_wrapper.state = 'init_game';
    socket_wrapper.game = name;

    //push another socket_wrapper into the game instance
    game_instances[name].wrappers.push(socket_wrapper);

    //transition each client to the init_game state
    game_instances[name].wrappers.forEach(wrapper => {
      wrapper.state = 'init_game';

      //let other player know the game has been joined
      if (wrapper !== socket_wrapper) {
        //var remoteAddress = socket_wrapper.socket.remoteAddress + ':' + socket_wrapper.socket.remotePort;
        let opponent_name = socket_wrapper.username;
        wrapper.socket.write("OPP JOIN " + opponent_name + '\n');
      }
    });

  } else {
    let reason = ":Game \'" + name + "\' does not exist";
    socket_wrapper.socket.write("ERR JOIN " + reason + "\n");
  }
});

b_emit.on('REMATCH', (params, socket_wrapper) => {
  let instance_name = socket_wrapper.game;
  let rematch_count = 0;
  let instance = game_instances[instance_name];

  if (instance) {
    //socket_wrapper.socket.write("OK CONFIRM");
    socket_wrapper.state = 'rematch';

    instance.wrappers.forEach(wrapper => {
      if (wrapper.state === 'rematch') {
        rematch_count += 1;
      }
    });

    //Only one client has sent a Rematch
    //Notify the other client
    if (rematch_count === 1) {
      instance.wrappers.forEach(wrapper => {
        if (wrapper !== socket_wrapper) {
          let opponent = socket_wrapper.username;
          wrapper.socket.write("OPP REMATCH " + username + "\n");
        } else {
          socket_wrapper.socket.write("OK REMATCH\n")
        }
      });
    }

    //Both clients have sent a REMATCH
    //Reset the grid and reinitilize the game.
    if (rematch_count === 2) {
      instance.wrappers.forEach(function (wrapper) {
        wrapper.grid = clone_grid(grid_shape);
        wrapper.state = 'init_game';
        wrapper.socket.write("REINIT\n");
      });
    }
  } else {
    console.log("ERR REMATCH :Game does not exist");
  }
});

b_emit.on('GUESS', (params, socket_wrapper) => {
  let instance = game_instances[socket_wrapper.game];
  let location = params[0];
  let player = socket_wrapper;
  let current_turn = instance.turn;

  if (current_turn !== socket_wrapper.username) {
    return socket_wrapper.socket.write("ERR GUESS :It is not your turn");
  }

  let opponent = instance.wrappers.filter(wrapper => wrapper !== socket_wrapper)[0];

  let guess_position = guess_map[location];

  if (!guess_position) {
    return socket_wrapper.socket.write("ERR GUESS :Not a valid grid position");
  }

  let [y, x] = guess_position;

  if (opponent.grid[y][x]) {
    let ship_id = opponent.grid[y][x];
    opponent.grid[y][x] = 'x';

    let ship_is_sunk = validate_sunk(ship_id, opponent.grid);

    if (ship_is_sunk) {
      let win_condition = validate_win(opponent.grid);

      //if the game is won, trnastion to finish_Game
      if (win_condition) {
        player.socket.write("WINNER " + socket_wrapper.username + "\n");
        opponent.socket.write("WINNER " + socket_wrapper.username + "\n");
        player.state = 'finish_game';
        opponent.state = 'finish_game';
      } else {
        //send notificaiotns to clietns that ship has been sunk
        player.socket.write("SUNK " + ships_by_id[ship_id] + ' ' + location + ' ' + opponent.username + '\n');
        opponent.socket.write("OPP SUNK " + opponent.username + "\n");
        instance.turn = opponent.username;
      }

    } else {
      //send notificaitons to clients that ship has been hit
      player.socket.write("HIT " + location + ' ' + opponent.username + "\n");
      opponent.socket.write("OPP HIT " + opponent.username + "\n");
      instance.turn = opponent.username;
    }

  } else {
    //send notiicaitons to clients of a miss
    player.socket.write("MISS " + location + ' ' + opponent.username + "\n");
    opponent.socket.write("OPP MISS " + opponent.username + "\n");
    instance.turn = opponent.username;
  }
});

b_emit.on('CREATE', function(params, socket_wrapper) {
  //There should only be one game name, and whitspace should have been escaped.
  if (params.length > 1) {
    console.log("ERR CREATE :Too many parameters");
    return socket_wrapper.socket.write('ERR CREATE :Too many parameters\n')
  }

  let name = params[0];

  //Only have one game_instance with this name
  if (game_instances[name]) {
    let reason = "Game: \'" + name + "\' already exists";
    return socket_wrapper.socket.write("ERR CREATE " + ':'.concat(reason));
  }

  //add an object to the game_instances object.
  //The game instance will have the game name as the key
  //Each game instance contains a record of which socket_wrappers, i.e. clients are in the instance
  //It also needs to keep track of who's turn it is once the game is set, so initialize a key for turn.
  game_instances[name] = { wrappers: [socket_wrapper], turn: null };
  socket_wrapper.socket.write("OK CREATE " + ':'.concat(name) +'\n'); //name can contain spaces, so prepend colon just in case.
  socket_wrapper.game = name;
  socket_wrapper.state = 'waiting';
});

b_emit.on('QUIT', function(params, socket_wrapper) {
  socket_wrapper.socket.destroy();
  socket_wrapper = null; //will be garbage collected
});
