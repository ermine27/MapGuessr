# MapGuessr Tools — 利用者向けガイド

`tools/` ディレクトリには、マップデータを作成・検証するための3つのCLIスクリプトと2つのHTMLビューワーが含まれています。

```
tools/
├── extract-area.js      エリア（国・州・大陸）のGeoJSONを抽出するCLIツール
├── generate-map.js      Street Viewロケーションを自動収集してマップJSONを生成するCLIツール
├── calc-map-params.js   マップのスコアパラメータを計算するCLIツール
├── preview-area.html    GeoJSONエリアファイルをブラウザで確認するビューワー
├── preview-map.html     生成済みマップJSONをブラウザで確認するビューワー
├── areas/               GeoJSON元データディレクトリ
│   ├── ne_10m_admin_0_countries.geojson   （Natural Earth: 国境ポリゴン）
│   └── ne_10m_admin_1_states_provinces.geojson （Natural Earth: 州境ポリゴン）
└── output/              生成物ディレクトリ
    ├── areas/           extract-area.js の出力
    └── maps/            generate-map.js の出力
```

---

## 典型的なワークフロー

```
1. extract-area.js  →  エリアGeoJSONを生成
         ↓
2. preview-area.html →  エリアの形状をブラウザで確認
         ↓
3. generate-map.js  →  マップJSONを生成（Street View Metadata API使用）
         ↓
4. preview-map.html →  生成されたピンをブラウザで確認
         ↓
5. calc-map-params.js →  スコアパラメータを計算し、map-list.json に反映
```

---

## 事前準備

### Node.js
`extract-area.js`、`generate-map.js`、`calc-map-params.js` の実行に Node.js（v14以降）が必要です。

### Natural Earth データ
`extract-area.js` の実行には、以下の2ファイルが `tools/areas/` に必要です。

| ファイル名 | 用途 |
|-----------|------|
| `ne_10m_admin_0_countries.geojson` | 国境ポリゴン（国・大陸モードで使用） |
| `ne_10m_admin_1_states_provinces.geojson` | 州・都道府県ポリゴン（state モードで使用） |

[Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/) からダウンロードし、`tools/areas/` に配置してください。

### Google Maps API キー
`generate-map.js` と HTML ビューワーの使用に必要です。  
Street View Metadata API（`generate-map.js` が使用）は**無料**です（課金なし）。

---

## 1. extract-area.js — エリア抽出

国・州・大陸の境界ポリゴンを Natural Earth データから切り出して GeoJSON ファイルを生成します。

### 使い方

```bash
node tools/extract-area.js <mode> <identifier> [options]
```

### モード一覧

#### `country` — 国を抽出

```bash
node tools/extract-area.js country JP
node tools/extract-area.js country US --output tools/output/areas/usa.geojson
```

`ISO 3166-1 alpha-2` コード（`JP`、`US`、`DE` など）で国を指定します。  
出力ファイルは省略時 `tools/output/areas/jp.geojson` のようになります。

#### `state` — 州・都道府県を抽出

```bash
# HASCコードで1件だけ抽出
node tools/extract-area.js state US.CA

# 国コード+名前で抽出
node tools/extract-area.js state US --name "California"

# 指定国の全州をまとめて抽出
node tools/extract-area.js state JP
```

#### `continent` — 大陸を抽出

```bash
node tools/extract-area.js continent Asia
node tools/extract-area.js continent "North America"
node tools/extract-area.js continent North America   # クォートなしでも可
```

有効な大陸名: `Africa` / `Antarctica` / `Asia` / `Europe` / `North America` / `Oceania` / `South America`

#### `list` — 一覧表示（ファイル出力なし）

```bash
node tools/extract-area.js list countries        # 全国家一覧
node tools/extract-area.js list states JP        # 日本の都道府県一覧
node tools/extract-area.js list continents       # 大陸一覧と国数
```

### オプション

| オプション | 説明 |
|-----------|------|
| `--output <path>` | 出力ファイルパスを指定 |
| `--areas-dir <path>` | GeoJSONデータの置き場所を変更 |
| `-h, --help` | ヘルプ表示 |

---

## 2. generate-map.js — マップ生成

