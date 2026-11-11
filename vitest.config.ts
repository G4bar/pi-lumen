import { defineConfig } from "vitest/config";

// Unit tests only; the tmux-based e2e suite has its own config (`npm run test:e2e`).
export default defineConfig({ test: { exclude: ["**/node_modules/**", "test/e2e/**"] } });
