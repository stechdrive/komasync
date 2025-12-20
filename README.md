# KomaSync

日本のアニメ制作で使われる「縦タイムシート（24FPS）」へのセリフ記入を効率化するための、ブラウザ完結の音声編集 Web アプリです。最大3トラックの録音/取り込み、フレーム単位の編集、縦シート表示、書き出しに対応します。

## 主な機能

- 最大3トラックの録音・取り込み（トラック別に管理）
- 再生/一時停止、スクラブ再生、再生ヘッド移動（録音中の再生 ON/OFF 切替）
- セリフ検出（VAD）の自動調整/手動調整（感度・途切れにくさ・環境プリセット）
- フレーム単位の範囲選択・編集（切り取り/削除/貼り付け[挿入/上書き]/+1f 無音挿入）
- クリップボードと `Undo/Redo` で手戻り
- トラックごとのミュート
- 縦方向のタイムシート表示（24FPS/1列3秒/2列で1シート）
- シートのズーム表示（PCは上部バー、スマホはピンチ）
- 書き出し（トラック別 `WAV` の `ZIP` / シート画像 `PNG` の `ZIP`）
  - `WAV` は最長トラックの尺に合わせて無音でパディングします
- 外部APIキー不要（音声処理はブラウザ内で完結）

## 使い方（概要）

1. ブラウザで開き、トラックを選択して録音（または音声をアップロード）
2. 必要に応じてシートをズームし、再生やスクラブで位置を確認
3. 切り取り/削除/貼り付け/無音挿入で間を調整（`Undo/Redo` で手戻り）
4. 「その他」からセリフ検出の自動/詳細設定や録音中再生の切替を調整
5. 書き出しで `ZIP` をダウンロード（音声/シート画像）

補足:
- マイク利用は「安全なオリジン」が必要です（GitHub Pages は `https`、ローカルは `localhost` 推奨）。

## ショートカット

- `Ctrl/Cmd + Z`: Undo
- `Ctrl/Cmd + Y` / `Shift + Ctrl/Cmd + Z`: Redo
- `Ctrl/Cmd + X`: Cut
- `Ctrl/Cmd + V`: Paste（`Shift` で上書き）
- `↑/↓`: スクラブ移動

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

## 第三者ライセンス（モデル/依存）

- Silero VAD のモデル（`public/models/silero_vad.onnx`）を同梱しています。
- 詳細は `THIRD_PARTY_NOTICES.md` と `public/THIRD_PARTY_NOTICES.txt` を参照してください。
  - GitHub Pages 公開時は `/THIRD_PARTY_NOTICES.txt` から確認できます。
