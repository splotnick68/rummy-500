const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Game = require('./game/Game');
const { playBotTurn } = require('./game/bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

const games = new Map(); // roomCode -> Game
const socketToPlayer = new Map(); // socket.id -> { roomCode, playerId }

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (games.has(code));
  return code;
}

function broadcastState(roomCode) {
  const game = games.get(roomCode);
  if (!game) return;
  for (const player of game.players) {
    if (player.isBot) continue;
    io.to(player.id).emit('state', game.getStateFor(player.id));
  }
}

// Broadcasts the current state, then lets bots take their turn(s) automatically.
function update(roomCode) {
  broadcastState(roomCode);
  scheduleBotTurnIfNeeded(roomCode);
}

function scheduleBotTurnIfNeeded(roomCode) {
  const game = games.get(roomCode);
  if (!game || game.phase !== 'playing') return;
  const current = game.currentPlayer();
  if (!current || !current.isBot) return;
  setTimeout(() => {
    const g = games.get(roomCode);
    if (!g || g.phase !== 'playing') return;
    const bot = g.currentPlayer();
    if (!bot || !bot.isBot) return;
    try {
      playBotTurn(g, bot.id);
    } catch (err) {
      console.error(`Bot turn error in room ${roomCode}:`, err);
    }
    broadcastState(roomCode);
    scheduleBotTurnIfNeeded(roomCode);
  }, 900 + Math.random() * 700);
}

function withErrorHandling(socket, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      socket.emit('error-message', err.message || 'Something went wrong');
    }
  };
}

io.on('connection', (socket) => {
  socket.on(
    'create-room',
    withErrorHandling(socket, (name) => {
      const roomCode = makeRoomCode();
      const game = new Game(roomCode);
      game.addPlayer(socket.id, name);
      games.set(roomCode, game);
      socketToPlayer.set(socket.id, { roomCode, playerId: socket.id });
      socket.join(roomCode);
      socket.emit('joined', { roomCode, playerId: socket.id });
      broadcastState(roomCode);
    })
  );

  socket.on(
    'join-room',
    withErrorHandling(socket, ({ roomCode, name }) => {
      roomCode = (roomCode || '').toUpperCase().trim();
      const game = games.get(roomCode);
      if (!game) throw new Error('Room not found');
      game.addPlayer(socket.id, name);
      socketToPlayer.set(socket.id, { roomCode, playerId: socket.id });
      socket.join(roomCode);
      socket.emit('joined', { roomCode, playerId: socket.id });
      broadcastState(roomCode);
    })
  );

  socket.on(
    'start-game',
    withErrorHandling(socket, () => {
      const info = socketToPlayer.get(socket.id);
      if (!info) throw new Error('Not in a room');
      const game = games.get(info.roomCode);
      if (game.hostId !== socket.id) throw new Error('Only the host can start the game');
      game.startGame();
      update(info.roomCode);
    })
  );

  socket.on(
    'draw-stock',
    withErrorHandling(socket, () => {
      const { roomCode, playerId } = requireInfo(socket);
      games.get(roomCode).drawFromStock(playerId);
      update(roomCode);
    })
  );

  socket.on(
    'draw-discard',
    withErrorHandling(socket, (cardId) => {
      const { roomCode, playerId } = requireInfo(socket);
      games.get(roomCode).drawFromDiscard(playerId, cardId);
      update(roomCode);
    })
  );

  socket.on(
    'meld',
    withErrorHandling(socket, (cardIds) => {
      const { roomCode, playerId } = requireInfo(socket);
      games.get(roomCode).meldCards(playerId, cardIds);
      update(roomCode);
    })
  );

  socket.on(
    'layoff',
    withErrorHandling(socket, ({ meldId, cardIds }) => {
      const { roomCode, playerId } = requireInfo(socket);
      games.get(roomCode).layOff(playerId, meldId, cardIds);
      update(roomCode);
    })
  );

  socket.on(
    'discard',
    withErrorHandling(socket, (cardId) => {
      const { roomCode, playerId } = requireInfo(socket);
      games.get(roomCode).discardCard(playerId, cardId);
      update(roomCode);
    })
  );

  socket.on(
    'next-round',
    withErrorHandling(socket, () => {
      const { roomCode } = requireInfo(socket);
      games.get(roomCode).continueToNextRound();
      update(roomCode);
    })
  );

  socket.on(
    'add-bot',
    withErrorHandling(socket, () => {
      const info = socketToPlayer.get(socket.id);
      if (!info) throw new Error('Not in a room');
      const game = games.get(info.roomCode);
      if (game.hostId !== socket.id) throw new Error('Only the host can add computer players');
      game.addBotPlayer();
      broadcastState(info.roomCode);
    })
  );

  socket.on(
    'remove-player',
    withErrorHandling(socket, (targetId) => {
      const info = socketToPlayer.get(socket.id);
      if (!info) throw new Error('Not in a room');
      const game = games.get(info.roomCode);
      if (game.hostId !== socket.id) throw new Error('Only the host can remove players');
      game.removePlayerFromLobby(targetId);
      broadcastState(info.roomCode);
    })
  );

  socket.on('disconnect', () => {
    const info = socketToPlayer.get(socket.id);
    if (!info) return;
    const game = games.get(info.roomCode);
    if (game) {
      game.removePlayer(info.playerId);
      broadcastState(info.roomCode);
    }
    socketToPlayer.delete(socket.id);
  });

  function requireInfo(socket) {
    const info = socketToPlayer.get(socket.id);
    if (!info || !games.has(info.roomCode)) throw new Error('Not in an active game');
    return info;
  }
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`Rummy 500 server running at http://localhost:${PORT}`);
});
