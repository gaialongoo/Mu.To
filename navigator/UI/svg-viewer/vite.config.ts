import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",               // ⬅️ QUESTA È LA CHIAVE
  plugins: [react()],

  server: {
    port: 8080,
    proxy: {
      "/api": {
        target: "https://127.0.0.1:3000",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
