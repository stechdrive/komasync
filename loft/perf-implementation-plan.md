# パフォーマンス改善 実装計画書（プロンプト付き・スレッド引き継ぎ用）

> 参照元: `loft/perf-plan.md`
> 目的: スマホでの再生/スクラブ/スクロール体感を改善しつつ、既存仕様・見た目を維持する。

---

## 使い方（/new 前提）
1) **タスクを1つ選び、/new で新スレッド**を開始する。
2) そのタスクの「開始プロンプト」をコピーして貼り付ける。
3) 実装→自己チェック→チェックボックスを更新（完了したタスクは **[x]**）。
4) **タスク完了時はコミット**する（Conventional Commits で `type: summary`）。
5) 次タスクへ進む際も **必ず /new** でスレッドを切り替える。

> 各タスクは「コンテキストウィンドウを意識した粒度」で分割済み。
> 進捗はこのファイルのチェックで管理する。

---

## 進捗チェックリスト（全体）
- [x] P1-1 `currentFrame` 更新の間引き + ref 同期
- [x] P1-2 `inputRms` 更新の局所化
- [x] P1-3 `TimesheetColumn` の派生プロップ化 + memo
- [x] P2-1 スクロール `setScrollLeft` rAF 間引き
- [x] P2-2 `elementFromPoint` を座標計算へ置換（フォールバック含む）
- [ ] P2-3 選択ドラッグの rAF 集約（viewport + App）
- [ ] P3-1 `trackVolumeMax` 計算のキャッシュ化

---

## 共通の自己チェック（全タスク共通）
- 変更後に **操作が破綻していない**（再生/スクラブ/選択/ズーム/編集）
- **rAF/タイマーのクリーンアップ**が抜けていない（停止後に動き続けない）
- `currentFrameRef` / `selectionRef` など **ref と state の同期が崩れていない**
- 変更した箇所に **TypeScript 型の破綻がない**

---

# 各タスク詳細

## P1-1: `currentFrame` 更新の間引き + ref 同期
**対象ファイル**: `App.tsx`

### 目的
- 再生/録音中の `currentFrame` を「フレームが変わった時のみ」更新し、描画負荷を削減。
- `currentFrameRef` と state の同期を徹底してズレを防止。

### 実装ステップ
1) `lastFrameRef` を追加し、再生/録音開始時に初期化。
2) rAF ループ内で `frame !== lastFrameRef.current` の時だけ `setCurrentFrame`。
3) **再生終了分岐**で `setCurrentFrame(endFrame)` を強制実行し、`lastFrameRef` 更新。
4) `currentFrameRef` 同期用の共通関数を作成（`setCurrentFrame` と同時更新）。
5) スクラブ/シーク/キー操作など `setCurrentFrame` を呼ぶ経路は **共通関数経由**に統一。
6) `virtualMaxFrames/totalColumns` が `currentFrame` 依存の箇所は、**ref 即値で拡張**されるように調整。

### 自己チェック
- 再生終了時に **最終フレームが必ず表示**される。
- 再生中の `currentFrame` 更新頻度が下がり、列全体の再描画が減っている。
- スクラブ/キー操作で **カーソルがズレない**。

### 開始プロンプト（/new で使用）
```
/new
目的: P1-1 currentFrame 間引き + ref 同期を App.tsx に実装。
参照: loft/perf-plan.md の P1-1。
要件: lastFrameRef 追加、rAF 内で同フレーム更新スキップ、終了時強制更新、currentFrameRef 同期用の共通関数を導入して setCurrentFrame 経路を統一。virtualMaxFrames/totalColumns は ref 即値で拡張。
成果物: App.tsx の修正内容と自己チェック結果を短く報告。
```

---

## P1-2: `inputRms` 更新の局所化
**対象ファイル**: `App.tsx`, `components/MoreSheet.tsx`

### 目的
- 録音中の `inputRms` による **App 全体の 60fps 再描画**を防止。
- `MoreSheet` が開いている時だけ局所的に更新。

### 実装ステップ
1) `App.tsx` に `inputRmsRef` を追加し、rAF では ref のみ更新。
2) `MoreSheet` で開閉に応じた購読（local state 更新）を実装。
3) `MoreSheet` が開いた直後は `inputRmsRef` から即時反映。
4) 閉じたら購読解除し、rAF で `setState` しない。
5) 停止時に `inputRmsRef` を 0 へリセット。

