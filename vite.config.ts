import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // `vite build --mode android` gera o frontend dentro do app Android:
  // servido na raiz pelo backend Java embutido e sem service worker.
  const android = mode === 'android';

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Service worker: o app abre e funciona na academia sem sinal.
      // As escritas ficam na fila (services/offlineQueue.ts) e sobem depois.
      !android && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['kronos-icon.png'],
        manifest: {
          name: 'Kronos — Treino e Dieta',
          short_name: 'Kronos',
          description: 'Treino, dieta e progresso no mesmo lugar.',
          start_url: '/treino/',
          scope: '/treino/',
          display: 'standalone',
          background_color: '#0B0F1A',
          theme_color: '#0B0F1A',
          lang: 'pt-BR',
          icons: [
            { src: 'kronos-icon.png', sizes: '192x192', type: 'image/png' },
            { src: 'kronos-icon.png', sizes: '512x512', type: 'image/png' },
            { src: 'kronos-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          navigateFallback: '/treino/index.html',
          runtimeCaching: [
            {
              // Fontes do Google: cache longo, não muda
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'fontes',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              // Dados da API: sempre tenta a rede primeiro; o cache serve
              // só para a tela abrir com o último estado conhecido offline.
              urlPattern: /\/api\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'dados',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
          ],
        },
      }),
    ],
    base: android ? '/' : '/treino/',
    server: {
      // Em dev, /api vai para o backend do app no emulador (adb forward tcp:8765 tcp:8765)
      proxy: { '/api': 'http://127.0.0.1:8765' },
    },
    build: {
      outDir: android ? 'android/app/src/main/assets/www' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('motion')) return 'motion';
            if (id.includes('react')) return 'react';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
