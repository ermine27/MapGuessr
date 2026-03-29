#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_AREAS_DIR = path.join(__dirname, "areas");

function printHelp() {
    console.log(`
使用方法:
  node extract-area.js <mode> <identifier> [options]

モード:
  country <ISO_A2>
      国コード（ISO 3166-1 alpha-2）で国を抽出
      例: node extract-area.js country JP
      例: node extract-area.js country US --output output/areas/usa.geojson

  state <HASC>
      HASC コードで州・都道府県を1件抽出
      例: node extract-area.js state US.CA

  state <ISO_A2> --name <name>
      国コード＋名前で州を抽出
      例: node extract-area.js state US --name "California"

  state <ISO_A2>
      指定国の全州をまとめて抽出
      例: node extract-area.js state JP

  continent <name>
      大陸名で全国家を抽出（複数単語はクォートするか並べて指定可）
      例: node extract-area.js continent Asia
      例: node extract-area.js continent "North America"
      例: node extract-area.js continent North America

  list countries
      全国家の一覧を表示（ファイル出力なし）

  list states <ISO_A2>
      指定国の州・都道府県一覧を表示
      例: node extract-area.js list states JP

  list continents
      大陸の一覧と国数を表示

オプション:
    --output <path>       出力ファイルパス（省略時は output/areas/<識別子>.geojson)
  --areas-dir <path>    GeoJSONファイルの置き場所（省略時: スクリプトと同階層の areas/）
  -h, --help            このヘルプを表示

大陸名の値:
  Africa, Antarctica, Asia, Europe, North America, Oceania, South America
`);
}

// 引数の解析
function parseArgs(argv) {
    const args = {
        mode: null,
        identifier: null,     // 2番目の位置引数
        subIdentifier: null,  // 3番目の位置引数（"list states JP" の JP や "North America" の America）
        name: null,
        output: null,
        areasDir: DEFAULT_AREAS_DIR,
    };

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "-h" || arg === "--help") {
            printHelp();
            process.exit(0);
        } else if (arg === "--output") {
            args.output = path.resolve(argv[++i]);
        } else if (arg === "--areas-dir") {
            args.areasDir = path.resolve(argv[++i]);
        } else if (arg === "--name") {
            args.name = argv[++i];
        } else if (!args.mode) {
            args.mode = arg;
        } else if (!args.identifier) {
            args.identifier = arg;
        } else if (!args.subIdentifier) {
            args.subIdentifier = arg;
        }
        i++;
    }
    return args;
}

// GeoJSONファイルの読み込み
function loadGeoJson(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`エラー: ファイルが見つかりません: ${filePath}`);
        console.error(`  tools/areas/ フォルダに Natural Earth の GeoJSON を配置してください。`);
        process.exit(1);
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
        console.error(`エラー: JSON の解析に失敗しました: ${e.message}`);
        process.exit(1);
    }
}

// GeoJSON を出力ファイルに書き出す
function writeOutput(filePath, geojson) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`ディレクトリを作成しました: ${dir}`);
    }
    fs.writeFileSync(filePath, JSON.stringify(geojson), "utf-8");
    console.log(`出力: ${filePath}`);
    console.log(`  Feature 数: ${geojson.features.length}`);
}

// FeatureCollection を作成
function toFeatureCollection(features) {
    return { type: "FeatureCollection", features };
}

// country プロパティのスリム化（大文字キーを正規化）
function slimCountryProps(p) {
    return {
        name: p.NAME || p.name || "",
        iso_a2: p.ISO_A2 || p.iso_a2 || "",
        continent: p.CONTINENT || p.continent || "",
        subregion: p.SUBREGION || p.subregion || "",
    };
}

// state プロパティのスリム化
function slimStateProps(p) {
    return {
        name: p.name || "",
        iso_a2: p.iso_a2 || "",
        hasc: p.code_hasc || "",
        country: p.admin || "",
        iso_3166_2: p.iso_3166_2 || "",
    };
}

