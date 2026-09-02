// Onda B · Commit 3.16: formato compacto do nome da dupla (server-side).
// "Joao Silva" + "Pedro Santos" -> "J. Silva / P. Santos"
// Nome de 1 palavra so ("Madonna") mantem o proprio nome (fallback).
// Espelhado em frontend/src/utils/duplaName.js.

function formatPlayerShort(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return '';
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0][0].toUpperCase();
  const last = parts[parts.length - 1];
  return `${first}. ${last}`;
}

function formatDuplaName(player1Name, player2Name) {
  const a = formatPlayerShort(player1Name);
  const b = formatPlayerShort(player2Name);
  if (!a && !b) return '';
  if (!a) return b;
  if (!b) return a;
  return `${a} / ${b}`;
}

function formatDuplaFromPlayers(players) {
  const arr = Array.isArray(players) ? players : [];
  return formatDuplaName(arr[0]?.name, arr[1]?.name);
}

module.exports = { formatPlayerShort, formatDuplaName, formatDuplaFromPlayers };
