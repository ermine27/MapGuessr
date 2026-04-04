/**
 * build-europa-area.js
 *
 * countries-list-coverage.csv に記載された国コードを使い、
 * Natural Earth GeoJSON から該当国を抽出して europa.geojson を生成する。
 *
 * 使い方:
 *   node recipes/europa-map-generation/build-europa-area.js
 */

const fs = require("fs");
const path = require("path");

// ── パス定義 ──
const ROOT = path.resolve(__dirname, "../..");
const csvPath = path.join(__dirname, "config", "countries-list-coverage.csv");
const nePath = path.join(ROOT, "tools", "areas", "ne_10m_admin_0_countries.geojson");
const outputPath = path.join(__dirname, "output", "areas", "europa.geojson");

// ── CSV を読み込んで ISO コード一覧を取得 ──
const csvText = fs.readFileSync(csvPath, "utf-8");
const isoCodes = csvText
    .split(/\r?\n/)
    .map(line => line.split(",")[0].trim().toUpperCase())
    .filter(code => code.length > 0);

console.log(`CSV 読み込み: ${isoCodes.length} 件`);

// ── Natural Earth GeoJSON を読み込み ──
const ne = JSON.parse(fs.readFileSync(nePath, "utf-8"));
console.log(`Natural Earth features: ${ne.features.length} 件`);

// ── プロパティのスリム化 ──
function slimProps(p) {
    return {
        name: p.NAME || p.name || "",
        iso_a2: p.ISO_A2 || p.iso_a2 || "",
        continent: p.CONTINENT || p.continent || "",
        subregion: p.SUBREGION || p.subregion || "",
    };
}

// ── CSV コードでフィルタ ──
const matched = [];
const remaining = new Set(isoCodes);

for (const feature of ne.features) {
    const iso = (feature.properties.ISO_A2 || "").toUpperCase();
    if (remaining.has(iso)) {
        matched.push({
            type: "Feature",
            properties: slimProps(feature.properties),
            geometry: feature.geometry,
        });
        remaining.delete(iso);
    }
}

// ISO_A2 が -99 の国の NAME ベースフォールバック
const nameFallbacks = new Map([
    ["FR", "France"],
    ["NO", "Norway"],
]);

for (const [code, name] of nameFallbacks) {
    if (!remaining.has(code)) continue;
    const feature = ne.features.find(f =>
        f.properties.NAME === name || f.properties.NAME_EN === name
    );
    if (feature) {
        const props = slimProps(feature.properties);
        props.iso_a2 = code;
        matched.push({ type: "Feature", properties: props, geometry: feature.geometry });
        remaining.delete(code);
    } else {
        console.warn(`⚠ NAME="${name}" が見つかりません (${code})`);
    }
}

if (remaining.size > 0) {
    console.warn(`⚠ 未マッチのコード: ${[...remaining].join(", ")}`);
}

console.log(`マッチ: ${matched.length} 件`);

// ── 出力 ──
const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const geojson = { type: "FeatureCollection", features: matched };
fs.writeFileSync(outputPath, JSON.stringify(geojson), "utf-8");
console.log(`出力: ${outputPath}`);
