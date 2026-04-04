# MapGuessr Tools — 開発者向けドキュメント

`tools/` 以下の各スクリプト・HTMLファイルの設計・実装詳細をまとめたドキュメントです。

---

## ディレクトリ構成

```
tools/
├── extract-area.js                     エリア抽出 CLI
├── generate-map.js                     マップ生成 CLI
├── enrich-map.js                       既存マップ補完 CLI
├── calc-map-params.js                  マップパラメータ計算 CLI
├── preview-area.html                   GeoJSONビューワー
├── preview-map.html                    マップJSONビューワー
├── tools-guide.md                      利用者向けガイド
├── tools-dev.md                        このファイル
├── areas/
│   ├── ne_10m_admin_0_countries.geojson        国境ポリゴン（Natural Earth 10m）
│   └── ne_10m_admin_1_states_provinces.geojson 州境ポリゴン（Natural Earth 10m）
└── output/
    ├── areas/                          extract-area.js の出力
    └── maps/                           generate-map.js の出力
```

---

## データフォーマット

### マップ JSON（ゲームデータ）

`docs/maps/` に配置するロケーションデータ。

```json
{
  "customCoordinates": [
    {
      "panoId":      "ShWR36PD86znCQODw5XusQ",
      "lat":         53.007965,
      "lng":         -2.186734,
      "heading":     26.63,
      "pitch":       7.04,
      "zoom":        1.05,
      "countryCode": "GB",
      "stateCode":   "GB.EN"
    }
  ]
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `panoId` | string | Street View パノラマID |
| `lat` / `lng` | number | 緯度 / 経度 |
| `heading` | number | 水平方向（0〜360°） |
| `pitch` | number | 垂直方向（-90〜90°） |
| `zoom` | number | ズームレベル（0〜）|
| `countryCode` | string \| null | ISO 3166-1 alpha-2 |
| `stateCode` | string \| null | HASC コード（例: `JP.13`） |

`generate-map.js` は `heading` をランダム (0〜360°)、`pitch` と `zoom` を `0` 固定で出力します。  
`cityCode` フィールドは現在未使用のため出力しません。

### GeoJSON エリアファイル（`extract-area.js` 出力）

**国モード (`country`) のプロパティ:**

```json
{
  "name":      "Japan",
  "iso_a2":    "JP",
  "continent": "Asia",
  "subregion": "Eastern Asia"
}
```

**州モード (`state`) のプロパティ:**

```json
{
  "name":       "Tokyo",
  "iso_a2":     "JP",
  "hasc":       "JP.TK",
  "country":    "Japan",
  "iso_3166_2": "JP-13"
}
```

`generate-map.js` は `iso_a2` → `countryCode`、州境GeoJSONの `code_hasc`（一部フォールバックで `hasc`）→ `stateCode` として出力 JSON に書き込みます。既存マップに対する後付け補完は `enrich-map.js` が担当します。

---

## extract-area.js

### 依存ライブラリ

標準モジュールのみ（`fs`, `path`）。外部依存なし。

### Natural Earth データについて

| 項目 | 内容 |
|---|---|
| **参照元** | [Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/) — 10m Cultural Vectors |
| **権利情報** | パブリックドメイン（[Natural Earth ライセンス](https://www.naturalearthdata.com/about/terms-of-use/)） |

リポジトリに同梱しているファイル:

| ファイル | 説明 |
|---|---|
| `ne_10m_admin_0_countries.geojson` | 国境ポリゴン。世界の国・地域を収録し、各フィーチャーが1つの国または地域に対応 |
| `ne_10m_admin_1_states_provinces.geojson` | 州・都道府県境ポリゴン。世界各国の第一行政区画（州・都道府県など）を収録 |

### 使用する Natural Earth プロパティ

**`ne_10m_admin_0_countries.geojson`（国）**

| プロパティキー | 内容 |
|---|---|
| `ISO_A2` | ISO 3166-1 alpha-2。`-99` の場合は不正値 |
| `NAME`, `NAME_EN` | 国名（`ISO_A2=-99` のフォールバック検索用） |
| `CONTINENT` | 大陸名（`list continents` / `continent` モードで使用） |
| `SUBREGION` | 地域名（出力プロパティに含める） |

> **ISO 3166-1 alpha-2** は国を識別す2文字のアルファベットコード（例: `JP` = 日本、`US` = アメリカ合衆国）。ISO（国際標準化機構）が定める国際規格。

**`ne_10m_admin_1_states_provinces.geojson`（州）**

| プロパティキー | 内容 |
|---|---|
| `iso_a2` | 国コード（小文字） |
| `name` | 州・都道府県名 |
| `code_hasc` | HASC コード（例: `JP.TK`） |
| `admin` | 国名 |
| `iso_3166_2` | ISO 3166-2 コード（例: `JP-13`） |

### 処理フロー

```
引数解析 (parseArgs)
    ↓
