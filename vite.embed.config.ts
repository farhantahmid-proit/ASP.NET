import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * Standalone zero-dependency embed bundle -> dist/fresnel/browser/widget.js
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist/fresnel/browser',
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    lib: {
      entry: path.resolve(__dirname, 'src/embed/widget.ts'),
      name: 'FresnelAuditEmbed',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
})
