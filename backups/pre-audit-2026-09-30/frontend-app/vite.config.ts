import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL || process.env.VITE_API_URL || "";
  const apiToken = env.VITE_API_TOKEN || process.env.VITE_API_TOKEN || "";
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
      __API_TOKEN__: JSON.stringify(apiToken),
    },
  };
});