// frontend/src/services/syncService.js
// Fila offline-first para envio de tacadas. Persiste em localStorage,
// reenvia ao detectar 'online' e expõe um pub/sub para a UI mostrar
// um indicador "Aguardando Conexão".

import api from './api';

const QUEUE_KEY = 'birdify_sync_queue';
const STATUS = {
  PENDING: 'pendente',
  SYNCING: 'sincronizando',
  SYNCED: 'sincronizado',
  FAILED: 'falhou',
};

const listeners = new Set();
let flushing = false;

const safeParse = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

const readQueue = () => safeParse(localStorage.getItem(QUEUE_KEY), []);

const writeQueue = (queue) => {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
};

const notify = () => {
  const snapshot = getStatus();
  listeners.forEach((cb) => {
    try { cb(snapshot); } catch (e) { console.error('syncService listener error', e); }
  });
};

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export const getStatus = () => {
  const queue = readQueue();
  return {
    online: isOnline(),
    pending: queue.filter((i) => i.status === STATUS.PENDING || i.status === STATUS.FAILED).length,
    syncing: queue.some((i) => i.status === STATUS.SYNCING),
  };
};

export const subscribe = (cb) => {
  listeners.add(cb);
  cb(getStatus());
  return () => listeners.delete(cb);
};

// Enfileira um envio. `dedupKey` (ex: "score:tournament:user:hole") garante que
// múltiplos cliques no mesmo input substituam a última versão pendente em vez
// de empilhar duplicatas.
export const enqueue = ({ endpoint, payload, dedupKey }) => {
  const queue = readQueue();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let nextQueue = queue;
  if (dedupKey) {
    nextQueue = queue.filter(
      (i) => !(i.dedupKey === dedupKey && (i.status === STATUS.PENDING || i.status === STATUS.FAILED))
    );
  }

  nextQueue.push({
    id,
    endpoint,
    payload,
    dedupKey: dedupKey || null,
    status: STATUS.PENDING,
    retries: 0,
    createdAt: Date.now(),
  });

  writeQueue(nextQueue);
  flush();
  return id;
};

// Processa todos os pendentes na ordem. Se um falhar por rede, marca como
// pendente novamente e interrompe o flush para tentar de novo no próximo online.
export const flush = async () => {
  if (flushing) return;
  if (!isOnline()) return;

  flushing = true;
  notify();

  try {
    let queue = readQueue();
    let dirty = false;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.status === STATUS.SYNCED) continue;

      queue[i] = { ...item, status: STATUS.SYNCING };
      writeQueue(queue);

      try {
        await api.post(item.endpoint, item.payload);
        queue = readQueue();
        const idx = queue.findIndex((q) => q.id === item.id);
        if (idx !== -1) {
          queue[idx] = { ...queue[idx], status: STATUS.SYNCED, syncedAt: Date.now() };
          dirty = true;
        }
      } catch (err) {
        queue = readQueue();
        const idx = queue.findIndex((q) => q.id === item.id);
        if (idx !== -1) {
          const isNetworkError = !err.response;
          queue[idx] = {
            ...queue[idx],
            status: isNetworkError ? STATUS.PENDING : STATUS.FAILED,
            retries: (queue[idx].retries || 0) + 1,
            lastError: err.response?.data?.message || err.message,
          };
          writeQueue(queue);
        }
        if (!isOnline() || !err.response) break;
      }
    }

    if (dirty) writeQueue(queue);
    pruneSynced();
  } finally {
    flushing = false;
    notify();
  }
};

// Remove itens já sincronizados há mais de 30s (mantém histórico curto
// para debug; sem isso a fila cresceria indefinidamente).
const pruneSynced = () => {
  const cutoff = Date.now() - 30_000;
  const queue = readQueue();
  const next = queue.filter((i) => !(i.status === STATUS.SYNCED && i.syncedAt && i.syncedAt < cutoff));
  if (next.length !== queue.length) writeQueue(next);
};

// Gerenciador global de reconexão. Anexa listener uma única vez por sessão.
let bootstrapped = false;
export const bootstrap = () => {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;

  window.addEventListener('online', () => { flush(); });
  window.addEventListener('offline', () => { notify(); });
  // Tenta drenar ao iniciar — útil quando o app abre após F5 com pendências
  if (isOnline()) flush();
};

export const STATUS_LABELS = STATUS;

export default {
  enqueue,
  flush,
  subscribe,
  getStatus,
  bootstrap,
};