GeoJSONファイル読み込み (loadGeoJson)
    ↓
モード分岐
  country → filterByCountry()  → 1〜N Feature のFeatureCollectionを出力
  state   → filterByState()    → 1〜N Feature のFeatureCollectionを出力
  continent → filterByContinent() → N Feature のFeatureCollectionを出力
  list    → printList()           → stdout 出力のみ（ファイル出力なし）
    ↓
GeoJSON書き込み (writeGeoJson)
```

### 出力ファイル名のデフォルト規則

| モード | デフォルトファイル名 |
|---|---|
| `country JP` | `output/areas/jp.geojson` |
| `state US.CA` | `output/areas/us-ca.geojson` |
| `state JP`（全州） | `output/areas/jp-states.geojson` |
| `continent Asia` | `output/areas/asia.geojson` |
| `continent North America` | `output/areas/north-america.geojson` |

---

## generate-map.js

### 依存ライブラリ

標準モジュールのみ（`fs`, `path`, `https`）。

### 処理フロー詳細

```
引数解析 → バリデーション
    ↓
GeoJSON 読み込み → features[] 抽出
    ↓
チェックポイント読み込み（--resume 時）
    ↓
buildWeightTable(features)    ← Bbox面積に比例した累積重みテーブルを構築
    ↓
メインループ（collected.length < count の間）
    ├── samplePoint()          ← 重み付き選択 + BBox内ランダム点 + PIPテスト
    ├── fetchMetadata()        ← Street View Metadata API（HTTPS GET）
    ├── オフィシャルフィルタ    ← copyright に "google" を含むか
    ├── 最小距離フィルタ        ← Haversine距離
    ├── collected[] に追記
    └── save-interval ごとにチェックポイント保存
    ↓
writeOutput()                  ← 1ロケーション1行のJSON書き込み
    ↓
チェックポイントファイル削除
```

### PIP（Point-in-Polygon）アルゴリズム

レイキャスト法をスクラッチ実装。GeoJSON の `Polygon` / `MultiPolygon` に対応。  
穴あきポリゴン（外輪郭 `outer` + 内輪郭 `holes`）も正しく処理します。

```
pointInGeometry(lat, lng, geometry)
  Polygon  → pointInRing(outer) && !holes.some(pointInRing)
  MultiPolygon → polygons.some(polygon => Polygon 判定)
```

### GeoJSON フィーチャーとバウンディングボックス

**フィーチャー (Feature)** は GeoJSON の基本単位で、ジオメトリ（ポリゴン）とそのプロパティを持つオブジェクトです。`extract-area.js` が出力する GeoJSON は `FeatureCollection` 形式で、複数のフィーチャーを配列として持ちます。例えば `continent Asia` で抽出したファイルには国ごとに1つのフィーチャーが含まれ、`generate-map.js` はこれらから重み付きでサンプリング先を選択します。

**バウンディングボックス (Bounding Box / BBox)** は、フィーチャーのジオメトリを包む最小の矩形領域です。`minLat`・`maxLat`・`minLng`・`maxLng` の4値で定義されます。ランダム点のサンプリング時に、ませBBox内の点を生成してから PIP テストで絞り込むことで、複雑な形状のポリゴン内の点を効率的に得られます。

### 重み付きフィーチャー選択

大陸 GeoJSON（多数フィーチャー）でも国ごとのフィーチャーから均等にサンプリングするため、**バウンディングボックス面積**に比例した確率でフィーチャーを選択します。

```javascript
// 累積確率テーブル (0〜1)
table[i].cumulative = Σ(area[0..i]) / totalArea