指定エリア（GeoJSON）内でランダムに Street View ロケーションを収集し、マップ用 JSON ファイルを生成します。

### 使い方

```bash
node tools/generate-map.js --area <geojson> --count <n> [options]
```

### 必須引数

| 引数 | 説明 |
|------|------|
| `--area <path>` | エリアGeoJSONファイルのパス（`extract-area.js` で生成したもの） |
| `--count <n>` | 収集するロケーション数 |
| `--api-key <key>` | Google Maps API キー（または環境変数 `GMAPS_KEY`） |

### オプション引数

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--output <path>` | `output/maps/<name>-<count>.json` | 出力ファイルパス |
| `--no-official-only` | — | Google オフィシャル以外のパノラマも含める |
| `--min-distance <km>` | `0` | ロケーション間の最小距離（km）。密集を防ぐ |
| `--radius <m>` | `1000` | Street View検索半径（メートル） |
| `--concurrency <n>` | `5` | 並列APIリクエスト数 |
| `--save-interval <n>` | `100` | チェックポイント保存間隔（ロケーション数単位） |
| `--resume <path>` | — | チェックポイントファイルから再開 |
| `-h, --help` | — | ヘルプ表示 |

### 使用例

```bash
# 日本全土で1000件
node tools/generate-map.js \
  --area tools/output/areas/jp.geojson \
  --count 1000 \
  --api-key YOUR_KEY

# 北米で500件を5km以上離れた場所に限定
node tools/generate-map.js \
  --area tools/output/areas/north-america.geojson \
  --count 500 \
  --min-distance 5 \
  --api-key YOUR_KEY

# 環境変数でAPIキーを渡す
$env:GMAPS_KEY = "YOUR_KEY"   # PowerShell
node tools/generate-map.js --area tools/output/areas/jp.geojson --count 1000
```

### 中断・再開

`Ctrl+C` で中断すると、チェックポイントファイル（`*.tmp.json`）が自動保存されます。  
`--resume` で再開できます。

```bash
node tools/generate-map.js \
  --area tools/output/areas/jp.geojson \
  --count 1000 \
  --api-key YOUR_KEY \
  --resume tools/output/maps/jp-1000.json.tmp.json
