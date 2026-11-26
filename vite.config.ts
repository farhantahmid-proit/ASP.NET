import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePrefix: '-',
    }),
    react(),
  ],
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist/fresnel/browser',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 4200,
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': {
        target: process.env.FRESNEL_API_ORIGIN || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.{js,mjs,ts}',
      'browser-ext/**/*.test.{js,mjs,ts}',
    ],
    exclude: ['spec/**', 'tests/**', 'dist/**', 'node_modules/**'],
  },
})