// 選択: Math.random() を超える最初のエントリを選ぶ
```

> BBox面積ベースのため、細長い国（チリなど）と正方形に近い国（フランスなど）で面積が正確には対応しませんが、実用上は十分です。

### Haversine 距離計算

球面上の2点間の大圈距離を求める計算式で、`--min-distance` による近接除外に使用しています。

$$d = 2R \cdot \arcsin\!\left(\sqrt{\sin^2\!\frac{\Delta\phi}{2} + \cos\phi_1\cos\phi_2\sin^2\!\frac{\Delta\lambda}{2}}\right)$$

- $R = 6371\,\text{km}$（地球半径の近似値）
- $\phi$: 緯度（ラジアン）、$\lambda$: 経度（ラジアン）

楕円体補正は行わず、球体近似を使用しています。数千 km スケールの距離でも誤差 0.5% 未満であり、マップ生成用途には十分な精度です。

### Street View Metadata API

```
GET https://maps.googleapis.com/maps/api/streetview/metadata
  ?location=<lat>,<lng>
  &radius=<args.radius>  // デフォルト 1000m、--radius で変更可
  &source=outdoor
  &key=<apiKey>
```

レスポンス:

```json
{
  "status":    "OK",
  "pano_id":   "ShWR36PD86znCQODw5XusQ",
  "location":  { "lat": 53.007965, "lng": -2.186734 },
  "date":      "2023-06",
  "copyright": "© 2023 Google"
}
```

- `status === "REQUEST_DENIED"` / `"OVER_QUERY_LIMIT"` → 即エラー終了
- その他 `status !== "OK"` → スキップ
- `--official-only` 時: 著作権表示に “Google” が含まれていないパノラマはスキップ（Google オフィシャルのパノラマのみ採用）
- `stateCode` は `ne_10m_admin_1_states_provinces.geojson` を国コード別にインデックス化し、Street View API が返した実座標に対して PIP 判定して解決する
- **APIコスト: 無料**（Street View Static API の Metadata エンドポイントは課金対象外）

---

## enrich-map.js

既存のマップ JSON に対して `countryCode` / `stateCode` を後付け・再計算するための補完ツールです。旧生成物の再利用や、仕様変更後の一括更新に使います。

### 主な用途

- 過去に生成したマップにコード情報を追記する
- `countryCode` / `stateCode` が `null` のファイルを再計算する
- `--force` で既存値を含めて再解決する

### 処理フロー

```
入力JSON読み込み
    ↓
国境GeoJSON / 州境GeoJSON 読み込み
    ↓
bbox 付きルックアップテーブル構築
    ↓
各ロケーションについて
  ├── countryCode を PIP で補完
  └── stateCode を PIP で補完
    ↓
