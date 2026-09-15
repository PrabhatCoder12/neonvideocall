const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const JWT_SECRET = process.env.JWT_SECRET || 'neon_super_secret_key';

// In-memory user database (For production, use MongoDB or PostgreSQL)
const users = [
  { userId: 'admin', password: bcrypt.hashSync('admin123', 8), role: 'admin' }
];

// --- AUTH ROUTES ---
app.post('/api/signup', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res.status(400).json({ error: 'User ID and password are required' });
    }

    const existingUser = users.find(u => u.userId === userId);
    if (existingUser) {
      return res.status(400).json({ error: 'User ID already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 8);
    const newUser = { userId, password: hashedPassword, role: 'user' };
    users.push(newUser);

    const token = jwt.sign({ userId: newUser.userId, role: newUser.role }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, userId: newUser.userId, role: newUser.role });
  } catch (err) {
    res.status(500).json({ error: 'Server error during signup' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    const user = users.find(u => u.userId === userId);
    if (!user) {
      return res.status(400).json({ error: 'Invalid User ID or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid User ID or password' });
    }

    const token = jwt.sign({ userId: user.userId, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, userId: user.userId, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Admin Route to view users
app.get('/api/admin/users', (req, res) => {
  const tokenHeader = req.headers.authorization;
  if (!tokenHeader) return res.status(401).json({ error: 'No token provided' });
  try {
    const token = tokenHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const safeUsers = users.map(u => ({ userId: u.userId, role: u.role }));
    res.json(safeUsers);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Admin Route to delete user
app.delete('/api/admin/users/:userId', (req, res) => {
  const tokenHeader = req.headers.authorization;
  if (!tokenHeader) return res.status(401).json({ error: 'No token provided' });
  try {
    const token = tokenHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    const targetId = req.params.userId;
    const index = users.findIndex(u => u.userId === targetId);
    if (index === -1) return res.status(404).json({ error: 'User not found' });
    if (users[index].role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });

    users.splice(index, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- SOCKET.IO SIGNALING ---
let activeUsers = new Map(); // socket.id -> userId

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.userId;
  activeUsers.set(socket.id, userId);
  
  io.emit('online-users', Array.from(activeUsers.entries()));

  socket.on('call-user', (data) => {
    io.to(data.to).emit('call-made', {
      offer: data.offer,
      socket: socket.id,
      fromUser: userId
    });
  });

  socket.on('make-answer', (data) => {
    io.to(data.to).emit('answer-made', {
      socket: socket.id,
      answer: data.answer
    });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate-received', {
      socket: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('hang-up', (data) => {
    io.to(data.to).emit('call-hung-up', { socket: socket.id });
  });

  socket.on('send-message', (data) => {
    io.to(data.to).emit('receive-message', {
      from: userId,
      text: data.text
    });
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('online-users', Array.from(activeUsers.entries()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});