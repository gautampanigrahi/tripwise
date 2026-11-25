import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Config values (Cognito pool/client/domain, API URL) are read from
// VITE_* env vars at build time; see .env.example.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
