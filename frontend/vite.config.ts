import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Quando roda no Docker: BACKEND_URL=host.docker.internal
// Quando roda direto (npm run dev): aponta para localhost
const BACKEND = process.env.BACKEND_URL ?? 'localhost'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': { target: `http://${BACKEND}:8090`, changeOrigin: true },
      '/voz': { target: `http://${BACKEND}:8095`, changeOrigin: true },
      '/ws':  { target: `ws://${BACKEND}:8090`,  changeOrigin: true, ws: true },
    },
  },
})
