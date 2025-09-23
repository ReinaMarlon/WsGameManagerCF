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
    websocket: `wss://wsgamemanagercf.railway.app`,
    rooms: Object.keys(rooms).length 
  });
});

// Health check para Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

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

function broadcastToRoom(roomCode, msg) {
  if (!rooms[roomCode]) {
    console.log(`❌ Sala ${roomCode} no existe para broadcast`);
    return;
  }
  
  console.log(`📢 Enviando a sala ${roomCode}:`, msg.type);
  
  rooms[roomCode].players.forEach((player) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(JSON.stringify(msg));
      } catch (error) {
        console.error("❌ Error enviando mensaje:", error);
      }
    }
  });
}

// WebSocket connection handling
wss.on("connection", (ws, req) => {
  console.log("🔗 Nueva conexión de cliente");
  
  // Información del cliente (útil para debugging)
  const clientIP = req.socket.remoteAddress;
  console.log(`📍 Cliente conectado desde: ${clientIP}`);

  ws.on("close", (code, reason) => {
    console.log(`🔗 Cliente desconectado. Código: ${code}, Razón: ${reason}`);

    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.ws === ws);

      if (playerIndex === -1) continue;

      const player = room.players[playerIndex];

      if (player.id === room.hostId) {
        console.log(`🛑 Host ${player.username} desconectó, cerrando sala ${roomCode}`);

        // Notificar a otros jugadores
        room.players.forEach(p => {
          if (p.ws !== ws && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({ type: "host_disconnected" }));
          }
        });

        delete rooms[roomCode];

      } else {
        console.log(`🛑 Jugador ${player.username} eliminado de la sala ${roomCode}`);
        room.players.splice(playerIndex, 1);

        // Notificar actualización de sala
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
      break;
    }
  });

  ws.on("error", (error) => {
    console.error("❌ Error en WebSocket:", error);
  });

  ws.on("message", async (message) => {
    try {
      console.log("📩 Mensaje recibido:", message.toString());

      let data;
      try {
        data = JSON.parse(message);
      } catch (e) {
        console.log("⚠️ Mensaje inválido, no es JSON");
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      switch (data.type) {
        case "create_room":
          const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          rooms[roomCode] = { 
            players: [], 
            hostId: data.hostId,
            createdAt: new Date().toISOString()
          };

          const newPlayer = {
            id: data.hostId,
            username: data.username,
            ws: ws,
            character_texture: data.character_texture || "res://Assets/UI-Items/Room/default_character.png",
            profile_texture: data.profile_texture || "res://Assets/UI-Items/Room/default_profile.png",
            status_texture: data.status_texture || "res://Assets/UI-Items/Room/notReady.png"
          };

          rooms[roomCode].players.push(newPlayer);

          ws.send(JSON.stringify({ 
            type: "room_created", 
            room_code: roomCode, 
            host_id: data.hostId 
          }));
          
          console.log(`🎉 Sala creada: ${roomCode} por ${data.username}`);
          break;

        case "join_room":
          if (!rooms[data.room_code]) {
            console.log(`❌ Sala ${data.room_code} no existe`);
            ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
            return;
          }

          if (rooms[data.room_code].players.length >= 4) { // Límite de jugadores
            ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
            return;
          }

          const joiningPlayer = {
            id: data.playerId || data.hostId, // Cambiado para consistencia
            username: data.username,
            ws: ws,
            character_texture: data.character_texture || "res://Assets/UI-Items/Room/default_character.png",
            profile_texture: data.profile_texture || "res://Assets/UI-Items/Room/default_profile.png",
            status_texture: data.status_texture || "res://Assets/UI-Items/Room/notReady.png"
          };

          rooms[data.room_code].players.push(joiningPlayer);

          console.log(`👤 ${data.username} se unió a la sala [${data.room_code}]`);

          // Confirmar al jugador que se unió
          ws.send(JSON.stringify({
            type: "room_joined",
            room_code: data.room_code,
            players: rooms[data.room_code].players.map(p => ({
              id: p.id,
              username: p.username,
              character_texture: p.character_texture,
              profile_texture: p.profile_texture,
              status_texture: p.status_texture
            }))
          }));

          // Notificar a todos en la sala
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

        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;

        default:
          console.log(`⚠️ Tipo de mensaje desconocido: ${data.type}`);
          ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
      }
    } catch (error) {
      console.error("❌ Error procesando mensaje:", error);
      ws.send(JSON.stringify({ type: "error", message: "Internal server error" }));
    }
  });

  // Enviar mensaje de bienvenida
  ws.send(JSON.stringify({ 
    type: "connected", 
    message: "Connected to Cursed Fate server",
    timestamp: Date.now()
  }));
});

// Manejar cierre graceful
process.on('SIGINT', () => {
  console.log('🛑 Cerrando servidor...');
  wss.close(() => {
    console.log('✅ WebSocket server closed');
    process.exit(0);
  });
});