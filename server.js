
const net = require('net');
const server = net.createServer();

var clients = [];

const port = 8000;
const host = '127.0.0.1';

server.listen(port, host, () => {
    console.log('TCP Server is running on port ' + port +'.');
});

server.on('connection', socket => {
  console.log('new client arrived');
  socket.write(Buffer.from('Hello World'));
});
