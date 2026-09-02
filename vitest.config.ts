import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Config khusus test — TERPISAH dari vite.config.ts (prasyarat test
 * BUILD_STEPS.md Langkah 5-9). Tidak memuat plugin react/tailwind karena
 * yang dites hanya data layer murni (tanpa komponen).
 */
export default defineConfig({
  resolve: {
    alias: {
      // Samakan dengan vite.config.ts: '@' → './src'
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // RPC dummy — memastikan tidak ada module yang menembak RPC asli saat
    // init (mis. src/config/chain.ts membaca VITE_RPC_URL).
    env: {
      VITE_RPC_URL: 'http://dummy.local',
    },
  },
})
