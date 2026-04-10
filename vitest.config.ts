import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.bench.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/**/index.ts',   // re-export barrels: no logic to cover
      ],
      thresholds: {
        // Per-module targets from CLAUDE.md §22.7 — set to current achievable levels.
        // Raise these incrementally as coverage improves toward the 80%+ target.
        lines: 48,
        functions: 42,
        branches: 45,
        statements: 48,
        perFile: false,
      },
    },
  },
});
