import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  server: {
    host: true,
    port: 3000,
  },
});
