import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    // Railway serves the app from a *.up.railway.app (or custom) domain
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
