/* eslint-disable no-restricted-globals */
const CACHE_NAME = 'birdify-offline-v1';

// Quando o PWA é instalado no celular...

// Quando o PWA é instalado no celular, ativa na hora
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Assume o controle do site imediatamente
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// O "Cérebro" de interceptação de rede
self.addEventListener('fetch', (event) => {
  // Ignora requisições de salvar placar (POST), foca só em carregar a tela (GET)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Tenta buscar a versão mais nova na Hostinger
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          // Se deu sucesso, guarda uma cópia no celular para o modo offline
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // MODO OFFLINE (A internet caiu)
        // Se o usuário tentar abrir uma tela e der erro, devolvemos a tela principal salva
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });

      // Se já tem no cache, mostra rápido. Se não, espera a internet carregar.
      return cachedResponse || fetchPromise;
    })
  );
});