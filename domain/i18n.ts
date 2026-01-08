export type Language = 'ja' | 'en';
export type Translator = (key: string, params?: Record<string, string | number>) => string;
export type ListTranslator = (key: string) => string[];

type I18nValue = string | string[] | Record<string, I18nValue>;

type I18nMessages = {
  ja: Record<string, I18nValue>;
  en: Record<string, I18nValue>;
};

const messages: I18nMessages = {
  ja: {
    topBar: {
      resetTitle: 'リセット',
      sheetLabel: 'シート {sheetNumber}',
      selectionSuffix: ' / 選 {selection}',
      zoomOutTitle: 'ズームアウト（100%まで）',
      zoomResetTitle: '全体表示',
      zoomResetAria: '全体表示',
      zoomInTitle: 'ズームイン',
      undoTitle: '元に戻す',
      redoTitle: 'やり直す',
      muteTitle: 'ミュート',
      helpTitle: 'ヘルプ',
      moreTitle: 'その他',
    },
    transport: {
      recordStop: '停止',
      recordPreparing: '準備中…',
      recordProcessing: '処理中…',
      recordStart: '録音',
      recordTrackIndicator: 'REC T{track}',
      playTitle: '再生',
      pauseTitle: '一時停止',
      allTracksTitle: '全トラック',
      allTracksLabel: '全',
      markSpeechTitle: '選択範囲にセリフを適用（なければ1コマ）',
      markSpeechLabel: '話',
      markNonSpeechTitle: '選択範囲を非セリフとして除外（なければ1コマ）',
      markNonSpeechLabel: '無',
      deleteFrameTitle: '-1f（削除 / 選択範囲なら範囲削除）',
      insertFrameTitle: '+1f（無音挿入）',
    },
    editPalette: {
      selectionCount: '{count}コマ選択中',
      close: '閉じる',
      clearSelection: '解除',
      cut: '切り取り',
      delete: '削除',
      speechLabel: 'セリフラベル',
      speech: 'セリフ',
      nonSpeech: '解除',
      auto: '自動',
      clipboard: 'クリップボード',
      pasteInsert: '貼り付け（挿入）',
      pasteOverwrite: '貼り付け（上書き）',
      clearClipboard: 'クリップボードを消去',
    },
    trackMute: {
      title: 'ミュート',
    },
    more: {
      title: 'その他',
      close: '閉じる',
      exportSection: '書き出し',
      exportAudio: 'トラック別WAVをZIPでダウンロード',
      exportCurrent: '表示中',
      exportAll: '全シート',
      uploadSection: 'アップロード',
      uploadLabel: '{track} に音声を読み込む',
      inputOptimizeSection: '入力最適化',
      inputOptimizeDescription:
        'テスト開始後、1秒ほど待ってから普段の声量で3〜4秒話してください。結果に合わせて録音ゲインを自動調整します。',
      inputTestStart: 'レベルテストを開始',
      inputTestRunning: '計測中…',
      inputTestResult: '推奨 {recommended} / 適用 {applied}',
      inputGainLabel: '録音ゲイン',
      limiterLabel: 'リミッター',
      limiterAria: 'リミッターの切り替え',
      limiterHelp:
        'クリップに近い入力を軽く抑えて歪みを減らします（元がクリップしている場合は完全には復元できません）。',
      limiterLocked: '録音/再生中はリミッター設定を変更できません。',
      vadSection: 'セリフ検出',
      vadAuto: '自動調整',
      vadAutoAria: 'セリフ検出の自動調整',
      vadAutoCaptionOn: '6コマ以上の録音があると自動で最適化',
      vadAutoCaptionOff: '手動で感度と途切れにくさを調整できます',
      inputLevel: '入力レベル',
      detailsLabel: '詳細設定',
      detailsOpen: '開く',
      detailsClose: '閉じる',
      detailsLocked: '自動調整中は詳細設定を変更できません。',
      vadEngineLabel: '開発用: VADエンジン',
      vadEngineSilero: 'Silero',
      vadEngineFallback: 'フォールバック',
      vadEngineUnknown: '未判定',
      vadError: 'VADエラー:',
      diagOk: 'OK',
      diagNg: 'NG',
      diagCoi: 'COI',
      diagSecure: 'Secure',
      diagSab: 'SAB',
      diagSimd: 'SIMD',
      diagThreads: 'Threads',
      diagSw: 'SW',
      vadSensitivity: 'セリフ検出：感度',
      vadStability: 'セリフ検出：途切れにくさ',
      environmentLabel: '環境',
      environmentQuiet: '静か',
      environmentNormal: '普通',
      environmentNoisy: '騒がしい',
      vadDebugValues: '保持 {hold}f / 終了 {end}',
      recordingSection: '録音',
      playWhileRecording: '録音中の再生',
      playWhileRecordingHelp: '既存トラックを聞きながら録音する場合にON（遅延が気になる場合はOFF）',
    },
    help: {
      title: 'ヘルプ',
      close: '閉じる',
      overviewTitle: '概要',
      overviewBody:
        'タイムシート上で再生・録音・編集を行うツールです。1列は3秒（72コマ）、2列で1シート（6秒 / 144コマ）です。録音/アップロードした音声はブラウザ内で処理され、外部サーバーには送信されません。',
      timesheetTitle: 'タイムシートの見方',
      timesheetItems: [
        '黄色の行が現在の再生ヘッドです。',
        '左ルーラーはシート内のコマ数、右ルーラーは総時間の「秒+コマ」です。',
        '右ルーラーは「0+01」開始で、0+24→1+00のように秒が繰り上がります。',
        '右ルーラーは表示可能な行すべてに表示します。',
        '線の強さは「1秒」＞「0.5秒」＞「6コマ」の順です。',
        'セリフラベルは全幅表示で、連続区間は枠で強調されます。',
        '波形は縦方向に連続表示されます（トラック内で正規化）。',
        '選択範囲は点線の枠で表示されます。',
      ],
      zoomTitle: 'ズーム',
      zoomItems: [
        '上部バーのズームイン/ズームアウト/全体表示で調整します。',
        'スマホはピンチ操作でもシートを拡大できます。',
        'ズーム中のスクロールは2本指で行います。',
        '全体表示は100%の基準表示です。',
      ],
      playbackTitle: '再生と録音',
      playbackItems: [
        '再生ボタンで現在位置から再生します。',
        'スクラブ再生は、再生ヘッドを動かしながら1コマごとの音を断片的に再生する操作です。',
        'ルーラーやプレイヘッドをドラッグするとスクラブ再生できます。',
        '録音ボタンで録音開始、停止で終了します。',
        '録音は現在の再生ヘッド位置から始まります。',
        '準備中…表示の後に録音が開始します。',
        '録音トラックはタイムシート上のセルをタップして選択します。',
        '「その他」→「セリフ検出」で自動調整や感度/途切れにくさ/環境を調整できます。',
        '「その他」から録音中の再生ON/OFFを切り替えられます。',
      ],
      inputOptimizeTitle: '入力レベル最適化',
      inputOptimizeItems: [
        '「その他」→「入力最適化」からレベルテスト/録音ゲイン/リミッターを調整できます。',
        'レベルテストは開始後1秒ほど待ってから、普段の声量で3〜4秒話してください。',
        'しゃべりが検出できない場合はエラーになり、再テストを促します。',
        'テスト結果に合わせて録音ゲインが自動適用され、スライダーで微調整できます。',
        'リミッターはピークを軽く抑えて歪みを減らします（元がクリップしている音は完全には戻りません）。',
        '録音/再生中はテストやリミッター設定を変更できません。',
      ],
      editTitle: '編集',
      editItems: [
        'PCはドラッグ、スマホはタップしたままドラッグで範囲選択します。',
        'スマホはタップで1コマ選択できます。',
        '選択範囲は「切り取り」「削除」が可能です。',
        '選択範囲がある場合、「話」「無」でその範囲に一括適用し、選択解除後に次のコマへ移動します。',
        '選択メニューのセリフラベルで「セリフ/解除/自動」を切り替えられます。',
        '自動検出されたセリフの位置が違うとき、波形を見ながらスクラブ再生してラベルを貼り直せます。',
        '手動ラベルは自動判定より優先され、編集でも追従します。',
        '選択範囲で右クリック/長押しすると編集メニューを開けます。',
        'クリップボードがあると貼り付け（挿入/上書き）や消去を選べます。',
        '下部の「話」「無」で現在の1コマにセリフ/非セリフのラベルを付けられます。',
        '「話」「無」を押すと次のコマへ移動します（再生/録音中は不可）。',
        '+1fボタンで無音フレームを挿入します。',
        '-1fボタンで現在の行を削除して詰めます（選択範囲がある場合は範囲削除）。',
      ],
      exportTitle: 'インポート / 書き出し',
      exportItems: [
        '「その他」から音声ファイルをトラックへ読み込めます。',
        'トラック別WAVのZIPや、シート画像を書き出せます。',
        'WAVは最長トラックに合わせて無音が入ります。',
      ],
      shortcutsTitle: 'ショートカット',
      shortcutsItems: [
        'Undo: Ctrl/Cmd + Z',
        'Redo: Ctrl/Cmd + Y / Shift + Ctrl/Cmd + Z',
        'Cut: Ctrl/Cmd + X',
        'Paste: Ctrl/Cmd + V（Shiftで上書き）',
        'Scrub: ↑ / ↓',
      ],
      tipsTitle: '操作のコツ',
      tipsItems: [
        'ルーラーやトラックをタップすると再生ヘッドを移動できます。',
        'プレイヘッド（黄色の行）をドラッグするとスクラブ再生できます。',
        '上部のスピーカーアイコンからトラックをミュートできます。',
        '全トラック操作は下部の「全」ボタンで切り替えます。',
        '横スクロールでシートを移動できます。',
      ],
    },
    timesheet: {
      wrapUp: '↑ 続き',
      wrapDown: '↓ 続き',
    },
    app: {
      confirmReset:
        'プロジェクトを初期化します。\n録音データも含め、現在の作業内容はすべて失われます。\nよろしいですか？',
      exportAudioFailed: '音声のエクスポートに失敗しました。',
      exportSheetFailed: 'シート画像のエクスポートに失敗しました。',
      recordingError: '録音中にエラーが発生しました。',
      browserNotSupported: 'お使いのブラウザは録音機能をサポートしていません。',
      inputTestCanceled: 'レベルテストを中断しました。',
      micNotFound: 'マイクが見つかりませんでした。マイクが接続されていることを確認してください。',
      micNotAllowed: 'マイクの使用が許可されていません。ブラウザの設定を確認してください。',
      micNotReadable: 'マイクにアクセスできません。他のアプリが使用中の可能性があります。',
      startRecordingFailed: '録音の開始に失敗しました。',
      decodeAudioFailed:
        '音声データのデコードに失敗しました。録音が短すぎるか、ブラウザが対応していない形式の可能性があります。',
      loadAudioFailed: '音声ファイルの読み込みに失敗しました。',
      cutFailed: '切り取り操作に失敗しました。',
      deleteFailed: '削除操作に失敗しました。',
      pasteAllTracksRequired: '全トラック貼り付けには、全トラックの切り取りクリップが必要です。',
      clipMissing: 'クリップデータが不足しています。もう一度切り取りしてください。',
      trackClipMissing: '対象トラックのクリップがありません。',
      pasteInsertFailed: '貼り付け（挿入）に失敗しました。',
      pasteOverwriteFailed: '貼り付け（上書き）に失敗しました。',
      insertFrameFailed: '+1f 挿入に失敗しました。',
      deleteFrameFailed: '-1f 削除に失敗しました。',
      inputTestBusy: '録音や再生中はレベルテストを開始できません。',
      inputTestUnsupported: 'お使いのブラウザは録音機能をサポートしていません。',
      inputTestStart: 'テスト開始。1秒ほど待ってから普段の声量で話してください。',
      inputTestNoAudio: '音声が検出できませんでした。もう一度テストしてください。',
      inputTestLowSpeech: '声がほとんど検出できませんでした。普段の声量で話してみてください。',
      inputTestComplete: 'テスト完了。{gain} を適用しました（ピーク {peak} dBFS / 平均 {rms} dBFS）。',
      inputTestGainMaxed: ' 入力が小さいため、最大まで持ち上げています。',
      inputTestGainMin: ' 入力が大きいため、最小まで下げています。',
      inputTestClipped: ' 入力が飽和気味です。可能ならOS側の入力を下げてください。',
      inputTestFailed: 'テストに失敗しました。',
      inputTestFailedWithMessage: 'テストに失敗しました: {message}',
      inputTestRunningBlocked: '録音や再生中はレベルテストを開始できません。',
      targetAllTracks: '全トラック',
      trackFallback: 'トラック {track}',
    },
  },
  en: {
    topBar: {
      resetTitle: 'Reset',
      sheetLabel: 'Sheet {sheetNumber}',
      selectionSuffix: ' / Sel {selection}',
      zoomOutTitle: 'Zoom out (to 100%)',
      zoomResetTitle: 'Reset zoom',
      zoomResetAria: 'Reset zoom',
      zoomInTitle: 'Zoom in',
      undoTitle: 'Undo',
      redoTitle: 'Redo',
      muteTitle: 'Mute',
      helpTitle: 'Help',
      moreTitle: 'More',
    },
    transport: {
      recordStop: 'Stop',
      recordPreparing: 'Preparing…',
      recordProcessing: 'Processing…',
      recordStart: 'Record',
      recordTrackIndicator: 'REC T{track}',
      playTitle: 'Play',
      pauseTitle: 'Pause',
      allTracksTitle: 'All tracks',
      allTracksLabel: 'All',
      markSpeechTitle: 'Apply speech to selection (or 1 frame)',
      markSpeechLabel: 'Sp',
      markNonSpeechTitle: 'Mark selection as non-speech (or 1 frame)',
      markNonSpeechLabel: 'Ns',
      deleteFrameTitle: '-1f (Delete / delete selection)',
      insertFrameTitle: '+1f (Insert silence)',
    },
    editPalette: {
      selectionCount: '{count} frames selected',
      close: 'Close',
      clearSelection: 'Clear',
      cut: 'Cut',
      delete: 'Delete',
      speechLabel: 'Speech Label',
      speech: 'Speech',
      nonSpeech: 'Clear',
      auto: 'Auto',
      clipboard: 'Clipboard',
      pasteInsert: 'Paste (Insert)',
      pasteOverwrite: 'Paste (Overwrite)',
      clearClipboard: 'Clear clipboard',
    },
    trackMute: {
      title: 'Mute',
    },
    more: {
      title: 'More',
      close: 'Close',
      exportSection: 'Export',
      exportAudio: 'Download per-track WAV as ZIP',
      exportCurrent: 'Current',
      exportAll: 'All sheets',
      uploadSection: 'Import',
      uploadLabel: 'Import audio to {track}',
      inputOptimizeSection: 'Input Optimization',
      inputOptimizeDescription:
        'After starting the test, wait about 1 second, then speak at your normal level for 3–4 seconds. Gain is adjusted automatically.',
      inputTestStart: 'Start level test',
      inputTestRunning: 'Measuring…',
      inputTestResult: 'Recommended {recommended} / Applied {applied}',
      inputGainLabel: 'Recording gain',
      limiterLabel: 'Limiter',
      limiterAria: 'Toggle limiter',
      limiterHelp:
        'Gently reduces near-clipping peaks to lessen distortion (already clipped audio cannot be fully restored).',
      limiterLocked: 'Limiter settings cannot be changed during recording/playback.',
      vadSection: 'VAD',
      vadAuto: 'Auto tune',
      vadAutoAria: 'Toggle VAD auto tune',
      vadAutoCaptionOn: 'Auto-tunes after 6+ recorded frames',
      vadAutoCaptionOff: 'Adjust sensitivity and stability manually',
      inputLevel: 'Input level',
      detailsLabel: 'Details',
      detailsOpen: 'Open',
      detailsClose: 'Close',
      detailsLocked: 'Details cannot be changed while auto-tune is on.',
      vadEngineLabel: 'Debug: VAD engine',
      vadEngineSilero: 'Silero',
      vadEngineFallback: 'Fallback',
      vadEngineUnknown: 'Unknown',
      vadError: 'VAD error:',
      diagOk: 'OK',
      diagNg: 'NG',
      diagCoi: 'COI',
      diagSecure: 'Secure',
      diagSab: 'SAB',
      diagSimd: 'SIMD',
      diagThreads: 'Threads',
      diagSw: 'SW',
      vadSensitivity: 'VAD: Sensitivity',
      vadStability: 'VAD: Stability',
      environmentLabel: 'Environment',
      environmentQuiet: 'Quiet',
      environmentNormal: 'Normal',
      environmentNoisy: 'Noisy',
      vadDebugValues: 'hold {hold}f / end {end}',
      recordingSection: 'Recording',
      playWhileRecording: 'Play while recording',
      playWhileRecordingHelp: 'Turn on to monitor existing tracks while recording (turn off if latency bothers you)',
    },
    help: {
      title: 'Help',
      close: 'Close',
      overviewTitle: 'Overview',
      overviewBody:
        'This tool lets you play, record, and edit on a timesheet. One column is 3 seconds (72 frames), and two columns make one sheet (6 seconds / 144 frames). Recorded/uploaded audio is processed locally in the browser and is not sent to external servers.',
      timesheetTitle: 'Reading the Timesheet',
      timesheetItems: [
        'The yellow row is the current playhead.',
        'Left ruler shows frame count within the sheet; right ruler shows total time as seconds+frames.',
        'Right ruler starts at 0+01 and rolls over like 0+24 → 1+00.',
        'Right ruler is shown on all visible rows.',
        'Line weight priority is 1 second > 0.5 second > 6 frames.',
        'Speech labels span the full width; continuous ranges are outlined.',
        'Waveforms are shown continuously vertically (normalized per track).',
        'Selections are shown with a dotted outline.',
      ],
      zoomTitle: 'Zoom',
      zoomItems: [
        'Use the top bar zoom in/out/reset.',
        'On mobile, you can pinch to zoom.',
        'When zoomed, scroll with two fingers.',
        'Reset zoom returns to 100%.',
      ],
      playbackTitle: 'Playback & Recording',
      playbackItems: [
        'Play starts from the current position.',
        'Scrub plays short audio slices while moving the playhead.',
        'Drag the ruler or playhead to scrub.',
        'Record starts recording; Stop ends it.',
        'Recording starts at the current playhead.',
        'Recording begins after the "Preparing..." state.',
        'Select the recording track by tapping a cell on the timesheet.',
        'More → VAD lets you adjust auto-tune, sensitivity, stability, and environment.',
        'More lets you toggle play-while-recording.',
      ],
      inputOptimizeTitle: 'Input Optimization',
      inputOptimizeItems: [
        'More → Input Optimization lets you run a level test and adjust gain/limiter.',
        'After starting the test, wait about 1 second, then speak normally for 3–4 seconds.',
        'If no speech is detected, it shows an error and asks you to retry.',
        'The recommended gain is applied automatically, and you can fine-tune with the slider.',
        'Limiter gently reduces peaks to lessen distortion (it cannot fully fix already-clipped audio).',
        'You cannot run tests or change the limiter during recording/playback.',
      ],
      editTitle: 'Editing',
      editItems: [
        'On PC, drag to select; on mobile, tap-and-drag.',
        'On mobile, tap to select a single frame.',
        'Selected ranges can be cut or deleted.',
        'If a range is selected, Speech/Non-speech applies to the range, clears the selection, and moves to the next frame.',
        'Use the selection menu to set Speech / Non-speech / Auto.',
        'If auto-detected speech is off, scrub with the waveform and relabel.',
        'Manual labels override auto detection and follow edits.',
        'Right-click/long-press a selection to open the edit menu.',
        'With a clipboard, you can paste (insert/overwrite) or clear it.',
        'Use the bottom Speech/Non-speech buttons to label the current frame.',
        'Pressing Speech/Non-speech moves to the next frame (disabled during play/record).',
        'The +1f button inserts a silent frame.',
        'The -1f button deletes the current row and closes the gap (deletes the selection if present).',
      ],
      exportTitle: 'Import / Export',
      exportItems: [
        'Use More to import audio into a track.',
        'Export per-track WAV ZIPs or sheet images.',
        'WAVs are padded with silence to the longest track.',
      ],
      shortcutsTitle: 'Shortcuts',
      shortcutsItems: [
        'Undo: Ctrl/Cmd + Z',
        'Redo: Ctrl/Cmd + Y / Shift + Ctrl/Cmd + Z',
        'Cut: Ctrl/Cmd + X',
        'Paste: Ctrl/Cmd + V (Shift to overwrite)',
        'Scrub: ↑ / ↓',
      ],
      tipsTitle: 'Tips',
      tipsItems: [
        'Tap the ruler or track to move the playhead.',
        'Drag the playhead (yellow row) to scrub.',
        'Use the speaker icon on the top bar to mute tracks.',
        'Toggle all-track operations with the bottom "All" button.',
        'Scroll horizontally to move across sheets.',
      ],
    },
    timesheet: {
      wrapUp: '↑ More',
      wrapDown: '↓ More',
    },
    app: {
      confirmReset:
        'Reset the project.\nAll current work including recordings will be lost.\nContinue?',
      exportAudioFailed: 'Failed to export audio.',
      exportSheetFailed: 'Failed to export sheet images.',
      recordingError: 'An error occurred during recording.',
      browserNotSupported: 'Your browser does not support recording.',
      inputTestCanceled: 'Level test canceled.',
      micNotFound: 'Microphone not found. Please check that it is connected.',
      micNotAllowed: 'Microphone access is not allowed. Check your browser settings.',
      micNotReadable: 'Cannot access the microphone. It may be in use by another app.',
      startRecordingFailed: 'Failed to start recording.',
      decodeAudioFailed:
        'Failed to decode audio data. The recording may be too short or the format unsupported.',
      loadAudioFailed: 'Failed to load the audio file.',
      cutFailed: 'Cut failed.',
      deleteFailed: 'Delete failed.',
      pasteAllTracksRequired: 'Pasting to all tracks requires an all-tracks clip.',
      clipMissing: 'Clip data is missing. Please cut again.',
      trackClipMissing: 'No clip for the target track.',
      pasteInsertFailed: 'Paste (insert) failed.',
      pasteOverwriteFailed: 'Paste (overwrite) failed.',
      insertFrameFailed: 'Failed to insert +1f.',
      deleteFrameFailed: 'Failed to delete -1f.',
      inputTestBusy: 'Cannot start a level test during recording or playback.',
      inputTestUnsupported: 'Your browser does not support recording.',
      inputTestStart: 'Test started. Wait about 1 second, then speak at your normal level.',
      inputTestNoAudio: 'No audio detected. Please try again.',
      inputTestLowSpeech: 'Could not detect enough speech. Please speak at your normal level.',
      inputTestComplete: 'Test complete. Applied {gain} (peak {peak} dBFS / avg {rms} dBFS).',
      inputTestGainMaxed: ' Input is low; using maximum gain.',
      inputTestGainMin: ' Input is hot; using minimum gain.',
      inputTestClipped: ' Input appears clipped. If possible, lower the OS input level.',
      inputTestFailed: 'Level test failed.',
      inputTestFailedWithMessage: 'Level test failed: {message}',
      inputTestRunningBlocked: 'Cannot start a level test during recording or playback.',
      targetAllTracks: 'All tracks',
      trackFallback: 'Track {track}',
    },
  },
};

const resolvePath = (root: Record<string, I18nValue>, path: string): I18nValue | undefined => {
  const parts = path.split('.');
  let current: I18nValue = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, I18nValue>)[part];
  }
  return current;
};

const interpolate = (template: string, params?: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params?.[key];
    return value === undefined || value === null ? '' : String(value);
  });

export const createI18n = (language: Language): { t: Translator; list: ListTranslator } => {
  const dictionary = messages[language] ?? messages.ja;
  const fallback = messages.ja;

  const t: Translator = (key, params) => {
    const value = resolvePath(dictionary, key) ?? resolvePath(fallback, key);
    if (typeof value === 'string') return interpolate(value, params);
    return key;
  };

  const list: ListTranslator = (key) => {
    const value = resolvePath(dictionary, key) ?? resolvePath(fallback, key);
    return Array.isArray(value) ? value : [];
  };

  return { t, list };
};

export const getInitialLanguage = (): Language => {
  if (typeof navigator !== 'undefined') {
    const locales = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
    const primary = locales[0]?.toLowerCase() ?? '';
    if (primary.startsWith('ja')) return 'ja';
    if (primary) return 'en';
  }
  return 'ja';
};
