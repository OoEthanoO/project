// Centralized API client that routes all requests to backend
// Uses localhost:8787 in development, Koyeb in production
const isDev = import.meta.env.DEV;
const KOYEB_API = 'https://worrying-benetta-ethanyanxu-fd9545d7.koyeb.app';
const LOCAL_API = 'http://localhost:8787';

const API_BASE = isDev ? LOCAL_API : KOYEB_API;

export const apiCall = async (path, options = {}) => {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, options);
  return response;
};
