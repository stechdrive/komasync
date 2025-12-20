import React from 'react';
import { HelpCircle, X } from 'lucide-react';

type HelpSheetProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const HelpSheet: React.FC<HelpSheetProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-x-0 bottom-0 safe-area-bottom">
        <div className="bg-white rounded-t-2xl shadow-xl border-t border-gray-200 max-h-[80vh] overflow-hidden flex flex-col">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="font-bold text-gray-800 flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-indigo-600" />
              ヘルプ
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-100"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto min-h-0 flex-1 space-y-5 text-[calc(var(--ui-sm)*2)] text-gray-700">
            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">概要</div>
              <p>
                タイムシート上で再生・録音・編集を行うツールです。1列は3秒（72コマ）、2列で1シート（6秒 /
                144コマ）です。
              </p>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">タイムシートの見方</div>
              <ul className="list-disc ml-4 space-y-1">
                <li>黄色の行が現在の再生ヘッドです。</li>
                <li>左ルーラーはシート内のコマ数、右ルーラーは総コマ数です。</li>
                <li>現在行の右ルーラーは「秒+コマ」（1スタート）で表示します。</li>
                <li>線の強さは「1秒」＞「0.5秒」＞「6コマ」の順です。</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">ズーム</div>
              <ul className="list-disc ml-4 space-y-1">
                <li>スマホはピンチ操作でシートを拡大できます。</li>
                <li>PCは上部バーのズームイン/全体表示ボタンで調整します。</li>
                <li>全体表示は100%の基準表示です。</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">再生と録音</div>
              <ul className="list-disc ml-4 space-y-1">
                <li>再生ボタンで現在位置から再生します。</li>
                <li>録音ボタンで録音開始、停止で終了します。</li>
                <li>準備中…表示の後に録音が開始します。</li>
                <li>録音トラックはタイムシート上のセルをタップして選択します。</li>
                <li>「その他」→「セリフ検出」で自動調整や感度/途切れにくさ/環境を調整できます。</li>
                <li>「その他」から録音中の再生ON/OFFを切り替えられます。</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">編集</div>
              <ul className="list-disc ml-4 space-y-1">
                <li>PCはドラッグ、スマホはタップしたままドラッグで範囲選択します。</li>
                <li>選択範囲は「切り取り」「削除」が可能です。</li>
                <li>タイムシート上で右クリック/長押しすると貼り付けメニューを開けます。</li>
                <li>クリップボードがあれば「挿入」「上書き」で貼り付けます。</li>
                <li>+1fボタンで無音フレームを挿入します。</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">インポート / 書き出し</div>
              <ul className="list-disc ml-4 space-y-1">
                <li>「その他」から音声ファイルをトラックへ読み込めます。</li>
                <li>トラック別WAVのZIPや、シート画像を書き出せます。</li>
                <li>WAVは最長トラックに合わせて無音が入ります。</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">ショートカット</div>
              <ul className="list-disc ml-4 space-y-1 font-mono text-[calc(var(--ui-xs)*2)]">
                <li>Undo: Ctrl/Cmd + Z</li>
                <li>Redo: Ctrl/Cmd + Y / Shift + Ctrl/Cmd + Z</li>
                <li>Cut: Ctrl/Cmd + X</li>
                <li>Paste: Ctrl/Cmd + V（Shiftで上書き）</li>
                <li>Scrub: ↑ / ↓</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[calc(var(--ui-xs)*2)] text-gray-500">操作のコツ</div>
              <ul className="list-disc ml-4 space-y-1">
                <li>ルーラーやトラックをタップすると再生ヘッドを移動できます。</li>
                <li>プレイヘッド（黄色の行）をドラッグするとスクラブ再生できます。</li>
                <li>上部のスピーカーアイコンからトラックをミュートできます。</li>
                <li>全トラック操作は下部の「全」ボタンで切り替えます。</li>
                <li>横スクロールでシートを移動できます。</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
