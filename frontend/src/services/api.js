import axios from 'axios';

// Se estivermos em produção (na Hostinger), usamos '/api'
// Se estivermos em desenvolvimento (seu PC), usamos 'http://localhost:3001/api'
const isProduction = process.env.NODE_ENV === 'production';

const api = axios.create({
  baseURL: isProduction 
    ? "/api" 
    : "http://localhost:3001/api"
});

export default api;