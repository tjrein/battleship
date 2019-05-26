const net = require('net');
const EventEmitter = require('events');
var keypress = require('keypress');

let buffered = '';
let message = '';

const commands = ['OK', 'ERR']

class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const socket = net.createConnection({ port: 9000, host: 'localhost' });

keypress(process.stdin);

socket.on('connect', () => {
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


function processReceived() {
  var received = buffered.split('\n');
  while (received.length > 1) {
    console.log(received[0]);
    buffered = received.slice(1).join('\n');
    received = buffered.split('\n');
  }
}




//process.stdin.setRawMode(true);
//process.stdin.resume();
