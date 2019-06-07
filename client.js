/*
---------------------------------------------------------------------------------
  Name: client.js

  Purpose:
    This file contains the client side implementation of the Battleship Protocol
    It also contins functions that build the UI to interact with the procotocol and communicate with the server.

  Date: 06/07/2019

  Author: Tom Rein
--------------------------------------------------------------------------------
*/


//TCP server
const net = require('net');
const EventEmitter = require('events');

//Instantiate emiiter to send and recive events to/from server
class BattleshipEmitter extends EventEmitter {}
const b_emit = new BattleshipEmitter();

//desired version, can be changed depending on what version server decides
let version = 1.0;

//load external files
const {grid_shape, ships_by_id, ships, guess_map} = require("./server-config.json"); //NOTE: comments are not allowed in JSON files
const {clone_grid, render_grid} = require('./server_helpers.js');
const {validate_message_with_state} = require('./state.js');

//declare client application variables
let game_name = '';
let current_turn = '';
let current_state = 'disconnected';
let message = '';
let current_message_component = 'command';
let own_grid = clone_grid(grid_shape);
let opp_grid = clone_grid(grid_shape);


//CLIENT
//Process host address passed from client on command line
let host = 'localhost'; //default to localhost
const args = process.argv.slice(2);
if (args.length) {
  for (i = 0; i < args.length; i++) {
    let [key, val] = args[i].split("=");
    if (key === 'host') {
      host = val;
    }
  }
}

//SERVICE
//client defaults to port number
const socket = net.createConnection({ port: 7999, host: host });

//use UTF8 per design specification
socket.setEncoding('utf8');

//STATEFUL
//This is passed to the validate_message_with_state function
//Maps what commands can be executed for a given state
const state_map = {
  'negotiate_version': ['OK', 'ERR'],
  'auth_user': ['OK', 'ERR'],
  'auth_password': ['OK', 'ERR'],
  'connected': ['OK', 'ERR'],
  'waiting': ['OK', 'ERR', 'OPP'],
  'init_game': ['BEGIN', 'OK', 'ERR', 'OPP'],
  'confirm': ['BEGIN', 'OK', 'ERR', 'OPP'],
  'play_game': ['HIT', 'MISS', 'SUNK', 'WINNER', 'OK', 'ERR', 'OPP'],
  'finish_game': ['REINIT', 'OK', 'ERR', 'OPP'],
  'rematch': ['REINIT', 'OK', 'ERR', 'OPP']
}

//attaches listener to socket after making connection with the server
socket.on('connect', () => {
  current_state = 'negotiate_version';

  //send CONNECT message for version negotiation
  socket.write('CONNECT ' + version + "\n");

  //rattach listener to socket to recieve data from the server
  socket.on('data', data => {
    let messages = data.toString('UTF8').trim().split('\n');

    //STATEFUL
    //Validates messages from the server in accordance with current_state
    for (let i = 0; i < messages.length; i++) {
      let valid_message = validate_message_with_state(messages[i], current_state, state_map);
      if (valid_message) {
        let [command, params] = valid_message;
        //STATEFUL
        //emit the command as an evernt, which triggeres the various listeners below.
        b_emit.emit(command, params);
      } else {
        console.log("STATE ERROR", current_state);
      }
    }
  });

  socket.on('close', data => {
    process.exit(-1);
  })
});

