const express = require("express");
const WebSocket = require("ws");
const { getAllCharacters, getCharactersByUser } = require("./server/characterService");


const app = express();
const PORT = process.env.PORT || 8080;

// 🔹 Usa el mismo server que Express
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌐 HTTP disponible en https://cursedfateserver.up.railway.app`);
  console.log(`📡 WS disponible en wss://cursedfateserver.up.railway.app`);
});

// 🔹 Atacha WebSocket al mismo server
const wss = new WebSocket.Server({ server });

let rooms = {};
let charactersCache = [];

// 🔹 Map de personajes bloqueados por sala
// roomsLocked[roomCode] = { characterId: playerId }
let roomsLocked = {};

// Cargar personajes al iniciar
(async () => {
  try {
    charactersCache = await getAllCharacters();
    console.log("🎮 Personajes cargados:", charactersCache.length);
  } catch (error) {
    console.error("❌ Error cargando personajes:", error);
  }
})();

// Middleware para archivos estáticos
app.use(express.static("public"));

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({
    status: 'Server running',
    websocket: `wss://wsgamemanagercf.up.railway.app`,
    rooms: Object.keys(rooms).length
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Función para obtener personajes de un jugador
async function handlePlayerJoin(userId) {
  try {
    const userCharacters = await getCharactersByUser(userId);
    console.log(`🧑‍💻 Personajes del usuario ${userId}:`, userCharacters.length);
    return userCharacters;
  } catch (error) {
    console.error("❌ Error obteniendo personajes:", error);
    return [];
  }
}

// Broadcast a todos en la sala
function broadcastToRoom(roomCode, msg) {
  if (!rooms[roomCode]) return;
  rooms[roomCode].players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      try { player.ws.send(JSON.stringify(msg)); }
      catch (error) { console.error("❌ Error enviando mensaje:", error); }
    }
  });
}

// 🔹 Lógica de selección de personaje (antes cardSelector.js)
function handleCharacterSelection(ws, rooms, data) {
  const { room_code, player_id, character_id, cp_image } = data;

  if (!rooms[room_code]) {
    ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
    return;
  }

  if (!roomsLocked[room_code]) roomsLocked[room_code] = {};

  // Verifica si el personaje ya está bloqueado
  if (roomsLocked[room_code][character_id]) {
    ws.send(JSON.stringify({
      type: "character_locked",
      character_id: character_id,
      locked_by: roomsLocked[room_code][character_id]
    }));
    return;
  }

  // Bloquea el personaje
  roomsLocked[room_code][character_id] = player_id;

  // Envía actualización a todos los jugadores
  rooms[room_code].players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: player.id === player_id ? "character_selected" : "character_locked",
        character_id: parseInt(character_id),
        player_id: player_id,
        cp_image: cp_image
      }));
    }
  });

  console.log(`🎯 Player ${player_id} seleccionó el personaje ${character_id} en sala ${room_code}`);
}

// Desbloquear personajes si un jugador se desconecta
function unlockCharactersOnDisconnect(room_code, player_id) {
  if (!roomsLocked[room_code]) return;

  const unlockedCharacters = [];

  for (const charId in roomsLocked[room_code]) {
    if (roomsLocked[room_code][charId] === player_id) {
      delete roomsLocked[room_code][charId];
      unlockedCharacters.push(charId);
      console.log(`🔓 Personaje ${charId} desbloqueado en sala ${room_code} por desconexión de ${player_id}`);
    }
  }

  // Notificar a todos los jugadores sobre los personajes desbloqueados
  if (unlockedCharacters.length > 0) {
    broadcastToRoom(room_code, {
      type: "characters_unlocked",
      character_ids: unlockedCharacters,
      player_id: player_id
    });
  }
}