### 自己チェック
- 録音中でも **App 全体が頻繁に再描画されない**。
- MoreSheet の表示時のみレベルメータが更新される。
- 開き直した時に古い値が残っていない。

### 開始プロンプト（/new で使用）
```
/new
目的: P1-2 inputRms 更新を局所化し、App 全体の再描画を抑制。
参照: loft/perf-plan.md の P1-2。
要件: App.tsx に inputRmsRef を持ち rAF は ref 更新のみ。MoreSheet が開いている時だけ購読し local state 更新。開いた直後に ref から即時反映。停止時は inputRmsRef を 0。
成果物: App.tsx / components/MoreSheet.tsx の修正と自己チェック報告。
```

---

## P1-3: `TimesheetColumn` の派生プロップ化 + memo
**対象ファイル**: `components/TimesheetViewport.tsx`, `components/TimesheetColumn.tsx`

### 目的
- `currentFrame` 変更時に **影響列のみ再描画**されるようにする。
- `TimesheetColumn` の再描画条件を派生プロップで完結。

### 実装ステップ
1) `TimesheetViewport` で列ごとの派生プロップを作成。
   - `cursorRow`, `selectionSlice`, `endBoundaryRow`, `pastEndStartRow`
   - `layoutKey`, `trackOrderKey`, `trackMaxVolumes`, `trackDataKeys`, `activeTrackId`
2) `tracks` から必要最小限の描画データのみ渡す。
3) 派生配列は `useMemo` で安定化。
4) `TimesheetColumn` を `React.memo` し、比較は **派生プロップ + layoutKey + trackDataKeys + activeTrackId**。
5) `maxFrames` 変化時の境界描画が必ず更新されるか確認。

### 自己チェック
- `currentFrame` 更新時に **全列再描画が発生しない**。
- `editTarget` 変更でハイライトが即反映。
- 同列内の選択範囲伸縮が正しく描画される。

### 開始プロンプト（/new で使用）
```
/new
目的: P1-3 TimesheetColumn の派生プロップ化と React.memo 最適化。
参照: loft/perf-plan.md の P1-3。
要件: TimesheetViewport で列ごとの派生プロップ（cursorRow, selectionSlice, endBoundaryRow, pastEndStartRow, layoutKey, trackOrderKey, trackMaxVolumes, trackDataKeys, activeTrackId）を生成し useMemo で安定化。TimesheetColumn は React.memo で比較は派生プロップ中心。maxFrames 変更時の境界更新も担保。
成果物: components/TimesheetViewport.tsx と components/TimesheetColumn.tsx の修正と自己チェック報告。
```

---

## P2-1: スクロール `setScrollLeft` rAF 間引き
**対象ファイル**: `components/TimesheetViewport.tsx`

### 目的
- スクロール中の state 更新連打を抑えつつ、可視範囲・hit-test のズレを防止。

### 実装ステップ
1) scroll handler で `scrollLeftRef` を更新。
2) rAF で `setScrollLeft(scrollLeftRef.current)` を 1フレーム1回実行。
3) `setTimeout(0)` の trailing 更新で取りこぼし防止。
4) 可視範囲や `onFirstVisibleColumnChange` は **ref 即値**から算出。
5) auto-scroll/ズーム等で `scrollLeft` を直接更新する箇所は **ref も同期**。
6) `totalColumns` 縮小時に `scrollLeft` をクランプ。

### 自己チェック
- スクロール中に **空白列が出ない**。
- hit-test や visible 範囲がズレない。

### 開始プロンプト（/new で使用）
```
/new
目的: P2-1 スクロール setScrollLeft の rAF 間引きを導入。
参照: loft/perf-plan.md の P2-1。
要件: scroll handler で scrollLeftRef 更新、rAF で setScrollLeft を 1フレーム1回、trailing 更新あり。可視範囲/firstVisible は ref 即値算出。直接 scrollLeft 更新箇所は ref 同期。totalColumns 縮小時にクランプ。
成果物: components/TimesheetViewport.tsx の修正と自己チェック報告。
```

