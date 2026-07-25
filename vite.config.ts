import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', 'VITE_');
    const unexpectedPublicEnv = Object.keys(env).filter((key) => key !== 'VITE_BASE');
    if (mode === 'production' && unexpectedPublicEnv.length > 0) {
      throw new Error(
        `本番ビルドでは VITE_BASE 以外の公開環境変数を使用できません: ${unexpectedPublicEnv.join(', ')}`
      );
    }
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

    // GitHub Pages（https://<user>.github.io/<repo>/）向けの既定値。
    // リポジトリ名が異なる場合は `VITE_BASE=/your-repo/` を指定してください。
    const base = mode === 'production'
      ? normalizeBase(env.VITE_BASE || '/komasync/')
      : '/';
    return {
      base,
      envPrefix: 'VITE_',
      build: {
        // ローカルのソースパスやソース本文を公開成果物へ含めない
        sourcemap: false,
      },
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
