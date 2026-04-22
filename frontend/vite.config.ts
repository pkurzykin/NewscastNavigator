import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_PROXY_TARGET?.trim();

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }
            if (id.includes("@tiptap") || id.includes("prosemirror")) {
              return "tiptap-vendor";
            }
            if (id.includes("react") || id.includes("scheduler")) {
              return "react-vendor";
            }
            return "vendor";
          }
        }
      }
    },
    server: {
      host: env.VITE_DEV_HOST || "127.0.0.1",
      port: Number(env.VITE_DEV_PORT || 5173),
      proxy: proxyTarget
        ? {
            "/api": {
              target: proxyTarget,
              changeOrigin: true
            }
          }
        : undefined
    }
  };
});
