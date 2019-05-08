const mongoose = require('mongoose');
const express = require('express');
const winston = require('winston');
const { combine, timestamp, label, printf } = winston.format;

const appStartTime = Date.now();

//
// Logger's
//

const logFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

const webLogger = winston.createLogger({
  format: combine(
    label({ label: 'web   ' }),
    timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs\\web.log' })
  ]
});

const dbLogger = winston.createLogger({
  format: combine(
    label({ label: 'db    ' }),
    timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs\\database.log' })
  ]
});

const socketLogger = winston.createLogger({
  format: combine(
    label({ label: 'socket' }),
    timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs\\socket.log' })
  ]
});

//
// Database
//

//                 [vvv] Secret information [vvv]
const dbUrl = 'mongodb://user:123456@localhost:27017/test';
const dbOptions = { useNewUrlParser: true };

mongoose.connect(dbUrl, dbOptions, function(err) {
  if (err) throw err;

  const connectionTime = Date.now();

  dbLogger.info(
    'Sucessfully connected to database in '
    + ((connectionTime - appStartTime) / 1000) + 's'
  );
});

const Message = mongoose.model('Message', {
  name: String,
  message: String
});

//
// Web-server
//

const app = express();
app.use(require('helmet')());
app.use(require('morgan')(function(tokens, req, res) {
  // Ignore cached responses, or what is it?
  if (tokens.status(req, res) == '304') return;

  // Will produce out like "GET / 200 | 1 bytes in 0.000 ms"
  webLogger.info([
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.status(req, res), '|',
    tokens.res(req, res, 'content-length'), 'bytes in',
    tokens['response-time'](req, res), 'ms'
  ].join(' '));
}));
app.use(express.static('./web-static'));
app.use(require('body-parser').json());
app.use(require('body-parser').urlencoded({ extended: false }));

app.get('/messages', function(req, res) {
  Message.find({}, (err, messages) => res.send(messages));
});

//
// Socket.IO server
//

const http = require('http').Server(app);
const io = require('socket.io')(http);

io.on('connection', function(socket) {
  socketLogger.info('Received a connection; IP - ' + socket.handshake.address);
  let antiFlood = 0;

  socket.on('message', function(msg) {
    // Anti-flood system. Cooldown must be in milliseconds.
    if ((Date.now() - antiFlood) < 2000) return;
    antiFlood = Date.now();

    // Some magic.
    if (!msg || !msg.name || !msg.message) return;
    msg.name = msg.name.toString().replace(/\s/g, ' ');
    msg.message = msg.message.toString().replace(/\s/g, ' ');
    if (msg.name.length === 0 || msg.message.length === 0) return;
    if (msg.name.length > 30 || msg.message.length > 100) return;

    // Log.
    socketLogger.info('Got message: [' + msg.name + '] ' + msg.message);

    // Save message in database.
    const message = new Message(msg);
    message.save(() => io.emit('message', { msg: msg }));
  });

  socket.on('disconnect', function() {
    socketLogger.info('Client disconnected; IP - ' + socket.handshake.address);
  });
});

//
// Start web-server
//

http.listen(process.env.PORT || 8080, function() {
  const startTime = Date.now();

  webLogger.info(
    'Sucessfully started web-server in '
    + ((startTime - appStartTime) / 1000) + 's'
  );
});
