const net = require('net');
const EventEmitter = require('events');
var keypress = require('keypress');

let message = '';
let current_message_component = 'command';
let current_state = 'disconnected';

const commands = ['OK', 'ERR']

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
    '1': {'command': 'GQUIT', 'parameters': [] }
  }
}

//helper function for console output to help client navigate protocol
function prompt_string(current_state) {
  test = '\nAvailable Options (enter number to execute)\n';

  //This instantiates options depending on what the current_state is.
  options = {
    "connected": "1) Create Game\n2) Join Game",
    "waiting": "1) Leave Current Game"
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
    console.log("hello", current_message_component);
    message = '';
  }
});

function prompt(current_state) {
  let message = '';

  console.log("\n==========BATTLESHIP PROTOCOL========");

  if (current_state === 'waiting') {
    console.log("In Game: " + game_name);
  }

  console.log(prompt_string(current_state));
  readline.setPrompt("> ");
  readline.prompt();


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
  components = message.split(' ')
  command = components[0]
  params = components.splice(1, components.length - 1)
  return {command: command, params: params}
}

myEmitter.on('OK', function(params) {
  successful_command = params[0];

  if (successful_command === 'CREATE') {
    current_state = 'waiting';
    game_name = params[1];
  }

  console.log("WHAT THE SHIT", current_message_component);

  prompt(current_state);

});

myEmitter.on('ERR', params => {
  console.log("ERR " + params[0])
});
