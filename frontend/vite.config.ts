import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const GO_BACKEND_PORT = process.env.GO_BACKEND_PORT || "10541";
const PORT = parseInt(process.env.PORT || "10540", 10);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${GO_BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${GO_BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
