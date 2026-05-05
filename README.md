# Pencil Room / Z Fold Pinch PWA v2

Galaxy Z Fold 5 の見開き・分割画面利用を想定した、手書きノート + スライドPNG書き出し用PWAです。

## 入っているもの

```txt
pencil-room-zfold-pinch-pwa-v2/
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
  README.md
```

## 主な仕様

- S Pen / 一本指で描画
- 二本指ピンチでキャンバスを拡大縮小
- 二本指中は描画しない
- ズーム中も座標補正してペン位置がズレにくい
- 画像の追加、ドラッグ&ドロップ、クリップボード貼り込み
- PWA Share Target 対応
  - Galaxy AI Select / Smart Select から共有した画像をPencil Roomに貼り込み
- 背景色選択
- 16:9 / 4:3 / 1:1 のスライド比率
- Share PNG → Android共有メニュー → OneDrive `/PencilRoom/inbox` に保存
- PC側でOneDriveフォルダを監視し、PowerPointにPNGを追記する想定

## Vercel デプロイ設定

```txt
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

## ローカル実行

```bash
npm install
npm run dev
```

## Android / Galaxy Z Fold 5 での使い方

1. VercelにデプロイしたURLをChromeまたはSamsung Internetで開く
2. メニューから「ホーム画面に追加」
3. Pencil RoomをPWAとして起動
4. S Penまたは一本指で描画
5. 二本指ピンチで拡大縮小
6. `Share` からPNGをOneDrive `/PencilRoom/inbox` に保存

## Galaxy AI Select / Smart Select からの貼り込み

PWAをホーム画面に追加後、共有先に Pencil Room が表示される場合があります。

```txt
Instagramなどを表示
↓
Galaxy AI Select / Smart Selectで範囲選択
↓
Share
↓
Pencil Room
↓
キャンバスに画像貼り込み
```

端末・ブラウザ・PWAインストール状態によって Share Target の表示有無は変わります。

## PowerPoint自動追加

`pc-tools/watch_onedrive_to_ppt.py` は、OneDriveに同期されたPNGフォルダを監視して、既存PPTXに新規スライドとして画像を追加するための補助スクリプトです。

必要ライブラリ:

```bash
pip install python-pptx watchdog
```

実行例:

```bash
python pc-tools/watch_onedrive_to_ppt.py ^
  --inbox "C:\Users\YOURNAME\OneDrive\PencilRoom\inbox" ^
  --pptx "C:\Users\YOURNAME\OneDrive\PencilRoom\deck.pptx" ^
  --processed "C:\Users\YOURNAME\OneDrive\PencilRoom\processed"
```

注意:
- PowerPointを開いたままだとPPTX保存に失敗することがあります。
- 複雑な既存テンプレートを完全保持したい場合は、PowerPoint COM版にするほうが安定します。
