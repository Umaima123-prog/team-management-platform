import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    // Railway's generated domain - `vite preview` rejects unrecognized
    // Host headers by default (CVE-2025-30208-class DNS-rebinding
    // protection). Scoped to the exact known production host rather
    // than `allowedHosts: true`.
    allowedHosts: ['admin-ui-production-f0a5.up.railway.app'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
