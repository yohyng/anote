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


## v5.5.0 PWA update behavior

This patch fixes a likely version-update issue in installed PWAs.

What changed:
- `APP_VERSION` is now `v5.5.0`.
- `public/sw.js` uses a versioned cache name: `pencil-room-app-v5.5.0`.
- Legacy app caches such as `pencil-room-v2` are deleted on Service Worker activation.
- `src/main.jsx` registers `/sw.js?v=v5.5.0` with `updateViaCache: "none"`.
- The app shows an `Update` button when a waiting Service Worker is detected.
- Settings includes a PWA update section.

If Android still shows an older version:
1. Open the Vercel URL in Chrome directly and reload once.
2. Close and reopen the installed PWA.
3. If it still persists, remove the installed app and install it again.
4. As a developer check: Chrome DevTools > Application > Service Workers > Update / Unregister.


## v5.5.0 updates

- Galaxy Z Fold split-screen / narrow vertical layout support.
- Header buttons and bottom tool rail are horizontally scrollable and compact on narrow widths.
- UI shell changed to a stricter black/white palette.
- Canvas content is scaled when the app window is resized, so handwriting and pasted images keep their relative position and apparent scale.
- Service Worker cache version updated to v5.5.0.


## v5.5.0 updates

- Canvas is true white by default.
- Removed the on-canvas tool/mode/zoom overlay so Z Fold split-screen stays clean.
- Tool selection remains available from the header tool button and Settings.
- Increased canvas backing resolution with a capped boost for smoother handwriting when zoomed.
- Lowered live point threshold for smoother Bezier-style curves.
- Service Worker cache version updated to v5.5.0.


## v5.5.0 updates

- Added subtle ink pooling / たまり behavior.
- Pooling is strongest during slower, slightly higher-pressure strokes and around curves.
- Added `ink pooling / たまり` slider per drawing tool.
- Default is intentionally weak to avoid fake-looking blobs.
- Updated PWA cache/version to v5.5.0.


## v5.5.0 updates

- Restored the bottom tool rail for quick tool switching on Galaxy Z Fold.
- Pressing the active tool again opens the tool settings panel.
- Reduced black-dot artifacts:
  - texture dots no longer use a forced minimum alpha
  - graphite particles now follow opacity/density
  - ink pooling underpass is softer and opacity-safe
- Canvas reserves extra bottom space for the restored tool rail.
