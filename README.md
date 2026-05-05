# Pencil Room / Z Fold Low-Latency PWA v5

Galaxy Z Fold 5 + S Pen 向けに、書いている最中の軽さを優先して再調整した版です。

## v5.0.0 updates

- 低遅延ライブ描画
  - 書いている最中は差分セグメントだけを直接描画
  - 全ストローク再描画は確定後に回す
- Live performance
  - Turbo: 書いている最中は軽い線、確定後に質感を整える
  - Rich: 書いている最中も質感を強める
- S Pen感度設定を拡張
  - pressure floor
  - pressure gain
  - light-touch curve / gamma
- Silky Pen 初期値を軽い筆記向けに調整
  - smoothingを下げて、追従遅れを減らす
  - 軽い筆圧でも線が出やすい
- Concepts参考の実装メモ
  - pressure / tilt / velocity
  - live smoothing
  - tool presets
  - stylusとfinger actionの分離

## Recommended setting for light handwriting

```txt
Tool: Silky
Live performance: Turbo
S Pen pressure floor: 0.34 - 0.45
S Pen pressure gain: 2.9 - 4.0
S Pen light-touch curve: 0.45 - 0.65
smoothing: 0.12 - 0.28
grain: 0
```

## Vercel

```txt
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```
