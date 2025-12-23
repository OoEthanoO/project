import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Point Vite's /api proxy to wherever the backend is running.
  // - Default: Vercel serverless dev on port 3000
  // - To use the legacy Express server, set VITE_API_ORIGIN=http://localhost:8787
  const apiOrigin = env.VITE_API_ORIGIN || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': apiOrigin
      }
    }
  };
});
