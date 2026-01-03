import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const coopHeaders = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    };
    const normalizeBase = (value: string): string => {
      // `./` は相対パス配信（どのサブパスでも動く）向けに許可
      if (value === './') return './';

      let base = value.trim();
      if (!base.startsWith('/')) base = `/${base}`;
      if (!base.endsWith('/')) base = `${base}/`;
      return base;
    };

    // 既定は相対パス配信（custom domain / GitHub Pages 両対応）。
    // リポジトリ名を固定したい場合は `VITE_BASE=/your-repo/` を指定してください。
    const base = mode === 'production'
      ? normalizeBase(env.VITE_BASE || './')
      : '/';
    return {
      base,
      worker: {
        format: 'es',
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        headers: coopHeaders,
      },
      preview: {
        headers: coopHeaders,
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
