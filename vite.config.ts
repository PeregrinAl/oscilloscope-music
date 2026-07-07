import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// COOP/COEP: cross-origin isolation, необходимая для SharedArrayBuffer (§5.5 ТЗ).
// Без этих заголовков приложение работает через fallback-путь (postMessage из воркилета).
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
