import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { geminiEnabled } from '../server/src/features.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')
  return {
    define: { __GEMINI_ENABLED__: JSON.stringify(geminiEnabled(env.PROD)) },
    envDir: '..',
    plugins: [react()],
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:3001',
      },
    },
  }
})
