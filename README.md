# KomaSync

日本のアニメ制作で使われる「縦タイムシート（24FPS）」へのセリフ記入を効率化するための、ブラウザ完結の音声編集 Web アプリです。最大3トラックの録音/取り込み、フレーム単位の編集、縦シート表示、書き出しに対応します。
EN: A browser-based audio editing app that streamlines dialogue entry on Japanese vertical timesheets (24 FPS). Supports up to 3 tracks for recording/import, frame-level editing, vertical sheet view, and exports.

バージョン: 1.8.5
Version: 1.8.5

## 主な機能 / Features

- 最大3トラックの録音・取り込み（トラック別に管理） / EN: Up to 3 tracks for recording/import, managed per track.
- 再生/一時停止、スクラブ再生、再生ヘッド移動（録音中の再生 ON/OFF 切替） / EN: Play/pause, scrubbing, and playhead moves (toggle play while recording).
- セリフ検出（VAD）の自動調整/手動調整（感度・途切れにくさ・環境プリセット） / EN: VAD auto/manual tuning (sensitivity, stability, environment presets).
- トラック波形の常時表示（トラック内で正規化） / EN: Always-on waveforms (normalized per track).
- セリフラベルの手動上書き（範囲選択 → セリフ/解除/自動） / EN: Manual override of speech labels (range select → speech/clear/auto).
- 手動ラベルは自動判定より優先（画面表示/シート画像） / EN: Manual labels override auto detection (UI and sheet images).
- フレーム単位の範囲選択・編集（切り取り/削除/貼り付け[挿入/上書き]/+1f 無音挿入/-1f 削除） / EN: Frame-level range editing (cut/delete/paste insert/overwrite, +1f silence insert, -1f delete).
- クリップボードと `Undo/Redo` で手戻り / EN: Clipboard plus Undo/Redo for quick rework.
- トラックごとのミュート / EN: Per-track mute.
- 縦方向のタイムシート表示（24FPS/1列3秒/2列で1シート） / EN: Vertical timesheet view (24 FPS, 3 sec per column, 2 columns per sheet).
- シートのズーム表示（上部バーのズーム操作/スマホはピンチ対応） / EN: Sheet zoom (top-bar controls, pinch on mobile).
- 書き出し（トラック別 `WAV` の `ZIP` / シート画像 `PNG` の `ZIP`） / EN: Export (per-track WAV ZIP / sheet image PNG ZIP).
  - `WAV` は最長トラックの尺に合わせて無音でパディングします / EN: WAVs are padded with silence to the longest track.
- 外部APIキー不要（音声処理はブラウザ内で完結） / EN: No external API keys required (audio processing runs in-browser).

## 使い方（概要） / Quick Start

1. ブラウザで開き、トラックを選択して録音（または音声をアップロード） / EN: Open in a browser and record on a selected track (or upload audio).
2. 必要に応じてシートをズームし、再生やスクラブで位置を確認 / EN: Zoom as needed and use playback/scrub to check positions.
3. 波形とセリフ色を見ながら範囲選択し、切り取り/削除/貼り付け/無音挿入で間を調整（`Undo/Redo` で手戻り） / EN: Select ranges while viewing waveform/speech colors and adjust timing via cut/delete/paste/silence insert (Undo/Redo to backtrack).
4. 選択メニューのセリフラベルで「セリフ/解除/自動」を調整 / EN: Use the selection menu to set Speech/Clear/Auto labels.
5. 「その他」からセリフ検出の自動/詳細設定や録音中再生の切替を調整 / EN: Use More to adjust VAD auto/details and toggle play while recording.
6. 書き出しで `ZIP` をダウンロード（音声/シート画像） / EN: Download ZIP exports (audio/sheet images).

補足 / Notes:
- 録音/アップロードした音声はブラウザ内で処理され、外部サーバーに送信されません。 / EN: Recorded/uploaded audio is processed locally in the browser and is not sent to external servers.

## ショートカット / Shortcuts

- `Ctrl/Cmd + Z`: Undo / EN: Undo
- `Ctrl/Cmd + Y` / `Shift + Ctrl/Cmd + Z`: Redo / EN: Redo
- `Ctrl/Cmd + X`: Cut / EN: Cut
- `Ctrl/Cmd + V`: Paste（`Shift` で上書き） / EN: Paste (Shift to overwrite)
- `↑/↓`: スクラブ移動 / EN: Scrub move

## ライセンス / License

MIT License（`LICENSE` を参照） / EN: MIT License (see `LICENSE`).

Copyright (c) 2025 stechdrive

## 第三者ライセンス（モデル/依存） / Third-Party Notices (Models/Dependencies)

- Silero VAD のモデル（`public/models/silero_vad.onnx`）を同梱しています。 / EN: The Silero VAD model (`public/models/silero_vad.onnx`) is included.
- 詳細は `THIRD_PARTY_NOTICES.md` と `public/THIRD_PARTY_NOTICES.txt` を参照してください。 / EN: See `THIRD_PARTY_NOTICES.md` and `public/THIRD_PARTY_NOTICES.txt` for details.
  - GitHub Pages 公開時は `/THIRD_PARTY_NOTICES.txt` から確認できます。 / EN: When published on GitHub Pages, see `/THIRD_PARTY_NOTICES.txt`.
