# KomaSync

日本のアニメ制作で使われる「縦タイムシート（24FPS）」へのセリフ記入を効率化するための、ブラウザ完結の音声編集 Web アプリです。最大3トラックの録音/取り込み、間（無音）の編集、縦シート表示、編集結果の書き出しに対応します。

## 主な機能

- 最大3トラックの録音（トラック別に管理）
- 外部APIキー不要（音声処理はブラウザ内で完結）
- 音声ファイルの取り込み（トラックに割り当て）
- フレーム（24FPS）単位の可視化・選択・編集（間/余白の調整を想定）
- 縦方向のタイムシート形式で表示（シート単位で閲覧）
- 編集後の音声を書き出し（各トラックを `WAV` として `ZIP` ダウンロード）

## 使い方（概要）

1. ブラウザで開き、トラックを選択して録音（または音声をアップロード）
2. タイムシート上で範囲を選択し、不要な間を削除/調整
3. 必要に応じて `Undo/Redo` で手戻り
4. 書き出しで `ZIP` をダウンロード

補足:
- マイク利用は「安全なオリジン」が必要です（GitHub Pages は `https`、ローカルは `localhost` 推奨）。

## 開発（ローカル）

前提: Node.js

- 依存関係のインストール: `npm install`
- 開発サーバ起動: `npm run develop`（`http://localhost:3000`）
- 本番ビルド: `npm run build`
- ビルドの確認: `npm run preview`

## GitHub Pages へのデプロイ

このリポジトリの公開URL: `https://stechdrive.github.io/komasync/`

- デプロイ: `npm run deploy`
  - `dist/` を `gh-pages` ブランチへ発行します
  - GitHub の Settings → Pages で `gh-pages` ブランチ（`/`）を選択してください

※ フォーク/リポ名変更時はベースパスを上書きしてください: `VITE_BASE=/your-repo/ npm run deploy`

## コントリビュート

- コミットメッセージは英語の Conventional Commits（例: `feat: ...`, `fix: ...`）を使用してください。

## ライセンス

MIT License（`LICENSE` を参照）

Copyright (c) 2025 stechdrive
