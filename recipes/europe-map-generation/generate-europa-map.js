/**
 * generate-europa-map.js
 *
 * config/NaturalEarth.csv の各国に対して generate-map.js を実行し、
 * 生成した全ロケーションを 1 つの europa-50k.json にまとめる。
 *
 * 使い方:
 *   node recipes/europa-map-generation/generate-europa-map.js --api-key <key>
 *   node recipes/europa-map-generation/generate-europa-map.js --api-key <key> --merge-only
 *   node recipes/europa-map-generation/generate-europa-map.js --api-key <key> --force
 *
 * オプション:
 *   --api-key <key>   Google Maps API キー（環境変数 GMAPS_KEY でも可）
 *   --merge-only      マップ生成をスキップしてマージのみ実行
 *   --force           既存の出力ファイルを無視して全エリアを再生成
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ── パス定義 ──
const ROOT = path.resolve(__dirname, "../..");
const CSV_PATH = path.join(__dirname, "config", "NaturalEarth.csv");
const AREA_DIR = path.join(ROOT, "tools", "output", "areas", "countries");
const OUT_DIR = path.join(__dirname, "output", "maps", "countries");
const FINAL_OUT = path.join(__dirname, "output", "maps", "europa-50k.json");
const GENERATE_JS = path.join(ROOT, "tools", "generate-map.js");

// ── NaturalEarth NAME → エリアファイル名（.geojson 除く）マップ ──
const NAME_TO_FILE = {
    "Albania": "Albania",
    "Andorra": "Andorra",
    "Austria": "Austria",
    "Åland": "Åland",
    "Bosnia and Herz.": "Bosnia-and-Herzegovina",
    "Belgium": "Belgium",
    "Bulgaria": "Bulgaria",
    "Switzerland": "Switzerland",
    "Czechia": "Czechia",
    "Germany": "Germany",
    "Denmark": "Denmark",
    "Estonia": "Estonia",
    "Spain": "Spain",
    "Finland": "Finland",
    "Faeroe Is.": "Faeroe-Island",
    "France": "France",
    "United Kingdom": "United-Kingdom",
    "Gibraltar": "Gibraltar",
    "Greece": "Greece",
    "Croatia": "Croatia",
    "Hungary": "Hungary",
    "Ireland": "Ireland",
    "Isle of Man": "Isle-of-Man",
    "Iceland": "Iceland",
    "Italy": "Italy",
    "Jersey": "Jersey",
    "Liechtenstein": "Liechtenstein",
    "Lithuania": "Lithuania",
    "Luxembourg": "Luxembourg",
    "Latvia": "Latvia",
    "Monaco": "Monaco",
    "Montenegro": "Montenegro",
    "North Macedonia": "North-Macedonia",
    "Malta": "Malta",
    "Netherlands": "Netherlands",
    "Norway": "Norway",
    "Poland": "Poland",
    "Portugal": "Portugal",
    "Romania": "Romania",
    "Serbia": "Serbia",
    "Sweden": "Sweden",
    "Slovenia": "Slovenia",
    "Slovakia": "Slovakia",
    "San Marino": "San-Marino",
    "Ukraine": "Ukraine",
};

// ── 引数解析 ──
let apiKey = process.env.GMAPS_KEY || "";
let mergeOnly = false;
let force = false;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
        case "--api-key": apiKey = argv[++i]; break;
        case "--merge-only": mergeOnly = true; break;
        case "--force": force = true; break;
        default:
            console.error(`不明なオプション: ${argv[i]}`);
            process.exit(1);
    }
}

if (!mergeOnly && !apiKey) {
    console.error("エラー: --api-key または環境変数 GMAPS_KEY が必要です");
    process.exit(1);
}

// ── CSV 読み込み（タブ区切り）──
const csvLines = fs.readFileSync(CSV_PATH, "utf-8")
    .split(/\r?\n/)
    .filter(l => l.trim());

const entries = csvLines.slice(1).map(line => {
    const cols = line.split("\t");
    return {
        name: (cols[0] || "").trim(),
        name_jp: (cols[1] || "").trim(),
        count: parseInt(cols[3] || "0", 10),
        min_dist: parseFloat(cols[5] || "0"),
    };
}).filter(e => e.name && e.count > 0);

const total = entries.length;
console.log("============================================================");
console.log(" generate-europa-map.js");
console.log("============================================================");
console.log(`CSV エントリ（count > 0）: ${total} 件`);
console.log(`エリアディレクトリ: ${AREA_DIR}`);
console.log(`個別マップ出力先:   ${OUT_DIR}`);
console.log(`最終出力:           ${FINAL_OUT}`);
if (mergeOnly) console.log("モード: マージのみ（生成スキップ）");
if (force) console.log("モード: 強制再生成（--force）");
console.log("============================================================\n");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const abortedAreas = [];
const errorAreas = [];

if (!mergeOnly) {
    let doneCount = 0;

    for (const entry of entries) {
        doneCount++;
        const prefix = `(${String(doneCount).padStart(2)}/${total})`;

        const fileName = NAME_TO_FILE[entry.name];
        if (!fileName) {
            console.warn(`${prefix} ⚠ マッピング未定義: "${entry.name}" → スキップ`);
            continue;
        }

        const areaFile = path.join(AREA_DIR, `${fileName}.geojson`);
        if (!fs.existsSync(areaFile)) {
            console.warn(`${prefix} ⚠ エリアファイルなし: ${fileName}.geojson → スキップ`);
            continue;
        }

        const outFile = path.join(OUT_DIR, `${fileName}.json`);
        const tmpFile = outFile + ".tmp.json";

        if (!force && fs.existsSync(outFile)) {
            try {
                const existing = JSON.parse(fs.readFileSync(outFile, "utf-8"));
                const existCount = (existing.customCoordinates || []).length;
                if (existCount >= entry.count) {
                    console.log(`${prefix} ✓ スキップ（既存 ${existCount} 件）: ${entry.name}`);
                    continue;
                }
                console.log(`${prefix} ↻ 不足（${existCount}/${entry.count} 件）: ${entry.name} → 再生成`);
            } catch {
                console.log(`${prefix} ↻ 読み込みエラー: ${entry.name} → 再生成`);
            }
        }

        const MAX_CONSECUTIVE_FAIL = 500;
        const MIN_SUB_KM_FLOOR = 0.15;
        const KM_ABORT_THRESHOLD = Math.max(1.0, entry.min_dist - 10);
        let currentMinDist = entry.min_dist;
        let areaAborted = false;

        while (true) {
            const suggestFile = outFile + ".suggest.json";
            const genArgs = [
                GENERATE_JS,
                "--area", areaFile,
                "--count", String(entry.count),
                "--output", outFile,
                "--api-key", apiKey,
                "--min-distance", String(currentMinDist),
                "--radius", "2000",
                "--concurrency", "15",
                "--max-consecutive-fail", String(MAX_CONSECUTIVE_FAIL),
            ];

            if (!force && fs.existsSync(tmpFile)) {
                genArgs.push("--resume", tmpFile);
                console.log(`${prefix} ↻ 再開: ${entry.name} (${entry.count} 件, min=${currentMinDist}km)`);
            } else {
                console.log(`${prefix} ▶ 生成開始: ${entry.name} (${entry.count} 件, min=${currentMinDist}km)`);
            }

            const result = spawnSync("node", genArgs, { stdio: "inherit", cwd: ROOT });

            let suggestedMinDist = null;
            if (fs.existsSync(suggestFile)) {
                try { suggestedMinDist = JSON.parse(fs.readFileSync(suggestFile, "utf-8")).suggestedMinDist; } catch { }
                try { fs.unlinkSync(suggestFile); } catch { }
            }

            if (result.status === 0) {
                break;
            } else if (result.status === 2) {
                if (suggestedMinDist === null) {
                    console.error(`${prefix} ✗ Street View カバレッジなし: ${entry.name} → 中断`);
                    areaAborted = true;
                    break;
                }

                const prevDist = currentMinDist;
                const inSubKm = currentMinDist < 1.0 - 0.001;

                if (inSubKm) {
                    if (currentMinDist <= MIN_SUB_KM_FLOOR + 0.001) {
                        console.error(`${prefix} ✗ min-distance=${currentMinDist}km でも失敗: ${entry.name} → 中断`);
                        areaAborted = true;
                        break;
                    }
                    currentMinDist = Math.max(MIN_SUB_KM_FLOOR, Math.round((currentMinDist - 0.1) * 10) / 10);
                } else {
                    if (currentMinDist <= KM_ABORT_THRESHOLD + 0.001) {
                        currentMinDist = 0.9;
                    } else {
                        let nextDist;
                        if (suggestedMinDist !== null && suggestedMinDist < currentMinDist - 0.5) {
                            nextDist = Math.max(KM_ABORT_THRESHOLD, Math.floor(suggestedMinDist));
                            if (nextDist >= currentMinDist) nextDist = currentMinDist - 1;
                        } else {
                            nextDist = Math.max(KM_ABORT_THRESHOLD, currentMinDist - 1);
                        }
                        currentMinDist = nextDist;
                    }
                }
                console.log(`${prefix} ▼ min-distance を ${prevDist}km → ${currentMinDist}km に引き下げて再試行: ${entry.name}`);
            } else {
                console.error(`${prefix} ✗ エラー終了 (exit: ${result.status}): ${entry.name} → 次へ`);
                errorAreas.push(entry.name);
                break;
            }
        }

        if (areaAborted) abortedAreas.push(entry.name);
    }

    console.log("\n生成フェーズ完了\n");
}

// ── マージフェーズ ──
console.log("============================================================");
console.log("マージ開始...");
console.log("============================================================");

if (abortedAreas.length > 0) {
    console.error("\n以下のエリアが中断されたため、マージをスキップします:");
    for (const name of abortedAreas) console.error(`  - ${name}`);
    console.error("\n全エリアの生成完了後に --merge-only で再実行できます。");
    process.exit(1);
}

const allCoords = [];
let mergedCount = 0;
let skippedCount = 0;

for (const entry of entries) {
    const fileName = NAME_TO_FILE[entry.name];
    if (!fileName) { skippedCount++; continue; }

    const outFile = path.join(OUT_DIR, `${fileName}.json`);
    if (!fs.existsSync(outFile)) {
        console.warn(`  ⚠ ファイルなし（未生成）: ${entry.name}`);
        skippedCount++;
        continue;
    }

    try {
        const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
        const coords = Array.isArray(data) ? data : (data.customCoordinates || []);
        allCoords.push(...coords);
        console.log(`  + ${entry.name_jp || entry.name}: ${coords.length} 件`);
        mergedCount++;
    } catch (e) {
        console.warn(`  ⚠ 読み込み失敗: ${entry.name}: ${e.message}`);
        skippedCount++;
    }
}

const finalDir = path.dirname(FINAL_OUT);
if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

const inner = allCoords.map(loc => JSON.stringify(loc)).join(",\n");
fs.writeFileSync(FINAL_OUT, `{"customCoordinates":[\n${inner}\n]}`, "utf-8");

console.log(`\nマージ完了: ${mergedCount} 国 / ${allCoords.length} ロケーション`);
if (skippedCount > 0) console.log(`スキップ: ${skippedCount} 件`);
console.log(`出力: ${FINAL_OUT}`);
