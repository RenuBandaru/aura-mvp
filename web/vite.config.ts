// Vite builds and serves the React app. In development, calls to /api go to the Python dev server.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:7071' } },
});
