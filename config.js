/**
 * 体育祭 順番待ちシステム - 共通設定
 *
 * Node.js サーバーで稼働する場合:
 *   apiUrl: '/api'  (同じサーバ上の /api を使う)
 *
 * Apps Script 等の外部サーバーを使う場合:
 *   apiUrl: 'https://...../exec'  (フルURLを指定)
 */
window.APP_CONFIG = {
  // バックエンドAPIのURL
  apiUrl: 'https://script.google.com/a/macros/g.neec.ac.jp/s/AKfycbzQkxa6SBhmIegtEhABnPpDfbhtCzUJkz7wOqXtzpoethz49zxCo8a2J-kPgk23U7u6/exec',

  // 種目名 (受付フォームの選択肢と完全一致させること)
  events: [
    { key: 'strikeout', name: 'ストラックアウト', color: '#ef4444', accent: '#fb923c' },
    { key: 'bowling',   name: 'ジャイアントボーリング', color: '#2563eb', accent: '#22d3ee' }
  ],

  // 1人あたりの所要時間 (分) ※運営画面から変更可、localStorageに保存される
  defaultMinutesPerPerson: 3,

  // データ更新間隔 (ミリ秒)
  pollIntervalMs: 5000,

  // 表示する「次の人」の最大件数
  upcomingCount: 6
};
