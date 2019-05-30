const net = require('net');
const EventEmitter = require('events');
var keypress = require('keypress');

let message = '';

//let current_state = 'disconnected';

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

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt_string(current_state) {
  test = '\nAvailable Options (enter number to execute)\n';
  options = {
    "connected": "1) Create Game\n2) Join Game",
    "waiting": "1) Leave Current Game"
  }[current_state]

  return test + options
}

function prompt(current_state) {
  console.log("\n==========BATTLESHIP PROTOCOL========");
  console.log(prompt_string(current_state));

  readline.question('> ', input => {
    let message = "";
    let command = "";
    let parameters = [];

    valid_inputs = inputs_for_state[current_state];
    if (input in valid_inputs) {
        command = valid_inputs[input].command
        parameters = valid_inputs[input].parameters
    }

    message += command + ' '

    if (parameters.length) {
      param_string = parameters.join(',')

      readline.question('Enter parameters (space separated): ' + param_string + '\n> ', param_input => {
        message += param_input;
        message += '\n';
        socket.write(message);
      });
    } else {
      message += "\n";
      socket.write(message);
    }
  });
}

//keypress(process.stdin);
socket.on('connect', () => {
  //welcome();
  let current_state = 'connected';

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
  console.log("OKAY HERE", command, parameters)
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
  console.log("OK " + params[0])
  prompt("waiting");
});

myEmitter.on('ERR', params => {
  console.log("ERR " + params[0])
});
