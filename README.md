# Kawaguchiko WeatherScape

富士山と湖畔の天候観察シミュレーター。
河口湖北岸のキャンプサイトから湖越しの富士山を望む3D空間を、36種類の天候・四季・時刻で観察できる。

## 起動

```bash
npm install
npm run dev
```

## 操作

| 操作 | 動作 |
| --- | --- |
| 左ドラッグ | 視点回転 |
| 右ドラッグ | 移動 |
| ホイール | ズーム |
| W A S D | 歩行 |
| H | UI表示切替 |
| Space | 一時停止 |
| P | スクリーンショット (PNG) |
| R | 録画 (WebM) |
| F | 初期視点に戻る |

## 技術

React / TypeScript / Vite / Three.js / React Three Fiber / Drei / Zustand / Web Audio API。
テクスチャ・モデル・音声ファイルは使わず、すべて手続き的に生成。
