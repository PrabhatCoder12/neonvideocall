const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const JWT_SECRET = 'neon_connect_super_secret_key_2026';

// In-memory user store
// Admin Credentials: ID -> admin, Password -> Heybro12..
const users = {
  'admin': { password: 'Heybro12..', role: 'admin' }
};

const onlineUsers = new Map();

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

app.post('/api/signup', (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) {
    return res.status(400).json({ error: 'User ID and password are required' });
  }
  if (users[userId]) {
    return res.status(400).json({ error: 'User ID already exists' });
  }

  users[userId] = { password, role: 'user' };
  const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET);
  res.json({ token, userId, role: 'user' });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const user = users[userId];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid User ID or password' });
  }

  const token = jwt.sign({ userId, role: user.role }, JWT_SECRET);
  res.json({ token, userId, role: user.role });
});

// Admin route updated to send passwords as well
app.get('/api/admin/users', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const userList = Object.keys(users).map(id => ({
    userId: id,
    password: users[id].password,
    role: users[id].role
  }));
  res.json(userList);
});

app.delete('/api/admin/users/:userId', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const targetId = req.params.userId;
  if (!users[targetId]) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (users[targetId].role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete admin account' });
  }

  delete users[targetId];
  res.json({ message: 'User deleted successfully' });
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = decoded;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.userId;
  onlineUsers.set(socket.id, userId);
  updateOnlineUsers();

  socket.on('call-user', ({ to, offer }) => {
    io.to(to).emit('call-made', { offer, socket: socket.id, fromUser: userId });
  });

  socket.on('make-answer', ({ to, answer }) => {
    io.to(to).emit('answer-made', { socket: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate-received', { socket: socket.id, candidate });
  });

  socket.on('hang-up', ({ to }) => {
    io.to(to).emit('call-hung-up');
  });

  socket.on('send-message', ({ to, text }) => {
    io.to(to).emit('receive-message', { from: userId, text });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    updateOnlineUsers();
  });
});

function updateOnlineUsers() {
  io.emit('online-users', Array.from(onlineUsers.entries()));
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`NeonConnect Server running on port ${PORT}`);
});