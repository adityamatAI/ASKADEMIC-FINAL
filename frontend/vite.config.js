// frontend/vite.config.js

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // <--- IMPORT THE PLUGIN

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()], // <--- USE THE PLUGIN
})