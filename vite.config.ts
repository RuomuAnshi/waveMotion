import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/web"),
  publicDir: path.resolve(__dirname, "public"),
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3210",
      "/media": "http://127.0.0.1:3210",
      "/renders": "http://127.0.0.1:3210",
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/web"),
    emptyOutDir: true,
  },
});