```

### 出力形式

```json
{"customCoordinates":[
{"panoId":"...","lat":35.123456,"lng":139.123456,"heading":214.3,"pitch":0,"zoom":0,"countryCode":"JP","stateCode":"JP.13"},
{"panoId":"...","lat":34.876543,"lng":135.456789,"heading":87.1,"pitch":0,"zoom":0,"countryCode":"JP","stateCode":"JP.27"}
]}
```

1ロケーション1行の compact 形式です。

---

## 3. calc-map-params.js — マップパラメータの計算

マップ JSON を読み込み、スコア式のスケール定数 `S` と `map-list.json` 用のパラメータを算出します。

このツールは、マップごとに異なる広さを考慮して `S`・`mapCenter`・`mapZoom` を決めるために使います。

処理の流れ:

1. マップJSONを読み込む
2. 最北端・最南端・最東端・最西端の4点を求める
3. その4点の全ペア距離（Haversine）から最大値を `Dmax` とする
4. 係数 `K` を使って `S = Dmax / K` を算出する
5. 算出した `S` でスコア帯ごとの距離目安を表示する

### スコア式

$$
score = 5000 \cdot e^{-\frac{distance}{S}}
$$

`S` が大きいほど距離に対するスコア減衰が緩やかになります。

### 対応するJSON形式

- 配列形式

```json
[
  { "lat": 35.0, "lng": 139.0 }
]
```

- オブジェクト形式

```json
{
  "customCoordinates": [
    { "lat": 35.0, "lng": 139.0 }
  ]
}
```

### 使い方

```bash
node tools/calc-map-params.js <map-file.json> <K>
```

```bash
# 日本マップで K=12
node tools/calc-map-params.js docs/maps/Japan-1000-locations.json 12
```

### 引数

| 引数 | 説明 |
|------|------|
| `<map-file.json>` | 読み込むマップ JSON ファイルのパス |
| `<K>` | 感度係数（正の数）。`K = Dmax / S` の逆数的な意味 |

### 出力内容

- 地点数
- バウンディングボックスの端点（最北端・最南端・最東端・最西端）
- `Dmax`（暫定の最大距離）
- `S = Dmax / K`
- スコアプレビュー（5000点、4999点、4990点...1点、0点）
- `map-list.json` に貼り付けるスニペット

### 感度係数 K とは

`K` は、マップの最大距離 `Dmax` をどれだけ細かく分割して `S` を作るかを決める値です。

$$
S = \frac{Dmax}{K}
$$

同じマップ（同じ `Dmax`）で比較すると、`K` はスコア減衰の強さを調整する値として働きます。

- `K = 12 ~ 15` を起点に調整
- `K` を大きくすると `S` は小さくなり、少し距離が離れただけで点数が下がりやすくなります。
- `K` を小さくすると `S` は大きくなり、距離が離れても点数が下がりにくくなります。

例として `Dmax = 2400km` のとき:

- `K = 12` なら `S = 200km`
- `K = 15` なら `S = 160km`

このように、`K` を調整することで「どの程度のズレで何点になるか」の体感をマップごとに合わせられます。

### K の目安

| K 値 | 傾向 |
|------|------|
| `K = 8〜10` | 緩やか（広いマップ向き） |
| `K = 12〜15` | 標準 |
| `K = 18〜` | 厳しめ（狭いマップ向き） |

出力されたスニペットを `docs/config/map-list.json` に反映してください。

### 注意点

- この `Dmax` は4端点ベースの近似です
- 地点数が非常に多いマップでも、全地点ペアの総当たり `O(n^2)` を避けて高速に算出できます

---

## 4. preview-area.html — エリアビューワー

`extract-area.js` で生成した GeoJSON ファイルをブラウザで視覚的に確認するツールです。

### 起動方法

ファイルをブラウザで直接開いてください。

```
file:///e:/source/MapGuessr/tools/preview-area.html
```

### 機能

- **ファイル選択・ドラッグ&ドロップ**: GeoJSONファイルを読み込む
- **ダークテーマ地図**: Google Maps 上でポリゴンを表示
- **BBox自動フィット**: ロード時に該当エリアへ自動ズーム
- **Feature 一覧パネル**: 複数フィーチャー（大陸モードなど）をリストで表示、クリックで個別フォーカス
- **APIキー管理**: `localStorage` に保存（再起動後も保持）

### 初回セットアップ

起動時に Google Maps JavaScript API キーを入力するダイアログが表示されます。

---

## 5. preview-map.html — マップビューワー

`generate-map.js` で生成したロケーション JSON をブラウザで確認するツールです。

### 起動方法

```
file:///e:/source/MapGuessr/tools/preview-map.html
```

### 機能

- **ファイル選択・ドラッグ&ドロップ**: ロケーション JSON（`customCoordinates` 形式・生配列の両方対応）を読み込む
- **全ロケーション表示**: 青い円マーカーで全ピンを地図上に表示
- **ピンクリック詳細**: クリックで `panoId`・座標・`heading`/`pitch`/`zoom`・`countryCode`/`stateCode` を表示
- **外部リンク**: InfoWindow から Google Maps / Street View を直接開く
- **一覧パネル**: 番号・座標・国コードの一覧（100件/ページのページネーション）
- **情報バー**: ロケーション数・含まれる国コード一覧・bbox 表示
- **APIキー管理**: `preview-area.html` と同じキーを共有

---

## よくある質問

**Q: Street View Metadata API は有料ですか？**  
A: 無料です。月間クォータへの影響もありません。`generate-map.js` での使用に課金は発生しません。

**Q: `countryCode` / `stateCode` はどのように設定されますか？**  
A: `generate-map.js` がエリアGeoJSON（`extract-area.js` の出力）のプロパティから取得します。外部APIは使用しません。

**Q: 生成に失敗しました（Street View がない地点が多い）**  
A: 海域・山岳など Street View がない地域では試行回数が増えます。`--concurrency` を上げるか、より Street View 密度の高いエリアを指定してください。

**Q: HTMLファイルが真っ白で何も表示されません**  
A: Google Maps JavaScript API キーが必要です。起動時のダイアログにキーを入力してください。
