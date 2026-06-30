import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // During local dev the website runs on :5173 and the backend on :3001.
    // This forwards any /api/* request from the website to the backend so the
    // browser can call it as if they were the same server.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