//STATEFUL
//listens for events from b_emit.emit(command, params)
//These functions listen for  a spsecific command and execute the appropriate callback function.
// All listeners follow the same general format, but the functions perform different actions depending on the command.
//This listenters primarily updates the client state where applicable and prompts for additonal input depending on state.
//All b_smit listeners should be considered for STATEFUL requirement
b_emit.on('OK', function(params) {
  let successful_command = params[0];
  if (successful_command === 'CONNECT') {
    version = params[1];
    current_state = 'auth_user';
  }

  if (successful_command === 'USER') {
    current_state = 'auth_password';
    username = params[1];
  }

  if (successful_command === 'PASSWORD') {
    current_state = 'connected';
  }

  if (successful_command === 'CREATE') {
    current_state = 'waiting';
    game_name = params[1];
  }

  if (successful_command === 'GQUIT') {
    current_state = "connected";

    //reset the grids for the client
    own_grid = clone_grid(grid_shape);
    opp_grid = clone_grid(grid_shape);
  }

  if (successful_command === 'JOIN') {
    current_state = 'init_game';
    game_name = params[1];
  }

  if (successful_command === 'PLACE') {
    console.log("\nSuccesfully placed Ship!");
    let ship_name = params[1];
    let positions = params[2].split(' ');
    let ship = ships[ship_name];

    //HAndle re-placement of ship.
    //For example, if someone wants move a piece they alreayd played.
    //Looks for all
    for (row of own_grid) {
      let ind = row.indexOf(ship.id);
      if (ind > -1) {
        row[ind] = 0;
      }
    }

    //Place ships according to positions,
    for (position of positions) {
      let position_inds = guess_map[position];
      let [y, x] = position_inds;
      own_grid[y][x] = ship.id;
    }
  }

  if (successful_command === 'CONFIRM') {
    current_state = 'confirm';
  }

  if (successful_command === 'REMATCH') {
    current_state = 'rematch';
  }
  prompt(current_state, params);
});

b_emit.on('ERR', params => {
  let failed_command = params[0];
  let reason = params[1];
  console.log("\n" + reason); //output reason for error
  prompt(current_state); //reset the prompt
});

b_emit.on('OPP', params => {
  let opponent_command = params[0]
  let opp = params[1];

  if (opponent_command === 'JOIN') {
    console.log("\n");
    console.log(opp + ' has joined the game!');
    current_state = 'init_game';
    prompt(current_state);
  }

  if (opponent_command === 'GQUIT') {
    console.log("\n");
    console.log(opp + ' has left the game!');
    current_state = 'waiting';
    own_grid = clone_grid(grid_shape);
    opp_grid = clone_grid(grid_shape);
    prompt(current_state);
  }

  if (opponent_command === 'PLACE') {
    inline_prompt(opp + ' placed a ship\n'); //notify client without reseting prompt
  }

  if (opponent_command === 'CONFIRM') {
    inline_prompt(opp + ' confirmed ships, and is ready to play!'); //notidy client without reseting prompt
  }

  //update player turn on hit, miss or sunck
  if (['HIT', 'MISS', 'SUNK'].includes(opponent_command)) {
    current_turn = opp;
    prompt(current_state);
  }
});

b_emit.on('WINNER', (params) => {
  let player = params[0];
  console.log("\n" + player + " won the game!");
  current_state = 'finish_game';
  prompt(current_state);
});

b_emit.on('SUNK', (params) => {
  let ship = params[0];
  let location = params[1];
  let opponent = params[1];
  console.log("\nYou sunk the " + ship + "!");
  prompt(current_state);
})

b_emit.on('HIT', (params) => {
  let location = params[0];
  let opponent = params[1];
  let [y, x] = guess_map[location];
  opp_grid[y][x] = 'x'; //update grid at location with x
  current_turn = opponent;

  console.log("\nHit " + location + "!");
  prompt(current_state);
});

b_emit.on('MISS', (params) => {
  let location = params[0];
  let opponent = params[1];
  let [y, x] = guess_map[location];
  opp_grid[y][x] = 'o'; //update grid at location with o
  current_turn = opponent;

  console.log("\nMiss " + location + "!");
  prompt(current_state);
});

b_emit.on('REINIT', () => {
  current_state = 'init_game';

  //reset grids
  own_grid = clone_grid(grid_shape);
  opp_grid = clone_grid(grid_shape);
  prompt(current_state);
});

b_emit.on('BEGIN', (params) => {
  current_turn = params[0];
  current_state = 'play_game';
  prompt(current_state);
});


//UI
//this object keeps track of what inputs can be entered by the client in a particular state
//helps map user inputs to appropriate commands and parameters where applicable
const inputs_for_state = {
  'auth_user': {
    '1': {'command': 'USER', 'parameters': ['Username']},
    '2': {'command': 'QUIT', 'parameters': []}
  },
  'auth_password': {
    '1': {'command': 'PASSWORD', 'parameters': ['Password']},
    '2': {'command': 'QUIT', 'parameters': []}
  },
  'connected': {
    '1': {'command': 'CREATE', 'parameters': ['Name']},
    '2': {'command': 'JOIN', 'parameters': ['Name']},
  },
  'waiting': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  },
  'init_game': {
    '1': {'command': 'PLACE', 'parameters': ['Ship', 'Grid Location', 'Orientation (v or h)']},
    '2': {'command': 'CONFIRM', 'parameters': []},
    '3': {'command': 'GQUIT', 'parameters': []}
  },
  'confirm': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  },
  'play_game': {
    '1': {'command': 'GUESS', 'parameters': ['Grid location'] },
    '2': {'command': 'GQUIT', 'parameters': [] }
  },
  'finish_game': {
    '1': {'command': 'REMATCH', 'parameters': [] },
    '2': {'command': 'GQUIT', 'parameters': []}
  },
  'rematch': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  }
}