---

## P2-2: `elementFromPoint` を座標計算へ置換
**対象ファイル**: `components/TimesheetViewport.tsx` (+ 必要なら `TimesheetColumn.tsx`)

### 目的
- ドラッグ/スクラブ時の DOM hit 負荷を削減。
- 境界や誤差は DOM フォールバックで維持。

### 実装ステップ
1) `rectRef` を追加し、ResizeObserver/scroll/pointerdown で更新。
2) `clientX/clientY` から `contentX/Y` を算出。
3) `columnIndex` / `rowIndex` / `frameIndex` / `trackIndex` を計算。
4) 境界条件（rect外・spacer上・track領域外・寸法0）で DOM フォールバック。
5) `getScrubFrameAtPoint` は track 判定を使わず frame を返す。
6) `border-l-4` は `box-shadow` に置換して境界ズレを回避。

### 自己チェック
- ルーラー/トラック/空白の判定が崩れていない。
- スクロールバー領域で誤ヒットしない。

### 開始プロンプト（/new で使用）
```
/new
目的: P2-2 elementFromPoint を座標計算に置換しフォールバックを維持。
参照: loft/perf-plan.md の P2-2。
要件: rectRef を ResizeObserver/scroll/pointerdown で更新し、clientX/Y から column/row/frame/track を計算。境界/寸法0/spacer上は DOM フォールバック。getScrubFrameAtPoint は track 判定なし。border-l-4 は box-shadow に置換。
成果物: components/TimesheetViewport.tsx (必要なら TimesheetColumn.tsx) の修正と自己チェック報告。
```

---

## P2-3: 選択ドラッグの rAF 集約
**対象ファイル**: `components/TimesheetViewport.tsx`, `App.tsx`

### 目的
- 選択更新の `setSelection` / `onSelectionScrub` を rAF 集約。
- menu 表示や編集操作の直前は **同期コミット**。

### 実装ステップ
1) `selectionRangeRef` を即時更新、`setSelection` は rAF 集約。
2) 選択更新経路を 1 本の集約関数に統一。
3) pointerup/cancel で最終値を同期コミット。
4) メニュー表示や編集直前に pending をフラッシュ。
5) `App` に `selectionRef` を保持し、編集操作は ref 参照。

### 自己チェック
- 選択直後の Cut/ラベル付けが正しい範囲で動作。
- 長押し/右クリックでメニューが即閉じる不具合がない。

### 開始プロンプト（/new で使用）
```
/new
目的: P2-3 選択ドラッグの setSelection/onSelectionScrub を rAF 集約。
参照: loft/perf-plan.md の P2-3。
要件: selectionRangeRef を即時更新し、setSelection は rAF 集約。選択更新経路を統一。pointerup/cancel で同期コミット。メニュー表示や編集操作前に pending をフラッシュ。App 側に selectionRef を持ち編集は ref 参照。
成果物: components/TimesheetViewport.tsx と App.tsx の修正と自己チェック報告。
```

---

## P3-1: `trackVolumeMax` 計算のキャッシュ化
**対象ファイル**: `components/TimesheetViewport.tsx`

### 目的
- 長尺音声での VAD 表示計算コストを削減。

### 実装ステップ
1) `useRef` に `{ framesRef, max }` を保持。
2) `track.frames` 参照が変わった時だけ再計算。
3) `trackMaxVolumes` 配列を生成し、順序は `trackOrderKey` と一致させる。
4) 削除/順序変更時にキャッシュを正しく破棄。

### 自己チェック
- 長尺音声でも `trackMaxVolumes` が正しく更新される。
- トラック順変更/削除でもズレがない。

### 開始プロンプト（/new で使用）
```
/new
目的: P3-1 trackVolumeMax の計算をキャッシュ化。
参照: loft/perf-plan.md の P3-1。
要件: useRef に { framesRef, max } を保持し frames 参照変更時だけ再計算。trackMaxVolumes 配列は trackOrderKey 順。削除/順序変更時にキャッシュ破棄。
成果物: components/TimesheetViewport.tsx の修正と自己チェック報告。
```

---

## 引き継ぎメモ欄（任意）
- 直近で触ったファイル:
- 重要な判断/注意点:
- 未完の TODO:
