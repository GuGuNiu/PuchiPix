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
    rollupOptions: {
      output: {
        /*
         * Split vendors so third-party chunks stay cached across deploys and
         * only app chunks invalidate when application code changes.
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("zustand")) return "vendor-state";
          if (id.includes("react-window")) return "vendor-window";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
