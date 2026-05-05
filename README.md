# Pencil Room / Z Fold Pinch PWA v4

Galaxy Z Fold 5 の見開き・分割画面利用を想定した、手書きノート + スライドPNG書き出し用PWAです。

## v4.0.0 updates

- 標準的なノートアプリに近いツールレールUI
- ツールごとの設定保存
  - Silky / Graphite / Clean / Marker / Eraser それぞれに太さ・濃さ・補正などを保持
- 消しゴムモード追加
  - Area: 触れた範囲だけ消す
  - Stroke: 触れたストロークを丸ごと消す
- 内部的にストロークモデルを保持
  - 今後の選択・移動・編集に拡張しやすい構造
- Undo / Redo
- S Pen pressure floor / gain
- 二本指ピンチズーム対応
- 画像追加、ドラッグ&ドロップ、クリップボード貼り込み
- Galaxy AI Select / Smart SelectからのShare Target受け取り
- Share PNG → OneDrive保存導線
- PC側でPNGをPowerPointに追加する監視スクリプト維持

## Folder structure

```txt
pencil-room-zfold-pinch-pwa-v4/
  index.html
  package.json
  vite.config.js
  src/
    App.jsx
    main.jsx
    styles.css
  public/
    manifest.webmanifest
    sw.js
    icons/
      icon-192.png
      icon-512.png
  pc-tools/
    watch_onedrive_to_ppt.py
  VERSION.txt
  README.md
```

## Vercel

```txt
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

## Local dev

```bash
npm install
npm run dev
```

## OneDrive → PowerPoint watcher

```bash
pip install python-pptx watchdog

python pc-tools/watch_onedrive_to_ppt.py ^
  --inbox "C:\Users\YOURNAME\OneDrive\PencilRoom\inbox" ^
  --pptx "C:\Users\YOURNAME\OneDrive\PencilRoom\deck.pptx" ^
  --processed "C:\Users\YOURNAME\OneDrive\PencilRoom\processed"
```

