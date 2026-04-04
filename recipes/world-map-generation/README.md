# world-map-generation

世界地図マップ（`world-maps.geojson`）を生成するレシピです。

各国のエリア GeoJSON を Street View Metadata API で探索し、国ごとのロケーションファイルを作成したあと、1 つのファイルにマージします。

---

## 処理の流れ

```
[tools/areas/ne_10m_admin_0_countries.geojson]  Natural Earth（外部データ）
        |
        | (1) build-world-area.js
        ↓
[output/areas/world.geojson]                     対象国のみを抽出した GeoJSON
        |
        | (2) generate-country-areas-from-coverage.bat  → tools/extract-area.js
        ↓
[tools/output/areas/countries/*.geojson]         国ごとの個別エリア GeoJSON
        |
        | (3) generate-world-map.js              → tools/generate-map.js
        ↓
[output/maps/countries/*.json]                   国ごとのロケーションファイル
        |
        | (3) generate-world-map.js (merge phase)
        ↓
[output/maps/world-maps.geojson]                 最終成果物
```

---

## ファイル構成

```
world-map-generation/
├ README.md                              このファイル
├ build-world-area.js                    ステップ1: world.geojson の生成
├ generate-country-areas-from-coverage.bat  ステップ2: 国別エリア GeoJSON の生成
├ generate-world-map.js                  ステップ3: ロケーション生成 & マージ
├ config/
│ ├ countries-list-coverage.csv         ステップ1, 2 の入力: 対象国の ISO コード一覧
│ └ NaturalEarth.csv                    ステップ3 の入力: 国ごとの生成件数・最小距離設定
└ output/                               生成ファイル（.gitignore で除外）
  ├ areas/
  │ └ world.geojson                     ステップ1 の出力
  └ maps/
    ├ countries/                        ステップ3 の中間出力（国別）
    │ └ <Country>.json
    └ world-maps.geojson                ステップ3 の最終出力
```

---

## 事前準備

- `tools/areas/ne_10m_admin_0_countries.geojson` が必要です（Natural Earth 10m Cultural Vectors）
  - ダウンロード: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
- Google Maps Street View Metadata API キーが必要です

---

## 実行手順

### ステップ 1: 対象国エリアのマージ GeoJSON を生成

```bash
node recipes/world-map-generation/build-world-area.js
```

`config/countries-list-coverage.csv` に記載された ISO コードをもとに、Natural Earth から該当国のジオメトリを抽出して `output/areas/world.geojson` を生成します。

---

### ステップ 2: 国別エリア GeoJSON を生成

```bat
recipes\world-map-generation\generate-country-areas-from-coverage.bat
```

`config/countries-list-coverage.csv` の各国に対して `tools/extract-area.js` を呼び出し、`tools/output/areas/countries/<Country>.geojson` を生成します。

---

### ステップ 3: ロケーション生成 & マージ

```bash
node recipes/world-map-generation/generate-world-map.js --api-key <YOUR_API_KEY>
```

`config/NaturalEarth.csv` の各エントリに対して `tools/generate-map.js` を呼び出し、Street View ロケーションを収集します。全国の生成が完了すると自動的に `output/maps/world-maps.geojson` にマージされます。

#### オプション

| オプション | 説明 |
|---|---|
| `--api-key <key>` | Google Maps API キー（環境変数 `GMAPS_KEY` でも可） |
| `--merge-only` | ロケーション生成をスキップしてマージのみ実行 |
| `--force` | 既存の出力ファイルを無視して全エリアを再生成 |

#### 中断・再開

生成中に Ctrl+C で中断したり API エラーが発生した場合、チェックポイントファイル（`<Country>.json.tmp.json`）が自動保存されます。次回実行時に自動的に再開します。

min-distance による連続失敗が一定回数に達した場合は min-distance を自動的に引き下げて再試行します（詳細は `generate-world-map.js` を参照）。

---

## config ファイル仕様

### `NaturalEarth.csv`（タブ区切り）

| 列 | 内容 |
|---|---|
| `NAME` | Natural Earth の国名（`NAME_TO_FILE` マップのキーと一致） |
| `NAME_JP` | 日本語名 |
| `CONTINENT` | 大陸名 |
| `count` | 生成するロケーション数 |
| `percent` | 全体に占める割合（参考値） |
| `min_distance_km` | ロケーション間の最小距離（km） |

### `countries-list-coverage.csv`（カンマ区切り）

1列目: ISO A2 コード、2列目: ファイル名（拡張子なし）
