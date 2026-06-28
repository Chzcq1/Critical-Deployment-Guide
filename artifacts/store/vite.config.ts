import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isBuild = process.argv.includes("build");
const rawPort = process.env.PORT;
const basePath = process.env.BASE_PATH ?? "/";

const port = rawPort ? Number(rawPort) : 3000;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...(!isBuild && process.env.NODE_ENV !== "production"
      ? [
          (await import("@replit/vite-plugin-runtime-error-modal").catch(() => ({ default: () => null }))).default?.() ?? [],
          ...(process.env.REPL_ID !== undefined
            ? [
                await import("@replit/vite-plugin-cartographer").then((m) =>
                  m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
                ).catch(() => null),
                await import("@replit/vite-plugin-dev-banner").then((m) =>
                  m.devBanner(),
                ).catch(() => null),
              ]
            : []),
        ].flat().filter(Boolean)
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
    proxy: {
      "/api": {
        target: process.env.BACKEND_URL || "http://localhost:8080",
        changeOrigin: true,
      },
      "/webhook": {
        target: process.env.BACKEND_URL || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
