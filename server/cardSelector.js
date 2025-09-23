// CardsSelector.js
const WebSocket = require("ws");

// Map de personajes bloqueados por sala
// roomsLocked[roomCode] = { characterId: playerId }
let roomsLocked = {};

/**
 * Maneja la selección de un personaje
 * @param {Object} ws Cliente que seleccionó el personaje
 * @param {Object} rooms Referencia a las salas actuales
 * @param {Object} data Payload del cliente { room_code, player_id, character_id }
 */
function handleCharacterSelection(ws, rooms, data) {
  const { room_code, player_id, character_id } = data;

  if (!rooms[room_code]) {
    ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
    return;
  }

  // Inicializar la sala en locked si no existe
  if (!roomsLocked[room_code]) {
    roomsLocked[room_code] = {};
  }

  // Verificar si el personaje ya está bloqueado
  if (roomsLocked[room_code][character_id]) {
    ws.send(JSON.stringify({ 
      type: "character_locked",
      character_id: character_id,
      locked_by: roomsLocked[room_code][character_id]
    }));
    return;
  }

  // Bloquear el personaje para todos
  roomsLocked[room_code][character_id] = player_id;

  // Enviar actualización a todos los jugadores de la sala
  rooms[room_code].players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: player.id === player_id ? "character_selected" : "character_locked",
        character_id: character_id,
        player_id: player_id
      }));
    }
  });

  console.log(`🎯 Player ${player_id} seleccionó el personaje ${character_id} en sala ${room_code}`);
}

/**
 * Función para desbloquear personajes si un jugador se desconecta
 * @param {string} room_code
 * @param {string} player_id
 */
function unlockCharactersOnDisconnect(room_code, player_id) {
  if (!roomsLocked[room_code]) return;

  for (const charId in roomsLocked[room_code]) {
    if (roomsLocked[room_code][charId] === player_id) {
      delete roomsLocked[room_code][charId];
      console.log(`🔓 Personaje ${charId} desbloqueado en sala ${room_code} por desconexión de ${player_id}`);
    }
  }
}

module.exports = {
  handleCharacterSelection,
  unlockCharactersOnDisconnect
};
