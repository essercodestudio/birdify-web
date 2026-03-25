/* eslint-disable no-restricted-globals */
const CACHE_NAME = 'birdify-offline-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Força o salvamento da tela principal logo que o app abre
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/', '/index.html']);
    }).catch(() => console.log('Cache inicial ignorado'))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Ignora requisições do sistema, foca só no que for HTTP/HTTPS
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Se tem internet, salva uma cópia silenciosa pro futuro
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(async () => {
        // === A INTERNET CAIU ===
        
        // 1. O Safari pediu um arquivo que temos salvo? Toma.
        if (cachedResponse) return cachedResponse;
        
        // 2. O jogador tentou abrir uma tela nova? Mostra a tela principal do React.
        if (event.request.mode === 'navigate') {
          const rootCache = await caches.match('/index.html') || await caches.match('/');
          if (rootCache) return rootCache;
        }
        
        // 3. A TRAVA DO SAFARI: Nunca devolve "null". Se der tudo errado, devolve uma resposta válida de erro.
        return new Response('Sem conexão com a internet. O Birdify continua guardando seus placares.', { 
          status: 503, 
          statusText: 'Offline',
          headers: new Headers({ 'Content-Type': 'text/plain' })
        });
      });

      return cachedResponse || fetchPromise;
    })
  );
});