import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Dive diary",
        short_name: "Dives",
        description: "Cave dive logs, maps and routes",
        theme_color: "#0f2a33",
        background_color: "#eef3f3",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/_\//],
        runtimeCaching: [
          {
            // Map and photo files are immutable (new upload = new filename),
            // so cache-first is safe and makes viewed maps work offline.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/files/"),
            handler: "CacheFirst",
            options: {
              cacheName: "dive-files",
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  // Files are fetched with a short-lived access token; cache
                  // them under the URL without it so they stay found offline.
                  cacheKeyWillBeUsed: async ({ request }) => {
                    const u = new URL(request.url);
                    u.searchParams.delete("token");
                    return u.href;
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8090",
      "/_": "http://127.0.0.1:8090",
    },
  },
  build: {
    outDir: "../backend/pb_public",
    emptyOutDir: true,
  },
});
