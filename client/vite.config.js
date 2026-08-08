import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Tacos Los Algodones — Pedidos',
        short_name: 'Los Algodones',
        description: 'Toma de pedidos, cocina y caja del local',
        lang: 'es-MX',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        // background_color debe coincidir con --fondo de estilos.css: si no, al
        // abrir la app instalada se ve un destello antes de pintar. theme_color
        // es el carbon de la barra, que es lo que pinta la franja del sistema.
        background_color: '#f6f3ee',
        theme_color: '#17140f',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El cascaron se sirve desde cache: la app abre aunque el servidor
        // este apagado o el WiFi se haya caido. Los datos NO se cachean;
        // pedidos viejos en pantalla serian peor que una pantalla vacia.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [],

        // Sin estas dos, una version nueva se descarga pero NO se activa hasta
        // que se cierran TODAS las pestañas de la app. En una tablet que se
        // queda abierta todo el dia eso no pasa nunca: se recompila, se
        // reinicia el servidor, y la tablet sigue corriendo el codigo viejo sin
        // que nada lo delate. Con esto la version nueva entra en la siguiente
        // recarga.
        skipWaiting: true,
        clientsClaim: true,
        // Borra los caches de builds anteriores en vez de irlos acumulando.
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // En desarrollo el front corre en 5173 y el servidor en 3000; el proxy
    // evita andar peleando con CORS y deja las rutas iguales que en produccion.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/pruebas/preparar.js'],
    globals: true,
  },
});
