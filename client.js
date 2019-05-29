const net = require('net');
const EventEmitter = require('events');
var keypress = require('keypress');

let buffered = '';
let message = '';

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
  }
}

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

function welcome() {
  console.log("==========BATTLESHIP========");
  console.log("Available Options (enter number to execute)");
  console.log("1) Create Game");
  console.log("2) Join Game");
}

//keypress(process.stdin);

socket.on('connect', () => {
  welcome();
  current_state = 'connected';

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

      readline.question('Enter parameters (space separated): ' + param_string + ' > ', param_input => {
        message += param_input;
        message += '\n';
        socket.write(message);
      });
    } else {
      message += "\n";
      socket.write(message);
    }
  });

  //readline.prompt();

  //readline.on('line', input => {
  //  valid_inputs = inputs_for_state[current_state];
  //  if (input in valid_inputs) {
  //      command = valid_inputs[input].command
  //      console.log("command", command)
  //  }
  //});


  socket.on('data', data => {
    messages = data.toString('UTF8').trim().split('\n');

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

process.stdin.on('keypress', function (ch, key) {
  message += ch
  if (key && key.ctrl && key.name == 'c') {
    process.stdin.pause();
    socket.end()
  }

  if (key && key.name == 'enter') {
    socket.write(message);
    message = '';
  }

});

myEmitter.on('OK', function(params) {
  console.log("OK " + params[0])
});
