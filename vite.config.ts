import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/cizhuan-paiban/" : "/",
  plugins: [react()],
  test: {
    environment: "node",
    globals: true
  }
}));
