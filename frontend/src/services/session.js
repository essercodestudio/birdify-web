// frontend/src/services/session.js
// Encerramento de sessão centralizado. Limpa token E user dos dois storages
// (local + session) — remover só o "user" deixava o token válido e o
// ProtectedRoute readmitia o usuário "deslogado".
import { clearSession } from "./authStorage";

export function logout(navigate) {
  clearSession();
  if (navigate) navigate("/login");
  else window.location.href = "/login";
}
