// frontend/src/services/download.js
// Baixa um arquivo protegido por autenticação. Usa o axios `api`, cujo
// interceptor injeta o header Authorization — algo que window.open NÃO faz
// (por isso o export antigo, via window.open, não conseguia mandar o token).
import api from "./api";

export async function downloadFile(path, fallbackName = "arquivo") {
  const res = await api.get(path, { responseType: "blob" });

  // Tenta extrair o nome do arquivo do Content-Disposition; senão usa o fallback.
  const disposition = res.headers["content-disposition"] || "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;

  const url = window.URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