// ------- country モード -------
function runCountry(args) {
    const isoCode = args.identifier.toUpperCase();
    const filePath = path.join(args.areasDir, "ne_10m_admin_0_countries.geojson");
    const data = loadGeoJson(filePath);

    // ISO_A2 で一致検索
    let features = data.features.filter(
        f => (f.properties.ISO_A2 || "").toUpperCase() === isoCode
    );

    // ISO_A2 が "-99" のなどでヒットしない場合、NAME または NAME_EN でフォールバック
    if (features.length === 0) {
        features = data.features.filter(f => {
            const p = f.properties;
            return (
                (p.NAME_EN || p.NAME || "").toUpperCase() === isoCode
            );
        });
    }

    if (features.length === 0) {
        console.error(`エラー: 国コード "${isoCode}" が見つかりませんでした。`);
        console.error(`  使用可能な国コードを確認するには: node extract-area.js list countries`);
        process.exit(1);
    }

    const slim = features.map(f => ({
        type: "Feature",
        properties: slimCountryProps(f.properties),
        geometry: f.geometry,
    }));

    const output = args.output || path.join(args.areasDir, "..", "output", "areas", `${isoCode.toLowerCase()}.geojson`);
    writeOutput(output, toFeatureCollection(slim));

    const p = features[0].properties;
    console.log(`  国名: ${p.NAME || p.name}`);
    console.log(`  大陸: ${p.CONTINENT}`);
}

// ------- state モード -------
function runState(args) {
    const filePath = path.join(args.areasDir, "ne_10m_admin_1_states_provinces.geojson");
    const data = loadGeoJson(filePath);

    let features;
    let defaultName;

    if (!args.name && args.identifier.includes(".")) {
        // "US.CA" 形式 → code_hasc で検索
        const hasc = args.identifier.toUpperCase();
        features = data.features.filter(
            f => (f.properties.code_hasc || "").toUpperCase() === hasc
        );
        if (features.length === 0) {
            console.error(`エラー: HASC コード "${hasc}" が見つかりませんでした。`);
            console.error(`  使用可能なコードを確認するには: node extract-area.js list states ${hasc.split(".")[0]}`);
            process.exit(1);
        }
        defaultName = hasc.toLowerCase().replace(".", "-");

    } else if (args.name) {
        // --name 指定 → iso_a2 + name で検索
        const isoCode = args.identifier.toUpperCase();
        const stateName = args.name;
        features = data.features.filter(f => {
            const p = f.properties;
            return (
                (p.iso_a2 || "").toUpperCase() === isoCode &&
                (p.name === stateName ||
                    (p.name_en || "").toLowerCase() === stateName.toLowerCase())
            );
        });
        if (features.length === 0) {
            console.error(`エラー: "${args.identifier.toUpperCase()}" の州 "${stateName}" が見つかりませんでした。`);
            console.error(`  使用可能な州を確認するには: node extract-area.js list states ${args.identifier.toUpperCase()}`);
            process.exit(1);
        }
        defaultName = `${args.identifier.toLowerCase()}-${stateName.toLowerCase().replace(/\s+/g, "-")}`;

    } else {
        // 国コードのみ → その国の全州を抽出
        const isoCode = args.identifier.toUpperCase();
        features = data.features.filter(
            f => (f.properties.iso_a2 || "").toUpperCase() === isoCode
        );
        if (features.length === 0) {
            console.error(`エラー: 国コード "${isoCode}" の州データが見つかりませんでした。`);
            process.exit(1);
        }
        console.log(`注: "${isoCode}" の全州 (${features.length} 件) を抽出します。`);
        defaultName = `${args.identifier.toLowerCase()}-all-states`;
    }

    const slim = features.map(f => ({
        type: "Feature",
        properties: slimStateProps(f.properties),
        geometry: f.geometry,
    }));

    const output = args.output || path.join(args.areasDir, "..", "output", "areas", `${defaultName}.geojson`);
    writeOutput(output, toFeatureCollection(slim));

    if (features.length === 1) {
        const p = features[0].properties;
        console.log(`  州名: ${p.name}`);
        console.log(`  国:   ${p.admin}`);
    }
}

// ------- continent モード -------
function runContinent(args) {
    const continentNames = [
        "Africa", "Antarctica", "Asia", "Europe",
        "North America", "Oceania", "South America",
    ];

    // "North America" は2単語になるので subIdentifier もつなぐ
    let inputName = args.identifier;
    if (args.subIdentifier) {
        inputName += " " + args.subIdentifier;
    }

    // 各単語の先頭を大文字に正規化して比較
    const normalizedInput = inputName
        .trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

    if (!continentNames.includes(normalizedInput)) {
        console.error(`エラー: 大陸名 "${normalizedInput}" は無効です。`);
        console.error(`  有効な大陸名: ${continentNames.join(", ")}`);
        process.exit(1);
    }

    const filePath = path.join(args.areasDir, "ne_10m_admin_0_countries.geojson");
    const data = loadGeoJson(filePath);

    const features = data.features.filter(
        f => f.properties.CONTINENT === normalizedInput
    );

    if (features.length === 0) {
        console.error(`エラー: 大陸 "${normalizedInput}" のデータが見つかりませんでした。`);
        process.exit(1);
    }

    const slim = features.map(f => ({
        type: "Feature",
        properties: slimCountryProps(f.properties),
        geometry: f.geometry,
    }));

    const safeName = normalizedInput.toLowerCase().replace(/\s+/g, "-");
    const output = args.output || path.join(args.areasDir, "..", "output", "areas", `${safeName}.geojson`);
    writeOutput(output, toFeatureCollection(slim));

    console.log(`  大陸: ${normalizedInput}`);
    console.log(`  国数: ${features.length}`);
}

