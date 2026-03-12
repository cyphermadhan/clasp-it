import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../server/public'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        verified: resolve(__dirname, 'verified.html'),
        upgrade: resolve(__dirname, 'upgrade.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
});
