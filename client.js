const net = require('net');
const EventEmitter = require('events');
var keypress = require('keypress');

let message = '';
let game_name = '';
let current_message_component = 'command';
let current_state = 'disconnected';

const commands = ['OK', 'ERR', 'OPP_JOINED', 'OPP_LEFT']

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const socket = net.createConnection({ port: 9000, host: 'localhost' });

//this object keeps track of what inputs can be entered by the client in a particular state
const inputs_for_state = {
  'connected': {
    '1': {'command': 'CREATE', 'parameters': ['name']},
    '2': {'command': 'JOIN', 'parameters': ['name']},
  },
  'waiting': {
    '1': {'command': 'GQUIT', 'parameters': ['name'] }
  },
  'init_game': {
    '1': {'command': 'PLACE', 'parameters': ['ship', 'grid_location', 'orientation']},
    '2': {'command': 'GQUIT', 'parameters': ['name']},
    '3': {'command': 'confirm'}
  }
}

//helper function for console output to help client navigate protocol
function prompt_string(current_state) {
  test = '\nAvailable Options (enter number to execute)\n';

  //This instantiates options depending on what the current_state is.
  options = {
    "connected": "1) Create Game\n2) Join Game",
    "waiting": "1) Leave Game",
    "init_game": "1) Place ship\n2) Leave Game"
  }[current_state]

  return test + options
}


const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '>'
});

function parameter_prompt(parameters) {
  param_string = parameters.join(',')
  readline.setPrompt('Enter the following parameters (space separated): ' + param_string + '\n> ');
  readline.prompt();

  //Somewhat hacky. Node is async, and this ensures proper execution order with line 77
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
        socket.write(message)
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

  console.log(prompt_string(current_state));
  readline.setPrompt("> ");
  readline.prompt();
}


//keypress(process.stdin);
socket.on('connect', () => {
  //welcome();
  current_state = 'connected';

  prompt(current_state);

  socket.on('data', data => {
    let messages = data.toString('UTF8').trim().split('\n');

    for (let i = 0; i < messages.length; i++) {
      let {command, params} = parseMessage(messages[i])
      console.log("command", command);
      console.log("params", params);
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

  prompt(current_state);

});

myEmitter.on('OPP_LEFT', params => {
  let opp = params[0];
  console.log("\n");
  console.log(opp + ' has left the game!');
  current_state = 'waiting';
  prompt(current_state);
});

myEmitter.on('OPP_JOINED', params => {
  let opp = params[0];
  console.log("\n");
  console.log(opp + ' has joined the game!');
  current_state = 'init_game';
  prompt(current_state);
});

myEmitter.on('ERR', params => {
  console.log("ERR " + params[0])
});




  //readline.question('> ', input => {
  //  let message = "";
  //  let command = "";
  //  let parameters = [];

    //array of inputs that can be executed in the current_state
  //  valid_inputs = inputs_for_state[current_state];
  //  if (input in valid_inputs) {
  //      command = valid_inputs[input].command
  //      parameters = valid_inputs[input].parameters
  //  }

  //  message += command + ' '

  //  if (parameters.length) {
  //    param_string = parameters.join(',')

      //Prompts for all command parameters at once.
      //Not ideal, but since node is async, this attempts to avoid the so called "callback hell'
  //    readline.question('Enter parameters (space separated): ' + param_string + '\n> ', param_input => {
  //      message += param_input;
  //      message += '\n';
  //      socket.write(message);
  //    });

  //  } else {
  //    message += "\n";
  //    socket.write(message);
  //  }
  //});
