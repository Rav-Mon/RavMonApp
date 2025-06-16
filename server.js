const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const users = {};
const messages = [];

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  socket.on('login', username => {
    if (users[username] && users[username].connected) {
      socket.emit('login-failed', 'User is already logged in.');
      return;
    }
    users[username] = { socketId: socket.id, connected: true, peerId: null };
    socket.username = username;
    socket.emit('login-success', { username, messages });
    io.emit('user-status', users);
    console.log(`${username} logged in`);
  });

  socket.on('peer-id', peerId => {
    if (socket.username && users[socket.username]) {
      users[socket.username].peerId = peerId;
      console.log(`${socket.username} peer ID: ${peerId}`);
    }
  });

  socket.on('check-peer', (to, callback) => {
    const user = users[to];
    callback({ available: user && user.connected && user.peerId, peerId: user ? user.peerId : null });
  });

  socket.on('call-user', ({ to, type, offer, username }) => {
    const user = users[to];
    if (user && user.connected) {
      io.to(user.socketId).emit('call-user', { from: users[username].peerId, username, type, offer });
    } else {
      socket.emit('call-failed', `${to} is not available.`);
    }
  });

  socket.on('accept-call', ({ to }) => {
    const user = users[to];
    if (user && user.connected) io.to(user.socketId).emit('call-accepted');
  });

  socket.on('reject-call', ({ to }) => {
    const user = users[to];
    if (user && user.connected) io.to(user.socketId).emit('call-rejected');
  });

  socket.on('end-call', ({ to }) => {
    const user = users[to];
    if (user && user.connected) io.to(user.socketId).emit('call-ended');
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const user = users[to];
    if (user && user.connected) io.to(user.socketId).emit('ice-candidate', { candidate });
  });

  socket.on('message', ({ username, text, file, fileName }) => {
    const message = {
      id: Date.now().toString(),
      username,
      text: text || '',
      file: file || null,
      fileName: fileName || null,
      timestamp: new Date().toISOString()
    };
    messages.push(message);
    io.emit('message', message);
    io.emit('messages-updated', messages);
  });

  socket.on('delete-message', id => {
    const index = messages.findIndex(msg => msg.id === id);
    if (index !== -1 && messages[index].username === socket.username) {
      messages.splice(index, 1);
      io.emit('messages-updated', messages);
    }
  });

  socket.on('profile-pic', ({ username, image }) => {
    if (users[username]) {
      users[username].profilePic = image;
      io.emit('profile-pic-updated', { username, image });
    }
  });

  socket.on('disconnect', () => {
    if (socket.username && users[socket.username]) {
      users[socket.username].connected = false;
      io.emit('user-status', users);
      console.log(`${socket.username} disconnected`);
    }
  });
});

const tryPort = (port, callback) => {
  const testServer = http.createServer();
  testServer.listen(port, () => {
    testServer.close();
    callback(null, port);
  });
  testServer.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying ${port + 1}`);
      tryPort(port + 1, callback);
    } else {
      callback(err);
    }
  });
};

const PORT = process.env.PORT || 3000;
tryPort(PORT, (err, selectedPort) => {
  if (err) {
    console.error('Failed to find available port:', err.message);
    process.exit(1);
  }
  server.listen(selectedPort, () => {
    console.log(`Server running on port ${selectedPort}`);
  });
});