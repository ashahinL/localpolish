import { defineConfig } from 'vite';

export default defineConfig({
  root: 'tests/e2e/fixtures',
  // draft-js pulls fbjs, which reads the Node global `global`.
  define: { global: 'window' },
  server: { host: '0.0.0.0', port: 5179, strictPort: true },
});
