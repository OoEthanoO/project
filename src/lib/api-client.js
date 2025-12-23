// Centralized API client that routes all requests to Koyeb backend
const KOYEB_API = 'https://worrying-benetta-ethanyanxu-fd9545d7.koyeb.app';

export const apiCall = async (path, options = {}) => {
  const url = `${KOYEB_API}${path}`;
  const response = await fetch(url, options);
  return response;
};