// WebSocket connection
wss.on("connection", (ws, req) => {
  console.log("🔗 Nueva conexión de cliente:", req.socket.remoteAddress);

  ws.on("close", (code, reason) => {
    console.log(`🔗 Cliente desconectado. Código: ${code}, Razón: ${reason}`);

    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.ws === ws);
      if (playerIndex === -1) continue;

      const player = room.players[playerIndex];

      if (player.id === room.hostId) {
        console.log(`🛑 Host ${player.username} desconectó, cerrando sala ${roomCode}`);
        room.players.forEach(p => {
          if (p.ws !== ws && p.ws.readyState === WebSocket.OPEN)
            p.ws.send(JSON.stringify({ type: "host_disconnected" }));
        });
        // Desbloquear personajes antes de borrar la sala
        unlockCharactersOnDisconnect(roomCode, player.id);
        delete rooms[roomCode];

      } else {
        console.log(`🛑 Jugador ${player.username} eliminado de la sala ${roomCode}`);
        room.players.splice(playerIndex, 1);
        unlockCharactersOnDisconnect(roomCode, player.id);

        broadcastToRoom(roomCode, {
          type: "player_left",
          playerId: player.id,
          players: room.players.map(p => ({
            id: p.id,
            username: p.username,
            character_texture: p.character_texture,
            profile_texture: p.profile_texture,
            status_texture: p.status_texture
          }))
        });
      }
    }
  });


  ws.on("error", error => console.error("❌ Error en WebSocket:", error));

  ws.on("message", async (message) => {
    let data;
    try { data = JSON.parse(message); }
    catch (e) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    switch (data.type) {
      case "create_room":
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = { players: [], hostId: data.hostId, createdAt: new Date().toISOString() };

        const newPlayer = {
          id: data.hostId,
          username: data.username,
          ws: ws,
          character_texture: data.character_texture || "res://Assets/UI-Items/Room/default_character.png",
          profile_texture: data.profile_texture || "res://Assets/UI-Items/Room/default_profile.png",
          status_texture: data.status_texture || "res://Assets/UI-Items/Room/notReady.png"
        };
        rooms[roomCode].players.push(newPlayer);

        ws.send(JSON.stringify({ type: "room_created", room_code: roomCode, host_id: data.hostId }));
        console.log(`🎉 Sala creada: ${roomCode} por ${data.username}`);
        break;

      case "join_room":
        if (!rooms[data.room_code]) {
          ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
          return;
        }

        if (rooms[data.room_code].players.length >= 4) {
          ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
          return;
        }

        const joiningPlayer = {
          id: data.playerId || data.hostId,
          username: data.username,
          ws: ws,
          character_texture: data.character_texture || "res://Assets/UI-Items/Room/default_character.png",
          profile_texture: data.profile_texture || "res://Assets/UI-Items/Room/default_profile.png",
          status_texture: data.status_texture || "res://Assets/UI-Items/Room/notReady.png"
        };

        rooms[data.room_code].players.push(joiningPlayer);

        ws.send(JSON.stringify({
          type: "room_joined",
          room_code: data.room_code,
          host_id: rooms[data.room_code].hostId,
          players: rooms[data.room_code].players.map(p => ({
            id: p.id,
            username: p.username,
            character_texture: p.character_texture,
            profile_texture: p.profile_texture,
            status_texture: p.status_texture
          }))
        }));

        broadcastToRoom(data.room_code, {
          type: "room_update",
          players: rooms[data.room_code].players.map(p => ({
            id: p.id,
            username: p.username,
            character_texture: p.character_texture,
            profile_texture: p.profile_texture,
            status_texture: p.status_texture
          }))
        });
        break;
      case "player_ready":
        if (!rooms[data.room_code]) {
          ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
          return;
        }

        // Actualizar estado del jugador
        const player = rooms[data.room_code].players.find(p => p.id === data.player_id);
        if (player) {
          player.ready = data.ready;
        }

        // Broadcast a todos
        broadcastToRoom(data.room_code, {
          type: "player_ready",
          player_id: data.player_id,
          ready: data.ready
        });
        break;

      case "start_game":
        const room = rooms[data.room_code];
        if (!room || room.hostId !== data.host_id) {
          ws.send(JSON.stringify({ type: "error", message: "Not authorized" }));
          return;
        }

        // Verificar que todos tengan personajes y estén listos
        const gameData = {
          room_code: data.room_code,
          players: room.players.map(p => ({
            id: p.id,
            username: p.username,
            character_id: p.selected_character || null,
            ready: p.ready || false
          }))
        };

        // Enviar a todos los jugadores
        broadcastToRoom(data.room_code, {
          type: "game_starting",
          game_data: gameData
        });

        // Limpiar la sala después de iniciar
        delete rooms[data.room_code];
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        break;

      case "select_character":
        handleCharacterSelection(ws, rooms, data);
        break;

      default:
        ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
    }
  });

  ws.send(JSON.stringify({ type: "connected", message: "Connected to Cursed Fate server", timestamp: Date.now() }));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Cerrando servidor...');
  wss.close(() => {
    console.log('✅ WebSocket server closed');
    process.exit(0);
  });
});
