import axios from 'axios';

const isProduction = process.env.NODE_ENV === 'production';

// REACT_APP_API_URL prevalece em qualquer ambiente. Em produção, o fallback
// é o path relativo /api (mesma origem). Em dev, o backend local.
const baseURL = process.env.REACT_APP_API_URL
  || (isProduction ? '/api' : 'http://localhost:3001/api');

const api = axios.create({
  baseURL,
  timeout: 10000,
});

api.interceptors.request.use(config => {
  if (config.method === 'get') {
    config.params = { ...config.params, _t: Date.now() };
    config.headers = {
      ...config.headers,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
  }

  const token = localStorage.getItem('token');
  if (token) {
    config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
  }

  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
