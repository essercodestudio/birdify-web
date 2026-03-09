import axios from 'axios';

// Aqui é a única linha que você vai mexer quando mudar de servidor!
const API_URL = "http://localhost:3001/api"; 

const api = axios.create({
  baseURL: API_URL
});

export default api;