import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  base: "/accounts/",
  root: fileURLToPath(new URL("./tatmira-accounts", import.meta.url)),
  envDir: fileURLToPath(new URL("./tatmira-accounts", import.meta.url)),
  envPrefix: "TATMIRA_PUBLIC_",
  publicDir: false,
  plugins: [react()],
  build: { outDir: "../dist-tatmira-accounts", emptyOutDir: true },
  server: { port: 5182, strictPort: true },
});
