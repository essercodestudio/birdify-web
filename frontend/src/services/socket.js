import { io } from 'socket.io-client';

// REACT_APP_SOCKET_URL prevalece. Em produção, mesma origem do site.
const URL = process.env.REACT_APP_SOCKET_URL
  || (process.env.NODE_ENV === 'production'
    ? window.location.origin
    : 'http://localhost:3001');

export const socket = io(URL, {
  autoConnect: false,
  transports: ['websocket'],
  upgrade: false,
});
