const path = require('path');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// SIMPLE in-memory stores (for prototype)
const users = {};        // userId -> { userId, username, socketId }
const sockets = {};      // socketId -> userId
const waitingQueue = []; // list of userIds waiting to be paired
const pairs = {};        // userId -> partnerUserId

// REST: simple login (username only)
app.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length === 0) {
    return res.status(400).json({ error: 'username required' });
  }
  const userId = uuidv4();
  users[userId] = { userId, username: username.trim(), socketId: null };
  return res.json({ userId, username: users[userId].username });
});

// Serve index.html for root (already from static folder)
// --- SOCKET.IO ---
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // client should send auth after connecting
  socket.on('auth', (payload) => {
    const { userId } = payload || {};
    if (!userId || !users[userId]) {
      // invalid auth: ask client to re-login
      socket.emit('auth_failed');
      return;
    }

    // attach socket
    users[userId].socketId = socket.id;
    sockets[socket.id] = userId;

    // notify presence
    socket.emit('auth_ok', { userId, username: users[userId].username });
    console.log(`User ${users[userId].username} authenticated with socket ${socket.id}`);
  });

  // find a partner (simple queue match)
  socket.on('find_partner', () => {
    const userId = sockets[socket.id];
    if (!userId || !users[userId]) return;

    // if already paired, send current partner
    if (pairs[userId]) {
      const partnerId = pairs[userId];
      const partner = users[partnerId];
      io.to(socket.id).emit('paired', { partnerId: partner.userId, partnerName: partner.username });
      return;
    }

    // if queue has someone, pair them
    if (waitingQueue.length > 0) {
      const otherId = waitingQueue.shift();
      if (otherId === userId) {
        // weird case, skip
        waitingQueue.push(otherId);
        return;
      }

      // create pair both ways
      pairs[userId] = otherId;
      pairs[otherId] = userId;

      const partner = users[otherId];
      const partnerSocket = partner && partner.socketId;

      // notify both
      io.to(socket.id).emit('paired', { partnerId: partner.userId, partnerName: partner.username });
      if (partnerSocket) {
        io.to(partnerSocket).emit('paired', { partnerId: users[userId].userId, partnerName: users[userId].username });
      }
      console.log(`Paired ${users[userId].username} <-> ${users[otherId].username}`);
    } else {
      // add to queue
      if (!waitingQueue.includes(userId)) waitingQueue.push(userId);
      io.to(socket.id).emit('waiting');
      console.log(`${users[userId].username} added to waiting queue`);
    }
  });

  // stop searching (optional)
  socket.on('stop_search', () => {
    const userId = sockets[socket.id];
    if (!userId) return;
    const idx = waitingQueue.indexOf(userId);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    io.to(socket.id).emit('search_stopped');
  });

  // typing event: forward to partner only
  socket.on('typing', (data) => {
    const userId = sockets[socket.id];
    if (!userId) return;
    const partnerId = pairs[userId];
    if (!partnerId) return;
    const partner = users[partnerId];
    if (!partner || !partner.socketId) return;
    io.to(partner.socketId).emit('typing', { text: data.text });
  });

  // optionally send 'stop_typing' for UI
  socket.on('stop_typing', () => {
    const userId = sockets[socket.id];
    if (!userId) return;
    const partnerId = pairs[userId];
    if (!partnerId) return;
    const partner = users[partnerId];
    if (!partner || !partner.socketId) return;
    io.to(partner.socketId).emit('stop_typing');
  });

  // disconnect handling
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    const userId = sockets[socket.id];
    if (!userId) return;

    // remove from queue if waiting
    const idx = waitingQueue.indexOf(userId);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    // if paired, notify partner and unpair
    const partnerId = pairs[userId];
    if (partnerId) {
      const partner = users[partnerId];
      if (partner && partner.socketId) {
        io.to(partner.socketId).emit('partner_disconnected');
      }
      // remove both entries
      delete pairs[partnerId];
      delete pairs[userId];
    }

    // clean socket mapping
    delete sockets[socket.id];
    if (users[userId]) users[userId].socketId = null;
  });
});

const PORT = process.env.PORT || 3000;
//server.listen(PORT, () => console.log(`Instalk server running on port ${PORT}`));
server.listen(PORT, "0.0.0.0", () => console.log(`Instalk server running on port ${PORT}`));
