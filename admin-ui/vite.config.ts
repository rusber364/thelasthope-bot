import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

// В разработке интерфейс открывается с dev-сервера Vite+, а данные и вход идут к боту (порт админки 3000;
// ADMIN_API_URL — другой адрес, например подставной сервер с тестовыми данными).
const bot = process.env.ADMIN_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Типы JSON API — общие с ботом (src/admin/apiTypes.ts).
      '@api': path.resolve(import.meta.dirname, '../src/admin/apiTypes.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': bot, '/login': bot, '/auth': bot, '/logout': bot, '/logo.jpg': bot },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  // vp check: формат, линт и проверка типов одной командой.
  fmt: { singleQuote: true, printWidth: 140, ignorePatterns: ['dist/**'] },
  lint: { plugins: ['typescript', 'react'], ignorePatterns: ['dist/**'], options: { typeAware: true, typeCheck: true } },
});
