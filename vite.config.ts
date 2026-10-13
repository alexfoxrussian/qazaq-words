import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({ plugins: [react(), VitePWA({
  registerType: 'prompt', injectRegister: false,
  includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
  manifest: {
    id: './', name: 'Qazaq Words', short_name: 'Qazaq Words', lang: 'ru',
    description: 'Казахские слова: словарь, практика и локальный прогресс',
    start_url: './', scope: './', display: 'standalone', categories: ['education'],
    theme_color: '#1d4ed8', background_color: '#f4f6fa',
    icons: [
      { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    cacheId: 'qazaq-words', globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
    cleanupOutdatedCaches: true, clientsClaim: true, navigateFallback: 'index.html',
  },
  devOptions: { enabled: false },
})] })
