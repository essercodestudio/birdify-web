// frontend/src/services/authStorage.js
// Storage híbrido: "Manter conectado" → localStorage (persiste), senão sessionStorage (some ao fechar).
// Toda leitura procura em localStorage primeiro (default histórico), depois sessionStorage.

const KEEP_FLAG = "keepConnected";

function primaryStorage() {
  return sessionStorage.getItem(KEEP_FLAG) === "false" ? sessionStorage : localStorage;
}

export function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || null;
}

export function getUser() {
  const raw = localStorage.getItem("user") || sessionStorage.getItem("user");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setSession({ token, user, keepConnected }) {
  clearSession();
  const target = keepConnected ? localStorage : sessionStorage;
  target.setItem("token", token);
  target.setItem("user", JSON.stringify(user));
  sessionStorage.setItem(KEEP_FLAG, keepConnected ? "true" : "false");
}

export function updateUser(user) {
  const target = primaryStorage();
  target.setItem("user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  sessionStorage.removeItem(KEEP_FLAG);
}
