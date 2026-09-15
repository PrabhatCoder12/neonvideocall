require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_neon_key_2026';

app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/neondb';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.log('MongoDB Connection Error:', err));

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

// Auto-seed Admin Account & Demo Users
const seedUsers = async () => {
  try {
    // Create Admin User
    const adminExists = await User.findOne({ userId: 'admin' });
    if (!adminExists) {
      const adminPass = await bcrypt.hash('Heybro12..', 10);
      await User.create({ userId: 'admin', password: adminPass, role: 'admin' });
      console.log('Admin account created: admin / Heybro12..');
    }

    // Seed Demo Users
    for (let i = 1; i <= 5; i++) {
      const id = `user${i.toString().padStart(2, '0')}`;
      const pass = `pass${i.toString().padStart(2, '0')}`;
      const exists = await User.findOne({ userId: id });
      if (!exists) {
        const hashed = await bcrypt.hash(pass, 10);
        await User.create({ userId: id, password: hashed, role: 'user' });
      }
    }
  } catch (err) {
    console.log('Seeding status:', err.message);
  }
};
seedUsers();

// Middleware: Verify Admin Access
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Admin privileges required' });
    }
    req.user = decoded;
    next();
  });
};

// Signup Endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ error: 'User ID and password are required' });

    const existingUser = await User.findOne({ userId });
    if (existingUser) return res.status(400).json({ error: 'User ID already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ userId, password: hashedPassword, role: 'user' });
    const token = jwt.sign({ userId: newUser.userId, role: newUser.role }, JWT_SECRET);

    res.json({ token, userId: newUser.userId, role: newUser.role });
  } catch (err) {
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// Login Endpoint
app.post('/api/login', async (req, res) => {
  const { userId, password } = req.body;
  const user = await User.findOne({ userId });
  if (!user) return res.status(400).json({ error: 'User not found' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ userId: user.userId, role: user.role }, JWT_SECRET);
  res.json({ token, userId: user.userId, role: user.role });
});

// ADMIN: Get All Users
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, 'userId role');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ADMIN: Delete a User
app.delete('/api/admin/users/:targetUserId', verifyAdmin, async (req, res) => {
  try {
    const { targetUserId } = req.params;
    if (targetUserId === 'admin') {
      return res.status(400).json({ error: 'Cannot delete primary admin account' });
    }
    await User.deleteOne({ userId: targetUserId });
    res.json({ message: `User ${targetUserId} deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Authentication error"));
    socket.userId = decoded.userId;
    next();
  });
});

io.on('connection', (socket) => {
  onlineUsers.set(socket.id, socket.userId);
  io.emit('online-users', Array.from(onlineUsers.entries()));

  socket.on('call-user', (data) => {
    io.to(data.to).emit('call-made', { offer: data.offer, socket: socket.id, fromUser: socket.userId });
  });

  socket.on('make-answer', (data) => {
    io.to(data.to).emit('answer-made', { socket: socket.id, answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate-received', { socket: socket.id, candidate: data.candidate });
  });

  socket.on('send-message', (data) => {
    io.to(data.to).emit('receive-message', { from: socket.userId, text: data.text });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('online-users', Array.from(onlineUsers.entries()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));