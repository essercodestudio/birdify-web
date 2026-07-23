import React from 'react';
import ReactDOM from 'react-dom/client';
// Fonte única do sistema (self-hosted, sem request externo)
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Aqui é onde a mágica acontece! Ligamos o registro do Service Worker
serviceWorkerRegistration.register();

reportWebVitals();