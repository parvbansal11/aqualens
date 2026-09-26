import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      strictPort: true,
      proxy: {
        "/api/v1": {
          target: env.ASTRA_BACKEND_URL || "http://127.0.0.1:8000",
          changeOrigin: true,
          proxyTimeout: 180000,
        },
      },
    },
  };
});
