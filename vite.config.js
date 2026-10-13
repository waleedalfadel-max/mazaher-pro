import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { appVersion } from './vite-plugins/appVersion.js'

export default defineConfig({
  plugins: [react(), appVersion()],
})
