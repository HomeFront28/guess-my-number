const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
});
app.use(express.static("public"));
const rooms = {};
const disconnectTimers = {};

io.on("connection", (socket) => {
  socket.on("createRoom", (playerName) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = {
      players: [{ id: socket.id, name: playerName, number: null }],
      currentTurn: 0,
      ranges: { p1: [1, 200], p2: [1, 200] },
    };
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
    socket.join(roomCode);
    socket.emit("roomJoined", roomCode);
    io.to(roomCode).emit("gameReady", {
      p1: room.players[0].name,
      p2: room.players[1].name,
    });
  });

  socket.on("rejoin", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) { socket.emit("rejoinFailed"); return; }
    const playerIndex = room.players.findIndex((p) => p.name === playerName);
    if (playerIndex === -1) { socket.emit("rejoinFailed"); return; }
    if (disconnectTimers[roomCode + playerName]) {
      clearTimeout(disconnectTimers[roomCode + playerName]);
      delete disconnectTimers[roomCode + playerName];
    }
    room.players[playerIndex].id = socket.id;
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
        guesserName, targetName, guess, result,
        p1Number: room.players[0].number,
        p2Number: room.players[1].number,
        p1Name: room.players[0].name,
        p2Name: room.players[1].name,
      });
      return;
    } else if (guess < targetNumber) {
      result = "higher";
    } else {
      result = "lower";
    }
    room.currentTurn = targetIndex;
    io.to(roomCode).emit("guessResult", {
      guesserName, targetName, guess, result,
      nextTurn: room.players[targetIndex].name,
    });
  });

  socket.on("playAgain", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.players.forEach((p) => (p.number = null));
    room.currentTurn = 0;
    room.ranges = { p1: [1, 200], p2: [1, 200] };
    io.to(roomCode).emit("restartGame");
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        io.to(code).emit("opponentDisconnected", player.name);
        disconnectTimers[code + player.name] = setTimeout(() => {
          io.to(code).emit("playerLeft");
          delete rooms[code];
          delete disconnectTimers[code + player.name];
        }, 30000);
      }
    }
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));