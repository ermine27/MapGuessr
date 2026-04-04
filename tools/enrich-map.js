#!/usr/bin/env node
"use strict";

// 既存マップJSONの countryCode / stateCode を補完するCLI。

const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────
// CLI 引数解析
// ──────────────────────────────────────────

function parseArgs(argv) {
    const args = {
        input: null,
        output: null,
        countries: null,
        states: null,
        force: false,
        noCountry: false,
        noState: false,
    };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case "--countries": args.countries = argv[++i]; break;
            case "--states": args.states = argv[++i]; break;
            case "--output": args.output = argv[++i]; break;
            case "--force": args.force = true; break;
            case "--no-country": args.noCountry = true; break;
            case "--no-state": args.noState = true; break;
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
                break;
            default:
                if (!argv[i].startsWith("--") && !args.input) {
                    args.input = argv[i];
                }
        }
    }

    return args;
}

function printUsage() {
    console.log(`
使用方法:
  node enrich-map.js <map-file> [options]

オプション:
  --countries <path>  国境GeoJSONパス（デフォルト: tools/areas/ne_10m_admin_0_countries.geojson）
  --states <path>     州境GeoJSONパス（デフォルト: tools/areas/ne_10m_admin_1_states_provinces.geojson）
  --output <path>     出力ファイルパス（省略時: 入力ファイルを上書き）
  --force             null でない値も上書きする
  --no-country        countryCode を処理しない
  --no-state          stateCode を処理しない

例:
  node tools/enrich-map.js docs/maps/usa-5k.json
  node tools/enrich-map.js docs/maps/world-40k.json --force
  node tools/enrich-map.js docs/maps/japan-50k.json --output docs/maps/japan-50k-new.json
`);
}

// ──────────────────────────────────────────
// GeoJSON PIP ユーティリティ
// ──────────────────────────────────────────

function computeBbox(geometry) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    function scan(coords) {
        if (!Array.isArray(coords[0])) {
            if (coords[1] < minLat) minLat = coords[1];
            if (coords[1] > maxLat) maxLat = coords[1];
            if (coords[0] < minLng) minLng = coords[0];
            if (coords[0] > maxLng) maxLng = coords[0];
        } else {
            for (const c of coords) scan(c);
        }
    }

    if (geometry.type === "Polygon") {
        scan(geometry.coordinates);
    } else if (geometry.type === "MultiPolygon") {
        for (const poly of geometry.coordinates) scan(poly);
    }

    return { minLat, maxLat, minLng, maxLng };
}