入力ファイルを上書き、または --output 先に保存
```

### 実装メモ

- 国コードは `ISO_A2` / `iso_a2` を優先して採用
- 州コードは `code_hasc` を優先し、必要に応じて `hasc` をフォールバック
- 速度改善のため、国・州ともに bbox による事前フィルタ後に PIP 判定を行う
- 出力は `generate-map.js` と同じ 1ロケーション1行の compact JSON 形式

### レート制限

100 QPS を超えないよう、1バッチ処理時間が `concurrency × 10ms` を下回る場合はスリープします。

```javascript
const minMs = candidates.length * 10;   // 100 QPS = 10ms/req
if (elapsed < minMs) await sleep(minMs - elapsed);
```

### チェックポイント

- 保存先: `<outputPath>.tmp.json`（`collected[]` の JSON 配列）
- 保存タイミング: `(collected.length % saveInterval === 0)` の時 + `SIGINT`
- `--resume <path>` で `collected[]` を復元してループを再開

### 出力形式の意図

```
{"customCoordinates":[
<JSON>,
<JSON>
]}
```

- `{"customCoordinates":[...]}` ラッパー: `docs/maps/Japan-1000-locations.json` と同一形式
- 1ロケーション1行: `git diff` で差分が追いやすく、途中断でも手動で編集しやすい

---

## calc-map-params.js

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

感度係数 `K` を用いて `S = Dmax / K` で求めます。

### 対応する入力形式

- 配列形式: `[{ "lat": 35.0, "lng": 139.0 }]`
- ラッパー形式: `{ "customCoordinates": [...] }`

内部では両形式を正規化し、計算対象を `locations[]` 配列として扱います。

### Dmax の算出方法

全地点を対象にした O(n²) の全ペア探索を避けるため、**4端点ベースの近似**を採用しています。

1. 全地点から最北端・最南端・最東端・最西端の4点を抽出
2. 4点の全ペア（6通り）の Haversine 距離を計算
3. 最大値を `Dmax` とする

経度方向の境界（例: 日付変更線を越えるマップ）は `normalizeLng360` → 最大ギャップ法で正しく処理します。

### 出力内容

- 地点数
- バウンディングボックスの端点（最北端・最南端・最東端・最西端）
- `Dmax`
- `S = Dmax / K`
- スコアプレビュー
- `docs/config/map-list.json` 用スニペット

### K の意味

`K` は `Dmax` に対するスコア減衰の強さを決める係数です。`K` を大きくすると `S` は小さくなり、減点が急になります。`K` を小さくすると `S` は大きくなり、減点が緩やかになります。

### 依存ライブラリ

標準モジュールのみ（`fs`, `path`）。

---

## preview-area.html

### 技術スタック

- Vanilla JS（フレームワークなし）
- Google Maps JavaScript API（`roadmap` タイプ、ダークテーマ）
- `google.maps.Data` レイヤーで GeoJSON をネイティブ描画

### 主要コンポーネント

| 関数 | 役割 |
|---|---|
| `loadMapsApi(key)` | `<script>` タグを動的に挿入して Maps API を遅延ロード |
| `initMap()` | `window.initMap` コールバック。Maps インスタンスと Data レイヤーを初期化 |
| `loadGeoJson(geojson)` | Data レイヤーに GeoJSON を追加、BBox フィット、Feature 一覧描画 |
| `applyDataLayerStyle(layer)` | アクティブ/非アクティブでフィルカラーを切り替え |
| `highlightFeature(idx)` | Feature リストとマップの両方をハイライト |
| `computeBounds(geojson)` | 全座標を走査して `LatLngBounds` を返す |
| `readFile(file)` | `FileReader` で JSON を読み込み `loadGeoJson` に渡す |

### APIキー管理

```javascript
const STORAGE_KEY = 'mapguessr_tools_api_key';
localStorage.getItem(STORAGE_KEY)   // 読み込み
localStorage.setItem(STORAGE_KEY, key)  // 保存
```

`preview-map.html` と同一の `STORAGE_KEY` を使うため、一方で設定したキーをもう一方でも使用できます。

### Featureスタイリング

```javascript
// _idx プロパティをフィーチャーに付与して識別
const withIdx = Object.assign({}, feat, {
    properties: Object.assign({}, feat.properties, { _idx: i }),
});
dataLayer.addGeoJson(withIdx);
```

```javascript
// アクティブフィーチャーを金色、通常を青色に
fillColor:   isActive ? '#f9a825' : '#29b6f6',
strokeColor: isActive ? '#f9a825' : '#29b6f6',
```

---

## preview-map.html

### 技術スタック

- Vanilla JS（フレームワークなし）
- Google Maps JavaScript API（`roadmap` タイプ、ダークテーマ）
- `google.maps.Marker` + `google.maps.InfoWindow` でピンと詳細表示

### 主要コンポーネント

| 関数 | 役割 |
|---|---|
| `loadMapsApi(key)` | Maps API を動的ロード（`preview-area.html` と同じ方式） |
| `initMap()` | Maps インスタンスと InfoWindow を初期化 |
| `renderMarkers()` | `locations[]` を全件マーカー描画 |
| `openInfoWindow(idx, marker)` | `panoId` / 座標 / 各種フィールドを InfoWindow に表示 |
| `setActive(idx)` | マーカーアイコンをアクティブ（金色）/ 非アクティブ（青色）に切り替え |
| `computeBounds(locs)` | 全ロケーションの BBox を計算して `LatLngBounds` を返す |
| `renderLocList()` | 現在ページのロケーション一覧を左パネルに描画 |
| `parseLocations(data)` | `customCoordinates` ラッパー形式・生配列の両方を正規化 |
| `updateInfoBar(locs)` | ロケーション数・国コード一覧・BBox を情報バーに反映 |

### ページネーション

大量ロケーション（数千件）でも DOM が重くならないよう、一覧パネルは `PAGE_SIZE = 100` 件ずつ表示します。

```javascript
const slice = locations.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
```

### InfoWindow の Street View リンク

```javascript
const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano`
            + `&pano=${encodeURIComponent(loc.panoId)}`
            + `&heading=${loc.heading.toFixed(1)}`
            + `&pitch=${loc.pitch.toFixed(1)}`;
```

