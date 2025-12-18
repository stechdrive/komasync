import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const normalizeBase = (value: string): string => {
      // `./` は相対パス配信（どのサブパスでも動く）向けに許可
      if (value === './') return './';

      let base = value.trim();
      if (!base.startsWith('/')) base = `/${base}`;
      if (!base.endsWith('/')) base = `${base}/`;
      return base;
    };

    // GitHub Pages（https://<user>.github.io/<repo>/）向けの既定値。
    // リポジトリ名が異なる場合は `VITE_BASE=/your-repo/` を指定してください。
    const base = mode === 'production'
      ? normalizeBase(env.VITE_BASE || '/komasync/')
      : '/';
    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
