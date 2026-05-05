# Pencil Room Z Fold PWA

Galaxy Z Fold 5 の見開き利用を想定した、キャンバス集中UIの手書きスライドノートです。

## 主な仕様

- Vite + React
- PWA対応
  - `manifest.webmanifest`
  - `sw.js`
  - `main.jsx` で service worker 登録
- Galaxy Z Fold 5 見開き向け
  - ページ一覧と設定は格納式
  - 下部フローティングツールバー
  - キャンバス中心UI
- 二本指以上の誤描画を抑制
  - 1つの primary pointer のみ描画
  - 二本指以上の入力は描画しない
- Share PNG → OneDrive `/PencilRoom/inbox` 保存想定
- 画像追加、ドラッグ&ドロップ、クリップボード画像貼り付け対応

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
npm run preview
```

## Vercel

- Framework Preset: Vite
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

## PWAについて

VercelにデプロイするとHTTPSになるため、Android Chrome / Samsung Internet でホーム画面追加しやすくなります。
Service Workerは本番ビルド時のみ登録します。
