import axios from 'axios';

// O React busca automaticamente no arquivo .env a variável REACT_APP_API_URL
// Se ela não existir (como no Git), ele usa o "http://localhost:3001/api" por padrão.
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:3001/api"
});

export default api;