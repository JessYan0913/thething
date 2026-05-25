
const http = require('http');
const next = require('./server.js');

const port = parseInt(process.argv.find(a => a === '-p')
  ? process.argv[process.argv.indexOf('-p') + 1] : '3456');

const server = http.createServer(next);
server.listen(port === 0 ? 0 : port, '127.0.0.1', () => {
  const addr = server.address();
  console.log('THETHING_PORT=' + addr.port);
  console.log('THETHING_READY');
});
