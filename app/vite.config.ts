import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL || process.env.VITE_API_URL || "";
  /* Aucun secret ne doit être compilé dans le bundle public : l'authentification
     se fait uniquement via X-Session (cookie-less, token en localStorage). */
  if (mode === "production" && !apiUrl) {
    throw new Error(
      "VITE_API_URL absente : le build produirait une application morte (les appels /api/* partiraient sur l'hote du frontend). " +
        "Definir VITE_API_URL avant de builder.",
    );
  }
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"],
        manifest: {
          name: "PaletteD&co Devis",
          short_name: "Devis",
          description: "Création de devis et factures - Meubles décoratifs en bois de palette",
          start_url: "/",
          display: "standalone",
          background_color: "#1c130c",
          theme_color: "#1c130c",
          lang: "fr",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: "icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          navigateFallback: "/index.html",
          /* Les donnees metier (clients, devis, factures, tresorerie)
             transitent par /api : jamais mises en cache, jamais servies
             depuis le service worker, meme hors ligne. */
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiUrl || "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
    define: {
      __API_URL__: JSON.stringify(apiUrl),
    },
  };
});