const net = require('net');
const EventEmitter = require('events');
var keypress = require('keypress');

const version = 1.0;

let message = '';
let game_name = '';
let current_message_component = 'command';
let current_state = 'disconnected';

const commands = ['OK', 'ERR', 'OPP_JOINED', 'OPP_LEFT', 'OPP_PLACE', 'OPP_CONFIRM', 'OPP_REMATCH', 'BEGIN', 'REINIT', 'HIT', 'MISS', 'SUNK', 'WINNER'];

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const socket = net.createConnection({ port: 9000, host: 'localhost' });

//this object keeps track of what inputs can be entered by the client in a particular state
const inputs_for_state = {
  'auth_user': {
    '1': {'command': 'USER', 'parameters': ['username']}
  },
  'auth_password': {
    '1': {'command': 'PASSWORD', 'parameters': ['password']}
  },
  'connected': {
    '1': {'command': 'CREATE', 'parameters': ['name']},
    '2': {'command': 'JOIN', 'parameters': ['name']},
  },
  'waiting': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  },
  'init_game': {
    '1': {'command': 'PLACE', 'parameters': ['ship', 'grid_location', 'orientation']},
    '2': {'command': 'CONFIRM', 'parameters': []},
    '3': {'command': 'GQUIT', 'parameters': []}
  },
  'confirm': {
    '1': {'command': 'GQUIT', 'parameters': [] }
  },
  'play_game': {
    '1': {'command': 'GUESS', 'parameters': ['grid_location'] },
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
    "auth_user": "1) Enter Username \n",
    "auth_password": "1) Enter Password \n",
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


const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '>'
});

function parameter_prompt(parameters) {
  param_string = parameters.join(', ')
  readline.setPrompt('\nEnter the following parameters (space separated): ' + param_string + '\n\n> ');
  readline.prompt();

  //Somewhat hacky. Node is async, and this ensures proper execution order
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
      command = valid_inputs[input].command;
      parameters = valid_inputs[input].parameters;

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

  console.log(prompt_string(current_state));
  readline.setPrompt("> ");
  readline.prompt(true);
}


socket.on('connect', () => {
  current_state = 'auth_user';

  prompt(current_state);

  socket.on('data', data => {
    let messages = data.toString('UTF8').trim().split('\n');

    for (let i = 0; i < messages.length; i++) {
      let {command, params} = parseMessage(messages[i])
      executeCommand(command, params)
    }

  });

  socket.on('close', data => {
    process.exit(-1);
  })

});

function executeCommand(command, parameters) {
  if (commands.includes(command)) {
    myEmitter.emit(command, parameters)
  } else {
    console.log("COMMAND NOT FOUND")
  }
}

function parseMessage(message) {
  let components = message.split(' ')
  let command = components[0]
  let params = components.splice(1, components.length - 1)
  return {command: command, params: params}
}

myEmitter.on('OK', function(params) {
  let successful_command = params[0];

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
  }

  if (successful_command === 'CONFIRM') {
    current_state = 'confirm';
  }

  if (successful_command === 'REMATCH') {
    current_state = 'rematch';
  }

  prompt(current_state);

});

myEmitter.on('ERR', params => {
  let failed_command = params[0];

  if (failed_command === 'PASSWORD') {
    console.log("\nInvalid Password!");
  }

  prompt(current_state);
})

myEmitter.on('WINNER', (params) => {
  let player = params[0];
  console.log("\n" + player + " won the game!");
  current_state = 'finish_game';
  prompt(current_state);
});

myEmitter.on('SUNK', (params) => {
  let ship = params[0];
  console.log("\nYou sunk the " + ship + "!");
  prompt(current_state);
})

myEmitter.on('HIT', (params) => {
  let location = params[0];
  console.log("\nHit " + location + "!");
  prompt(current_state);
});

myEmitter.on('MISS', (params) => {
  let location = params[0];
  console.log("\nMiss " + location + "!");
  prompt(current_state);
});

myEmitter.on('REINIT', () => {
  current_state = 'init_game';
  prompt(current_state);
});

myEmitter.on('BEGIN', () => {
  current_state = 'play_game';
  prompt(current_state);
});

myEmitter.on('OPP_PLACE', params => {
  let opp = params[0];
  console_out(opp + ' placed a ship\n');
});

myEmitter.on('OPP_LEFT', params => {
  let opp = params[0];
  console.log("\n");
  console.log(opp + ' has left the game!');
  current_state = 'waiting';
  prompt(current_state);
});

myEmitter.on('OPP_REMATCH', params => {
  let opp = params[0];
  console_out(opp + ' wants a rematch!\n');
});

myEmitter.on('OPP_JOINED', params => {
  let opp = params[0];
  console.log("\n");
  console.log(opp + ' has joined the game!');
  current_state = 'init_game';
  prompt(current_state);
});

myEmitter.on('OPP_CONFIRM', params => {
  let opp = params[0];
  console_out(opp + ' confirmed ships, and is ready to play!');
});