// ------- list モード -------
function runList(args) {
    const subMode = args.identifier;

    if (subMode === "countries") {
        const filePath = path.join(args.areasDir, "ne_10m_admin_0_countries.geojson");
        const data = loadGeoJson(filePath);
        console.log("国一覧 (ISO_A2 | NAME | CONTINENT):");
        data.features
            .map(f => f.properties)
            .sort((a, b) => (a.ISO_A2 || "").localeCompare(b.ISO_A2 || ""))
            .forEach(p => {
                console.log(
                    `  ${String(p.ISO_A2 || "(none)").padEnd(5)} | ` +
                    `${String(p.NAME || "").padEnd(36)} | ` +
                    `${p.CONTINENT || ""}`
                );
            });
        console.log(`\n合計: ${data.features.length} 件`);

    } else if (subMode === "states") {
        // "list states JP" → subIdentifier に JP が入る
        const isoCode = (args.subIdentifier || "").toUpperCase();
        if (!isoCode) {
            console.error("エラー: 国コードを指定してください。例: node extract-area.js list states JP");
            process.exit(1);
        }
        const filePath = path.join(args.areasDir, "ne_10m_admin_1_states_provinces.geojson");
        const data = loadGeoJson(filePath);
        const states = data.features
            .filter(f => (f.properties.iso_a2 || "").toUpperCase() === isoCode)
            .map(f => f.properties)
            .sort((a, b) => (a.code_hasc || "").localeCompare(b.code_hasc || ""));

        if (states.length === 0) {
            console.error(`エラー: "${isoCode}" の州データが見つかりませんでした。`);
            process.exit(1);
        }
        console.log(`${isoCode} の州・都道府県一覧 (HASC | NAME):`);
        states.forEach(p => {
            console.log(`  ${String(p.code_hasc || "").padEnd(10)} | ${p.name || ""}`);
        });
        console.log(`\n合計: ${states.length} 件`);

    } else if (subMode === "continents") {
        const filePath = path.join(args.areasDir, "ne_10m_admin_0_countries.geojson");
        const data = loadGeoJson(filePath);
        const counts = {};
        data.features.forEach(f => {
            const c = f.properties.CONTINENT || "(不明)";
            counts[c] = (counts[c] || 0) + 1;
        });
        console.log("大陸一覧 (CONTINENT | 国数):");
        Object.entries(counts)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([name, count]) => {
                console.log(`  ${String(name).padEnd(20)} | ${count} 国`);
            });

    } else {
        console.error(`エラー: list のサブコマンドが無効です: "${subMode}"`);
        console.error(`  有効なもの: countries, states <ISO_A2>, continents`);
        process.exit(1);
    }
}

// ------- メイン -------
const args = parseArgs(process.argv.slice(2));

if (!args.mode) {
    printHelp();
    process.exit(1);
}

switch (args.mode) {
    case "country":
        if (!args.identifier) {
            console.error("エラー: 国コードを指定してください。");
            process.exit(1);
        }
        runCountry(args);
        break;

    case "state":
        if (!args.identifier) {
            console.error("エラー: HASC コードまたは国コードを指定してください。");
            process.exit(1);
        }
        runState(args);
        break;

    case "continent":
        if (!args.identifier) {
            console.error("エラー: 大陸名を指定してください。");
            process.exit(1);
        }
        runContinent(args);
        break;

    case "list":
        if (!args.identifier) {
            console.error("エラー: サブコマンドを指定してください（countries, states, continents）。");
            process.exit(1);
        }
        runList(args);
        break;

    default:
        console.error(`エラー: 不明なモード "${args.mode}"`);
        printHelp();
        process.exit(1);
}
