// frontend/src/services/media.js
// Prefixo pra arquivos servidos pelo backend (avatar, sponsors, holes/*).
// Em produção assume mesma origem (nginx serve); em dev aponta pro backend local.
const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

export function mediaUrl(url) {
  if (!url) return "";
  return url.startsWith("http") ? url : MEDIA_BASE + url;
}
