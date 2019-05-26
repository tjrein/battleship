const net = require('net');
var keypress = require('keypress');

let buffered = '';

const socket = net.createConnection({ port: 9000, host: 'localhost' });

keypress(process.stdin);

socket.on('connect', () => {
  socket.on('data', data => {
    console.log(data.length);
    console.log("DATA", data.toString('UTF8'))
    buffered += data;
    processReceived();
  });
});

function processReceived() {
  var received = buffered.split('\n');
  while (received.length > 1) {
    console.log(received[0]);
    buffered = received.slice(1).join('\n');
    received = buffered.split('\n');
  }
}


process.stdin.on('keypress', function (ch, key) {
  console.log('got "keypress"', key);
  if (key && key.ctrl && key.name == 'c') {
    process.stdin.pause();
    socket.end()
  }

  if (key && key.name == 'return') {
    socket.write("TEST")
  }
});

process.stdin.setRawMode(true);
process.stdin.resume();
