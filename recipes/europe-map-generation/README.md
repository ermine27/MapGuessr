# europe-map-generation

ヨーロッパ地図マップ（`europa-50k.json`）を生成するレシピです。

Natural Earth の国境 GeoJSON からヨーロッパ対象国を抽出し、各国のエリア GeoJSON を生成したうえで、Street View Metadata API を使ってロケーションを収集します。最後に各国分を 1 つのファイルへマージします。

このレシピでは **ロシアおよび中東地域は対象外** とし、`config/NaturalEarth.csv` の配分に基づいて **合計 50,000 件** のロケーションを生成します。

---

## 処理の流れ

```text
[tools/areas/ne_10m_admin_0_countries.geojson]  Natural Earth（外部データ）
        |
        | (1) build-europa-area.js
        ↓
[output/areas/europa.geojson]                    ヨーロッパ対象国のみを抽出した GeoJSON
        |
        | (2) generate-country-areas.bat         → tools/extract-area.js
        ↓
[tools/output/areas/countries/*.geojson]         国ごとの個別エリア GeoJSON
        |
        | (3) generate-europa-map.js             → tools/generate-map.js
        ↓
[output/maps/countries/*.json]                   国ごとのロケーションファイル
        |
        | (3) generate-europa-map.js (merge phase)
        ↓
[output/maps/europa-50k.json]                    最終成果物
```

---

## ファイル構成

```text
europe-map-generation/
├ README.md                    このファイル
├ build-europa-area.js         ステップ1: europa.geojson の生成
├ generate-country-areas.bat   ステップ2: 国別エリア GeoJSON の生成
├ generate-europa-map.js       ステップ3: ロケーション生成 & マージ
├ config/
│ ├ countries-list-coverage.csv  ステップ1, 2 の入力: 対象国の ISO コード一覧
│ └ NaturalEarth.csv             ステップ3 の入力: 国ごとの生成件数・最小距離設定
└ output/                     生成ファイル（.gitignore で除外）
  ├ areas/
  │ └ europa.geojson          ステップ1 の出力
  └ maps/
    ├ countries/              ステップ3 の中間出力（国別）
    │ └ <Country>.json
    └ europa-50k.json         ステップ3 の最終出力
```

---

## 事前準備

- `tools/areas/ne_10m_admin_0_countries.geojson` が必要です（Natural Earth 10m Cultural Vectors）
  - ダウンロード: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
- Google Maps Street View Metadata API キーが必要です
- `tools/generate-map.js` は `countryCode` / `stateCode` を出力する最新版を使用してください

---

## 実行手順

### ステップ 1: ヨーロッパ統合エリア GeoJSON を生成

```bash
node recipes/europe-map-generation/build-europa-area.js
```

`config/countries-list-coverage.csv` に記載された ISO コードをもとに、Natural Earth から該当国のジオメトリを抽出して `output/areas/europa.geojson` を生成します。

---

### ステップ 2: 国別エリア GeoJSON を生成

```bat
recipes\europe-map-generation\generate-country-areas.bat
```

`config/countries-list-coverage.csv` の各国に対して `tools/extract-area.js` を呼び出し、`tools/output/areas/countries/<Country>.geojson` を生成します。

---

### ステップ 3: ロケーション生成 & マージ

```bash
node recipes/europe-map-generation/generate-europa-map.js --api-key <YOUR_API_KEY>
```

`config/NaturalEarth.csv` の各エントリに対して `tools/generate-map.js` を呼び出し、Street View ロケーションを収集します。全エリアの生成が完了すると自動的に `output/maps/europa-50k.json` にマージされます。

#### オプション

| オプション | 説明 |
|---|---|
| `--api-key <key>` | Google Maps API キー（環境変数 `GMAPS_KEY` でも可） |
| `--merge-only` | ロケーション生成をスキップしてマージのみ実行 |
| `--force` | 既存の出力ファイルを無視して全エリアを再生成 |

#### 中断・再開

生成中に `Ctrl+C` で中断したり API エラーが発生した場合、チェックポイントファイル（`<Country>.json.tmp.json`）が自動保存されます。次回実行時に自動的に再開します。

`min-distance` による連続失敗が一定回数に達した場合は、`generate-europa-map.js` が `min-distance` を段階的に引き下げて再試行します。小国や都市国家（例: `Liechtenstein`, `Gibraltar`, `Monaco`, `San Marino`）ではこの挙動が発生しやすいです。

---

## config ファイル仕様

### `NaturalEarth.csv`（タブ区切り）

| 列 | 内容 |
|---|---|
| `NAME` | Natural Earth の国名（`generate-europa-map.js` の `NAME_TO_FILE` キーと一致） |
| `NAME_JP` | 日本語名 |
| `CONTINENT` | 大陸名（このレシピでは基本的に `Europe`） |
| `count` | 生成するロケーション数 |
| `percent` | 全体 50,000 件に占める割合 |
| `min_distance_km` | ロケーション間の最小距離（km） |

この `count` は `world-map-generation/config/NaturalEarth.csv` のヨーロッパ各国の件数をもとに、**合計 50,000 件になるよう比例配分**した値です。

### `countries-list-coverage.csv`（カンマ区切り）

- 1列目: ISO A2 コード
- 2列目: 出力ファイル名（拡張子なし）

---

## 補足

- このレシピの対象はヨーロッパ地域のみです
- **ロシア・中東は含めていません**
- `countryCode` は国エリア GeoJSON から設定されます
- `stateCode` は州境 GeoJSON による PIP 判定で設定されます（対応データがある国のみ）