### マーカースタイル

```javascript
function makeIcon(active) {
    return {
        path:        google.maps.SymbolPath.CIRCLE,
        scale:       active ? 8 : 5,
        fillColor:   active ? '#f9a825' : '#29b6f6',
        fillOpacity: active ? 1.0 : 0.85,
        strokeColor: '#ffffff',
        strokeWeight: active ? 1.5 : 1,
    };
}
```

### 入力 JSON バリデーション

```javascript
const valid = locs.filter(l =>
    l && typeof l.lat === 'number' && typeof l.lng === 'number'
);
// panoId が無い場合は空文字にフォールバック
valid.forEach(l => { if (!l.panoId) l.panoId = ''; });
```

---

## 依存関係と外部サービス

| ツール | 外部依存 | ネットワークアクセス |
|---|---|---|
| `extract-area.js` | なし（Node.js 標準モジュールのみ） | なし |
| `generate-map.js` | なし（Node.js 標準モジュールのみ） | Street View Metadata API |
| `calc-map-params.js` | なし（Node.js 標準モジュールのみ） | なし |
| `preview-area.html` | Google Maps JavaScript API | Maps タイル |
| `preview-map.html` | Google Maps JavaScript API | Maps タイル |

---

## セキュリティ上の注意

- API キーは HTML ファイル内にハードコードせず、`localStorage` に保存しています（`file://` URL での利用を想定）
- `generate-map.js` は `--api-key` 引数または環境変数 `GMAPS_KEY` からキーを取得します。シェル履歴に残したくない場合は環境変数を推奨します
- `preview-area.html` / `preview-map.html` は `file://` URL での利用を前提としており、Web サーバーで公開することは想定していません

---

## テスト済みの動作例（このセッションで確認済み）

```bash
# 国抽出
node tools/extract-area.js country JP
# → tools/output/areas/jp.geojson (1 Feature)

# 州抽出
node tools/extract-area.js state US.CA
# → tools/output/areas/us-ca.geojson (1 Feature)

# 大陸抽出
node tools/extract-area.js continent "North America"
# → tools/output/areas/north-america.geojson (42 Features)

node tools/extract-area.js continent Asia
# → tools/output/areas/asia.geojson (59 Features)

# 一覧表示
node tools/extract-area.js list continents
# → Europe(51), Asia(59), North America(42) ...

node tools/extract-area.js list states JP
# → 47都道府県一覧

# バリデーションエラー（APIキーなし）
node tools/generate-map.js --area tools/output/areas/jp.geojson --count 10
# → "エラー: --api-key または環境変数 GMAPS_KEY が必要です"
```