//UI
//helper function for console output to help client navigate protocol
//called by prompt
function prompt_string(current_state) {
  test = '\nAvailable Options (enter number to execute)\n';

  //This instantiates options depending on what the current_state is.
  options = {
    "auth_user": "1) Enter Username\n2) Exit\n",
    "auth_password": "1) Enter Password\n2) Exit\n",
    "connected": "1) Create Game\n2) Join Game\n",
    "waiting": "1) Leave Game\n",
    "init_game": "1) Place ship\n2) Confirm Ship Placements\n3) Leave Game\n",
    "confirm": "1) Leave Game\n",
    "play_game": "1) Guess\n2) Leave Game\n",
    "finish_game": "1) Rematch\n2) Leave Game\n",
    "rematch": "1) Leave Rematch Game\n"
  }[current_state]

  return test + options
}

//UI
//initialize CLI
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '>'
});

//UI
//Listens for user input on newlines.
//Formats user input into valid protocol messages
//processes both commands and parameters separately.
readline.on('line', input => {
  if (current_message_component === 'command') {
    valid_inputs = inputs_for_state[current_state];

    if (input in valid_inputs) {
      let command = valid_inputs[input].command;
      let parameters = valid_inputs[input].parameters;

      message += command + ' ';

      if (parameters.length) {
        parameter_prompt(parameters);
      } else {
        socket.write(message);
        message = '';
      }

     } else {
       console.log("INVALID OPTION");
       //reprompt user
       prompt(current_state);
     }
  }
  if (current_message_component === 'parameters') {
    //escape space characters for JOIN and CREATE so clients can create games with multiple words
    //Message at this point will be just the command
    let command = message;
    if (command === 'CREATE ' || command === 'JOIN ') {
      input = ':'.concat(input);
    }

    message += input + '\n';
    socket.write(message);

    //reset message variables for further inputs
    current_message_component = 'command';
    message = '';
  }
});

//UI
//displays the prompt for the user
//depending on state, may display additonal information
function prompt(current_state) {
  console.log("\n==========BATTLESHIP PROTOCOL========");

  if (current_state === 'waiting') {
    console.log("In Game: " + game_name);
    console.log("Waiting for opponent to join.");
  }

  if (current_state === 'confirm') {
    console.log("In Game: " + game_name);
    console.log("Waiting for opponent to confirm ships.");
  }

  if (current_state === 'init_game') {
    console.log('In Game: ' + game_name);
    console.log("Placeable Ships:", Object.keys(ships).join(", ") + "\n");
    render_grid(own_grid);
  }

  if (current_state === 'play_game') {
    console.log('In Game: ' + game_name +"\n");
    console.log("Current turn: " + current_turn);
    render_grid(opp_grid);
  }

  console.log(prompt_string(current_state));
  readline.setPrompt("> ");
  readline.prompt(true);
}

//UI
//This function prompts for a user to enter a string of parameters
//Assumes the user will enter parameters separated by spaces
function parameter_prompt(parameters) {
  param_string = parameters.join(', ')
  readline.setPrompt('\nEnter the following parameters (space separated): ' + param_string + '\n\n> ');
  readline.prompt();

  //Somewhat hacky. Node is async, and this ensures proper execution order for message construction.
  setTimeout(() => {
    current_message_component = 'parameters';
  }, 0)
}

//UI
//This function is used to send messages without reseting the current prompt screen
//This is primarily used to listen for OPP events.
//The user is notified of the opponent's action, but it does not reset the prompt
function inline_prompt(msg) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    console.log(msg);
    readline.setPrompt('> ')
    readline.prompt(true);
}
