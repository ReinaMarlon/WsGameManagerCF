// server.js
const WebSocket = require("ws");
const { getAllCharacters, getCharactersByUser } = require("./server/characterService");

const port = 3000;
const wss = new WebSocket.Server({ port });


let rooms = {};
let charactersCache = [];
(async () => {
  charactersCache = await getAllCharacters();
  console.log("🎮 Personajes cargados:", charactersCache.length);
})();

async function handlePlayerJoin(userId) {
  const userCharacters = await getCharactersByUser(userId);
  console.log(`🧑‍💻 Personajes del usuario ${userId}:`, userCharacters);
  return userCharacters;
}

function broadcastToRoom(roomCode, msg) {
  if (!rooms[roomCode]) return;
  console.log(`📢 Enviando a sala ${roomCode}:`, msg);
  for (let player of rooms[roomCode].players) {
    player.ws.send(JSON.stringify(msg));
  }
}

wss.on("listening", () => {
  console.log(`✅ Servidor WebSocket escuchando en ws://localhost:${port}`);
});

wss.on("connection", (ws) => {
  console.log("🔗 Nueva conexión de cliente");

  ws.on("close", () => {
    console.log("🔗 Cliente desconectado");

    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const index = room.players.findIndex(p => p.ws === ws);

      if (index === -1) continue;

      const player = room.players[index];

      if (player.id === room.hostId) {
        console.log(`🛑 Host ${player.username} desconectó, cerrando sala ${roomCode}`);

        for (const p of room.players) {
          if (p.ws !== ws) {
            p.ws.send(JSON.stringify({ type: "host_disconnected" }));
          }
        }

        delete rooms[roomCode];

      } else {
        console.log(`🛑 Jugador ${player.username} eliminado de la sala ${roomCode}`);
        room.players.splice(index, 1);

        for (const p of room.players) {
          p.ws.send(JSON.stringify({
            type: "player_left",
            id: player.id
          }));
        }
      }

      break;
    }
  });



  ws.on("message", (message) => {
    console.log("📩 Mensaje recibido:", message.toString());

    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log("⚠️  Mensaje inválido, no es JSON:", message);
      return;
    }

    switch (data.type) {
      case "create_room":
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = { players: [], hostId: data.hostId };

        const newPlayer = {
          id: data.hostId,
          username: data.username,
          ws: ws,
          character_texture: "res://Assets/UI-Items/Room/default_character.png",
          profile_texture: "res://Assets/UI-Items/Room/default_profile.png",
          status_texture: "res://Assets/UI-Items/Room/notReady.png"
        };

        rooms[roomCode].players.push(newPlayer);

        ws.send(JSON.stringify({ type: "room_created", room_code: roomCode, host_id: data.hostId }));
        console.log(`🎉 Sala creada con código ${roomCode} por host ${data.hostId}`);
        break;


      case "join_room":
        if (!rooms[data.room_code]) {
          console.log(`❌ Intento fallido de unirse: sala ${data.room_code} no existe`);
          ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
          return;
        }

        const player = {
          id: data.hostId,
          username: data.username,
          ws: ws,
          character_texture: "res://Assets/UI-Items/Room/default_character.png",
          profile_texture: "res://Assets/UI-Items/Room/default_profile.png",
          status_texture: "res://Assets/UI-Items/Room/notReady.png"
        };

        rooms[data.room_code].players.push(player);

        console.log(`👤 ${data.username} se unió a la sala [${data.room_code}]`);

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

      default:
        console.log(`⚠️ Tipo de mensaje desconocido: ${data.type}`);
    }
  });
});
