const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const app = express();
const server = http.createServer(app);

// 1. Increased timeouts for better stability on free hosting like Render
const io = socketio(server, {
  pingTimeout: 120000, // 2 minutes
  pingInterval: 30000,
  transports: ["websocket", "polling"]
});

app.use(express.static("public"));

const rooms = {};
const disconnectTimers = {};
// 2. Map socket IDs to player info for instant lookup on disconnect
const socketToPlayer = {}; 

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("createRoom", (playerName) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = {
      players: [{ id: socket.id, name: playerName, number: null }],
      currentTurn: 0,
      ranges: { p1: [1, 100], p2: [1, 100] },
    };
    
    // Store session info
    socketToPlayer[socket.id] = { roomCode, playerName };
    
    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
  });

  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room || room.players.length >= 2) {
      socket.emit("joinError", "Room not found or full");
      return;
    }
    
    room.players.push({ id: socket.id, name: playerName, number: null });
    
    // Store session info
    socketToPlayer[socket.id] = { roomCode, playerName };

    socket.join(roomCode);
    socket.emit("roomJoined", roomCode);
    io.to(roomCode).emit("gameReady", {
      p1: room.players[0].name,
      p2: room.players[1].name,
    });
  });

  socket.on("rejoin", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("rejoinFailed");
      return;
    }

    const playerIndex = room.players.findIndex((p) => p.name === playerName);
    if (playerIndex === -1) {
      socket.emit("rejoinFailed");
      return;
    }

    // Cancel the "delete room" countdown because they're back!
    if (disconnectTimers[roomCode + playerName]) {
      clearTimeout(disconnectTimers[roomCode + playerName]);
      delete disconnectTimers[roomCode + playerName];
    }

    // Update with new socket ID
    room.players[playerIndex].id = socket.id;
    socketToPlayer[socket.id] = { roomCode, playerName };
    
    socket.join(roomCode);
    io.to(roomCode).emit("opponentReconnected");
    
    socket.emit("rejoinSuccess", {
      roomCode,
      p1: room.players[0].name,
      p2: room.players[1].name,
      currentTurnIndex: room.currentTurn,
      myNumber: room.players[playerIndex].number,
    });
  });

  socket.on("setNumber", ({ roomCode, number }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex === -1) return;
    room.players[playerIndex].number = number;
    if (room.players.every((p) => p.number !== null)) {
      io.to(roomCode).emit("bothReady", room.players[0].name);
    }
  });

  socket.on("makeGuess", ({ roomCode, guess }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const guesserIndex = room.players.findIndex((p) => p.id === socket.id);
    if (guesserIndex === -1) return;
    
    const targetIndex = guesserIndex === 0 ? 1 : 0;
    const targetNumber = room.players[targetIndex].number;
    const guesserName = room.players[guesserIndex].name;
    const targetName = room.players[targetIndex].name;
    
    let result;
    if (guess === targetNumber) {
      result = "correct";
      io.to(roomCode).emit("guessResult", {
        guesserName,
        targetName,
        guess,
        result,
        p1Number: room.players[0].number,
        p2Number: room.players[1].number,
        p1Name: room.players[0].name,
        p2Name: room.players[1].name,
      });
    } else {
      result = guess < targetNumber ? "higher" : "lower";
      room.currentTurn = targetIndex;
      io.to(roomCode).emit("guessResult", {
        guesserName,
        targetName,
        guess,
        result,
        nextTurn: room.players[targetIndex].name,
      });
    }
  });

  socket.on("playAgain", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.players.forEach((p) => (p.number = null));
    room.currentTurn = 0;
    io.to(roomCode).emit("restartGame");
  });

  socket.on("disconnect", () => {
    const session = socketToPlayer[socket.id];
    if (!session) return;

    const { roomCode, playerName } = session;
    const room = rooms[roomCode];

    if (room) {
      // Notify the other player
      io.to(roomCode).emit("opponentDisconnected", playerName);

      // Start the 30-second grace period before killing the room
      disconnectTimers[roomCode + playerName] = setTimeout(() => {
        if (rooms[roomCode]) {
          io.to(roomCode).emit("playerLeft");
          delete rooms[roomCode];
          console.log(`Room ${roomCode} deleted due to inactivity.`);
        }
        delete disconnectTimers[roomCode + playerName];
      }, 30000);
    }

    // Clean up our mapping
    delete socketToPlayer[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));