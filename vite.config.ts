import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative assets work both on the existing GitHub Pages subpath and on an
  // isolated Sites preview served from its own root.
  base: "./",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
});
