const net = require('net');
const EventEmitter = require('events');
const commands = ['OK', 'ERR', 'OPP', 'BEGIN', 'REINIT', 'HIT', 'MISS', 'SUNK', 'WINNER'];

let version = 1.0;
let message = '';
let game_name = '';
let current_message_component = 'command';
let current_state = 'disconnected';

const config = require("./server-config.json");
const {grid_shape, ships_by_id, ships, guess_map} = config;
const {clone_grid} = require('./server_helpers.js');

let own_grid = clone_grid(grid_shape);
let opp_grid = clone_grid(grid_shape);

class BattleshipEmitter extends EventEmitter {}
const b_emit = new BattleshipEmitter();

//Process host passed from client on command line
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

const socket = net.createConnection({ port: 7999, host: host });

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

function render_grid(grid) {
  for (row of grid) {
    console.log(row.join(' '));
  }
}

function validate_state(current_state, command) {
  return state_map[current_state] && state_map[current_state].includes(command)
}

function executeCommand(command, parameters) {
  if (commands.includes(command)) {
    b_emit.emit(command, parameters)
  } else {
    console.log("COMMAND NOT FOUND");
  }
}

function parseMessage(message) {
  let components;

  //process escpaed whitespace
  if (message.includes(':')) {
    let ind = message.indexOf(':');
    let esc_param = message.slice(ind + 1, message.length);
    let upto_esc = message.slice(0, ind - 1);
    components = upto_esc.split(" ");
    components.push(esc_param);
  } else {
    components = message.split(" ");
  }

  let command = components[0]
  let params = components.splice(1, components.length - 1)
  return {command: command, params: params}
}

//this object keeps track of what inputs can be entered by the client in a particular state
//helps map user inputs to appropriate commands and parameters where applicable
const inputs_for_state = {
  'auth_user': {
    '1': {'command': 'USER', 'parameters': ['username']},
    '2': {'command': 'QUIT', 'parameters': []}
  },
  'auth_password': {
    '1': {'command': 'PASSWORD', 'parameters': ['password']},
    '2': {'command': 'QUIT', 'parameters': []}
  },
  'connected': {
    '1': {'command': 'CREATE', 'parameters': ['name']},
    '2': {'command': 'JOIN', 'parameters': ['name']},
  },
  'waiting': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  },
  'init_game': {
    '1': {'command': 'PLACE', 'parameters': ['ship', 'grid location', 'orientation']},
    '2': {'command': 'CONFIRM', 'parameters': []},
    '3': {'command': 'GQUIT', 'parameters': []}
  },
  'confirm': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  },
  'play_game': {
    '1': {'command': 'GUESS', 'parameters': ['grid location'] },
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

function console_out(msg) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    console.log(msg);
    readline.setPrompt('> ')
    readline.prompt(true);
}

//helper function for console output to help client navigate protocol
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

//initialize CLI
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '>'
});

function parameter_prompt(parameters) {
  param_string = parameters.join(', ')
  readline.setPrompt('\nEnter the following parameters (space separated): ' + param_string + '\n\n> ');
  readline.prompt();

  //Somewhat hacky. Node is async, and this ensures proper execution order for message construction.
  setTimeout(() => {
    current_message_component = 'parameters';
  }, 0)
}

//Listens for user input on newlines.
//Formats user input into valid protocol messages
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

function prompt(current_state) {
  let message = '';

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
    console.log('In Game: ' + game_name +"\n");
    render_grid(own_grid);
  }

  if (current_state === 'play_game') {
    console.log('In Game: ' + game_name +"\n");
    render_grid(opp_grid);
  }

  console.log(prompt_string(current_state));
  readline.setPrompt("> ");
  readline.prompt(true);
}


//SOCKET CONNECTION LIISTENER
socket.on('connect', () => {
  current_state = 'negotiate_version';

  //send CONNECT message for version negotiation
  socket.write('CONNECT ' + version + "\n");

  socket.on('data', data => {
    let messages = data.toString('UTF8').trim().split('\n');

    for (let i = 0; i < messages.length; i++) {
      let {command, params} = parseMessage(messages[i]);
      let is_allowable = validate_state(current_state, command);
      if (is_allowable) {
        executeCommand(command, params);
      } else {
        console.log("STATE ERROR", current_state);
      }
    }
  });

  socket.on('close', data => {
    process.exit(-1);
  })
});

//BEGIN PROTOCOL SPECIFIC LISTENERS
/*
  These functions listen for messages from the server
  Primarily Update client state and prompt for additonal input depending on state.
*/
b_emit.on('OK', function(params) {
  let successful_command = params[0];
  if (successful_command === 'CONNECT') {
    version = params[1];
    current_state = 'auth_user';
  }

  if (successful_command === 'USER') {
    current_state = 'auth_password';
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

    for (row of own_grid) {
      let ind = row.indexOf(ship.id);
      if (ind > -1) {
        row[ind] = 0;
      }
    }

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
  console.log("\n" + reason);
  prompt(current_state);
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
    prompt(current_state);
  }

  if (opponent_command === 'PLACE') {
    console_out(opp + ' placed a ship\n');
  }

  if (opponent_command === 'CONFIRM') {
    console_out(opp + ' confirmed ships, and is ready to play!');
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
  console.log("\nYou sunk the " + ship + "!");
  prompt(current_state);
})

b_emit.on('HIT', (params) => {
  let location = params[0];
  let [y, x] = guess_map[location];
  opp_grid[y][x] = 'x';

  console.log("\nHit " + location + "!");
  prompt(current_state);
});

b_emit.on('MISS', (params) => {
  let location = params[0];
  let [y, x] = guess_map[location];
  opp_grid[y][x] = 'o';

  console.log("\nMiss " + location + "!");
  prompt(current_state);
});

b_emit.on('REINIT', () => {
  current_state = 'init_game';
  prompt(current_state);
});

b_emit.on('BEGIN', () => {
  current_state = 'play_game';
  prompt(current_state);
});

//END EVENT LISTENERS
