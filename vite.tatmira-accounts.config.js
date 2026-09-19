import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import baseTailwind from "./tailwind.config.js";
const root = fileURLToPath(new URL("./tatmira-accounts", import.meta.url));
export default defineConfig({
  base: "/",
  root,
  envDir: root,
  envPrefix: "TATMIRA_PUBLIC_",
  publicDir: false,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...baseTailwind, content: [`${root}/index.html`, `${root}/src/**/*.{js,jsx}`, fileURLToPath(new URL("./tatmira-demo/src/**/*.{js,jsx}", import.meta.url))] }),
        autoprefixer(),
      ],
    },
  },
  build: { outDir: "../dist-tatmira-accounts", emptyOutDir: true },
  server: { port: 5182, strictPort: true },
});
