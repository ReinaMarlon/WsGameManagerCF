// server/characterService.js
const axios = require("axios");

const BASE_URL = "https://cursedfateserver.up.railway.app/api/characters/v1";

async function getAllCharacters() {
  try {
    const res = await axios.get(BASE_URL);
    return res.data; // devuelve un array de todos los personajes
  } catch (err) {
    console.error("Error al obtener todos los personajes:", err.message);
    return [];
  }
}

async function getCharactersByUser(userId) {
  try {
    const res = await axios.get(`${BASE_URL}/user/${userId}`);
    return res.data; // devuelve array de UserCharacter
  } catch (err) {
    console.error(`Error al obtener personajes del usuario ${userId}:`, err.message);
    return [];
  }
}

module.exports = {
  getAllCharacters,
  getCharactersByUser
};
