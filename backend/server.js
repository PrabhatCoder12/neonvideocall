const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const JWT_SECRET = 'your_super_secret_key';
const activeUsers = new Map(); // socket.id -> userId

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  activeUsers.set(socket.id, socket.userId);
  
  // Broadcast online users list
  io.emit('online-users', Array.from(activeUsers.entries()));

  // WebRTC Signaling: Call User (Offer)
  socket.on('call-user', (data) => {
    io.to(data.to).emit('call-made', {
      offer: data.offer,
      socket: socket.id,
      fromUser: data.fromUser
    });
  });

  // WebRTC Signaling: Make Answer
  socket.on('make-answer', (data) => {
    io.to(data.to).emit('answer-made', {
      socket: socket.id,
      answer: data.answer
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate-received', {
      socket: socket.id,
      candidate: data.candidate
    });
  });

  // WebRTC Signaling: Hang up / Disconnect peer
  socket.on('hang-up', (data) => {
    io.to(data.to).emit('call-hung-up', {
      socket: socket.id
    });
  });

  // Chat message broadcasting between peers
  socket.on('send-message', (data) => {
    io.to(data.to).emit('receive-message', {
      from: socket.userId,
      text: data.text
    });
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('online-users', Array.from(activeUsers.entries()));
    socket.broadcast.emit('call-hung-up', { socket: socket.id });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));