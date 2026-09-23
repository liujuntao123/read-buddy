// Plain-object vitest config (no `vitest/config` import: this file lives at the
// repo root, where the vitest package itself is not resolvable — it is
// installed under apps/readest-app/node_modules).
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const app = path.resolve(repo, 'apps/readest-app');

export default {
  root: repo,
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': path.resolve(app, 'src') } },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: [path.resolve(app, 'src/test/setup.ts')],
    include: ['.scratch/**/*.test.ts'],
    css: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
};
