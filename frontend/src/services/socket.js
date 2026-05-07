import { io } from 'socket.io-client';

const URL = process.env.NODE_ENV === 'production'
  ? window.location.origin
  : 'http://localhost:3001';

export const socket = io(URL, {
  autoConnect: false,
  transports: ['websocket'],
  upgrade: false,
});