function pointInRing(lat, lng, ring) {
    let inside = false;
    const n = ring.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if ((yi > lat) !== (yj > lat) &&
            lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

function pointInGeometry(lat, lng, geometry) {
    if (geometry.type === "Polygon") {
        const [outer, ...holes] = geometry.coordinates;
        if (!pointInRing(lat, lng, outer)) return false;
        return !holes.some(h => pointInRing(lat, lng, h));
    }
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.some(poly => {
            const [outer, ...holes] = poly;
            return pointInRing(lat, lng, outer) &&
                !holes.some(h => pointInRing(lat, lng, h));
        });
    }
    return false;
}

// ──────────────────────────────────────────
// 検索テーブル構築（bbox による事前フィルタ付き）
// ──────────────────────────────────────────

function buildLookupTable(features) {
    return features
        .filter(f => f.geometry &&
            (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
        .map(f => ({
            feature: f,
            bbox: computeBbox(f.geometry),
        }));
}

function findCode(lat, lng, table, propFn) {
    for (const entry of table) {
        const { minLat, maxLat, minLng, maxLng } = entry.bbox;
        if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) continue;
        if (pointInGeometry(lat, lng, entry.feature.geometry)) {
            return propFn(entry.feature.properties) || null;
        }
    }
    return null;
}

// ──────────────────────────────────────────
// 出力ファイル書き込み（1ロケーション1行）
// ──────────────────────────────────────────

function writeOutput(outputPath, mapData) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const inner = mapData.customCoordinates
        .map(loc => JSON.stringify(loc))
        .join(",\n");

    let content;
    if (mapData.name) {
        content = `{"name":${JSON.stringify(mapData.name)},"customCoordinates":[\n${inner}\n]}`;
    } else {
        content = `{"customCoordinates":[\n${inner}\n]}`;
    }

    fs.writeFileSync(outputPath, content, "utf8");
}

// ──────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.input) {
        console.error("エラー: 入力ファイルを指定してください。");
        printUsage();
        process.exit(1);
    }

    const inputPath = path.resolve(args.input);
    if (!fs.existsSync(inputPath)) {
        console.error(`エラー: ファイルが見つかりません: ${inputPath}`);
        process.exit(1);
    }

    const outputPath = args.output ? path.resolve(args.output) : inputPath;

    // デフォルトのGeoJSONパス（このスクリプトの場所から相対解決）
    const scriptDir = path.dirname(path.resolve(process.argv[1]));
    const defaultCountriesPath = path.join(scriptDir, "areas", "ne_10m_admin_0_countries.geojson");
    const defaultStatesPath = path.join(scriptDir, "areas", "ne_10m_admin_1_states_provinces.geojson");

    const countriesPath = args.countries ? path.resolve(args.countries) : defaultCountriesPath;
    const statesPath = args.states ? path.resolve(args.states) : defaultStatesPath;

    // マップデータ読み込み
    console.log(`入力: ${inputPath}`);
    let mapData;
    try {
        mapData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    } catch (e) {
        console.error("エラー: マップファイルのパースに失敗:", e.message);
        process.exit(1);
    }

    const locations = mapData.customCoordinates;
    if (!Array.isArray(locations)) {
        console.error("エラー: customCoordinates が配列ではありません。");
        process.exit(1);
    }

    // countryCode の処理対象を判定
    const needCountry = !args.noCountry &&
        locations.some(loc => args.force || loc.countryCode === null || loc.countryCode === undefined);
    const needState = !args.noState &&
        locations.some(loc => args.force || loc.stateCode === null || loc.stateCode === undefined);

    if (!needCountry && !needState) {
        console.log("countryCode / stateCode が全件設定済みです。--force を使うと強制上書きできます。");
        process.exit(0);
    }

    // GeoJSON 読み込み
    let countriesTable = [];
    let statesTable = [];

    if (needCountry) {
        if (!fs.existsSync(countriesPath)) {
            console.error(`エラー: 国境GeoJSONが見つかりません: ${countriesPath}`);
            process.exit(1);
        }
        console.log(`国境GeoJSON読み込み中: ${countriesPath}`);
        const geo = JSON.parse(fs.readFileSync(countriesPath, "utf8"));
        countriesTable = buildLookupTable(geo.features);
        console.log(`  ${countriesTable.length} フィーチャー`);
    }

    if (needState) {
        if (!fs.existsSync(statesPath)) {
            console.error(`エラー: 州境GeoJSONが見つかりません: ${statesPath}`);
            process.exit(1);
        }
        console.log(`州境GeoJSON読み込み中: ${statesPath}`);
        const geo = JSON.parse(fs.readFileSync(statesPath, "utf8"));
        statesTable = buildLookupTable(geo.features);
        console.log(`  ${statesTable.length} フィーチャー`);
    }

    console.log(`\n処理開始: ${locations.length.toLocaleString("en-US")} ロケーション`);
    console.log(`  countryCode: ${needCountry ? "処理する" : "スキップ"}  stateCode: ${needState ? "処理する" : "スキップ"}  force: ${args.force}`);
    console.log("");

    const startTime = Date.now();
    let updated = 0;

    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        let changed = false;

        if (needCountry && (args.force || loc.countryCode === null || loc.countryCode === undefined)) {
            const code = findCode(loc.lat, loc.lng, countriesTable,
                p => {
                    const v = p.ISO_A2 || p.iso_a2 || null;
                    return (v && v !== "-99" && v !== "-1") ? v : null;
                });
            if (loc.countryCode !== code) {
                loc.countryCode = code;
                changed = true;
            }
        }

        if (needState && (args.force || loc.stateCode === null || loc.stateCode === undefined)) {
            const code = findCode(loc.lat, loc.lng, statesTable,
                p => p.code_hasc || null);
            if (loc.stateCode !== code) {
                loc.stateCode = code;
                changed = true;
            }
        }

        if (changed) updated++;

        // プログレス表示（100件ごと）
        if ((i + 1) % 100 === 0 || i === locations.length - 1) {
            const pct = ((i + 1) / locations.length * 100).toFixed(1);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            let eta = "--";
            if (i > 0) {
                const remaining = (Date.now() - startTime) / (i + 1) * (locations.length - i - 1) / 1000;
                eta = remaining.toFixed(0) + "s";
            }
            process.stdout.write(
                `\r\x1b[K  (${String(i + 1).padStart(String(locations.length).length)} / ${locations.length}) ${pct}%` +
                `  更新: ${updated.toLocaleString("en-US")}  経過: ${elapsed}s  残り: ${eta}`
            );
        }
    }

    process.stdout.write("\n\n");

    // 出力
    writeOutput(outputPath, mapData);

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`完了: ${updated.toLocaleString("en-US")} 件を更新 / ${locations.length.toLocaleString("en-US")} 件（${totalSec}秒）`);
    console.log(`出力: ${outputPath}`);
}

main();
