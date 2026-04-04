/**
 * generate-world-map.js
 *
 * work/countries/NaturalEarth.csv の各エリアに対して generate-map.js を実行し、
 * 生成した全ロケーションを 1 つの world-maps.geojson にまとめる。
 *
 * 使い方:
 *   node work/generate-world-map.js --api-key <key>
 *   node work/generate-world-map.js --api-key <key> --merge-only
 *   node work/generate-world-map.js --api-key <key> --force
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
const FINAL_OUT = path.join(__dirname, "output", "maps", "world-maps.geojson");
const GENERATE_JS = path.join(ROOT, "tools", "generate-map.js");

// ── NaturalEarth NAME → エリアファイル名（.geojson 除く）マップ ──
// Natural Earth の NAME 列はファイル名と一致しないものがあるため明示的に定義する。
const NAME_TO_FILE = {
    "Albania": "Albania",
    "American Samoa": "American-Samoa",
    "Andorra": "Andorra",
    "Antarctica": "Antarctica",
    "Argentina": "Argentina",
    "Australia": "Australia",
    "Austria": "Austria",
    "Bangladesh": "Bangladesh",
    "Belgium": "Belgium",
    "Bermuda": "Bermuda",
    "Bhutan": "Bhutan",
    "Bolivia": "Bolivia",
    "Bosnia and Herz.": "Bosnia-and-Herzegovina",
    "Botswana": "Botswana",
    "Brazil": "Brazil",
    "British Virgin Is.": "British-Virgin-Island",
    "Bulgaria": "Bulgaria",
    "Cambodia": "Cambodia",
    "Canada": "Canada",
    "Chile": "Chile",
    "Colombia": "Colombia",
    "Costa Rica": "Costa-Rica",
    "Croatia": "Croatia",
    "Curaçao": "Curaçao",
    "Cyprus": "Cyprus",
    "Czechia": "Czechia",
    "Denmark": "Denmark",
    "Dominican Rep.": "Dominican-Rep",
    "Ecuador": "Ecuador",
    "Estonia": "Estonia",
    "eSwatini": "eSwatini",
    "Faeroe Is.": "Faeroe-Island",
    "Finland": "Finland",
    "France": "France",
    "Germany": "Germany",
    "Ghana": "Ghana",
    "Gibraltar": "Gibraltar",
    "Greece": "Greece",
    "Greenland": "Greenland",
    "Guam": "Guam",
    "Guatemala": "Guatemala",
    "Hong Kong": "Hong-Kong",
    "Hungary": "Hungary",
    "Iceland": "Iceland",
    "India": "India",
    "Indonesia": "Indonesia",
    "Ireland": "Ireland",
    "Isle of Man": "Isle-of-Man",
    "Israel": "Israel",
    "Italy": "Italy",
    "Japan": "Japan",
    "Jersey": "Jersey",
    "Jordan": "Jordan",
    "Kazakhstan": "Kazakhstan",
    "Kenya": "Kenya",
    "Kyrgyzstan": "Kyrgyzstan",
    "Laos": "Laos",
    "Latvia": "Latvia",
    "Lebanon": "Lebanon",
    "Lesotho": "Lesotho",
    "Liechtenstein": "Liechtenstein",
    "Lithuania": "Lithuania",
    "Luxembourg": "Luxembourg",
    "Macao": "Macao",
    "Madagascar": "Madagascar",
    "Malaysia": "Malaysia",
    "Malta": "Malta",
    "Mexico": "Mexico",
    "Monaco": "Monaco",
    "Mongolia": "Mongolia",
    "Montenegro": "Montenegro",
    "N. Mariana Is.": "North-Mariana",
    "Namibia": "Namibia",
    "Nepal": "Nepal",
    "Netherlands": "Netherlands",
    "New Zealand": "New-Zealand",
    "Nigeria": "Nigeria",
    "North Macedonia": "North-Macedonia",
    "Norway": "Norway",
    "Oman": "Oman",
    "Palestine": "Palestine",
    "Panama": "Panama",
    "Paraguay": "Paraguay",
    "Peru": "Peru",
    "Philippines": "Philippines",
    "Poland": "Poland",
    "Portugal": "Portugal",
    "Puerto Rico": "Puerto-Rico",
    "Qatar": "Qatar",
    "Romania": "Romania",
    "Russia": "Russia",
    "Rwanda": "Rwanda",
    "San Marino": "San-Marino",
    "São Tomé and Principe": "São-Tomé-and-Principe",
    "Senegal": "Senegal",
    "Serbia": "Serbia",
    "Singapore": "Singapore",
    "Slovakia": "Slovakia",
    "Slovenia": "Slovenia",
    "South Africa": "South-Africa",
    "South Korea": "South-Korea",
    "Spain": "Spain",
    "Sri Lanka": "Sri-Lanka",
    "Sweden": "Sweden",
    "Switzerland": "Switzerland",
    "Taiwan": "Taiwan",
    "Thailand": "Thailand",
    "Tunisia": "Tunisia",
    "Turkey": "Turkey",
    "U.S. Virgin Is.": "US-Virgin-Island",
    "Uganda": "Uganda",
    "Ukraine": "Ukraine",
    "United Arab Emirates": "United-Arab-Emirates",
    "United Kingdom": "United-Kingdom",
    "United States of America": "United-States-of-America",
    "Uruguay": "Uruguay",
    "Vietnam": "Vietnam",
    "Yemen": "Yemen",
    "Åland": "Åland",
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
// ヘッダ: NAME  NAME_JP  CONTINENT  count  percent  min_distance_km
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
console.log(" generate-world-map.js");
console.log("============================================================");
console.log(`CSV エントリ（count > 0）: ${total} 件`);
console.log(`エリアディレクトリ: ${AREA_DIR}`);
console.log(`個別マップ出力先:   ${OUT_DIR}`);
console.log(`最終出力:           ${FINAL_OUT}`);
if (mergeOnly) console.log("モード: マージのみ（生成スキップ）");
if (force) console.log("モード: 強制再生成（--force）");
console.log("============================================================\n");

// ── 出力ディレクトリ作成 ──
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── マップ生成フェーズ ──
// 中断したエリアを記録
const abortedAreas = [];
const errorAreas = [];

if (!mergeOnly) {
    let doneCount = 0;

    for (const entry of entries) {
        doneCount++;
        const prefix = `(${String(doneCount).padStart(3)}/${total})`;

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

        // 既存ファイルチェック（--force でなければスキップ）
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

        // -- min-distance を下げながら再試行するループ --
        const MAX_CONSECUTIVE_FAIL = 500;
        const MIN_SUB_KM_FLOOR = 0.3;  // 300m が下限
        // km フェーズの中断閘値（初期値 - 10km、最低 1km）
        const KM_ABORT_THRESHOLD = Math.max(1.0, entry.min_dist - 10);
        let currentMinDist = entry.min_dist;
        let areaAborted = false;

        while (true) {
            // generate-map.js の引数を構築
            const suggestFile = outFile + ".suggest.json";
            const genArgs = [
                GENERATE_JS,
                "--area", areaFile,
                "--count", String(entry.count),
                "--output", outFile,
                "--api-key", apiKey,
                "--min-distance", String(currentMinDist),
                "--radius", "2000",
                "--max-consecutive-fail", String(MAX_CONSECUTIVE_FAIL),
            ];

            // チェックポイントがあれば再開
            if (!force && fs.existsSync(tmpFile)) {
                genArgs.push("--resume", tmpFile);
                console.log(`${prefix} ↻ 再開: ${entry.name} (${entry.count} 件, min=${currentMinDist}km)`);
            } else {
                console.log(`${prefix} ▶ 生成開始: ${entry.name} (${entry.count} 件, min=${currentMinDist}km)`);
            }

            const result = spawnSync("node", genArgs, {
                stdio: "inherit",
                cwd: ROOT,
            });

            // サジェストファイルを読み込んで削除
            let suggestedMinDist = null;
            if (fs.existsSync(suggestFile)) {
                try { suggestedMinDist = JSON.parse(fs.readFileSync(suggestFile, "utf-8")).suggestedMinDist; } catch { }
                try { fs.unlinkSync(suggestFile); } catch { }
            }

            if (result.status === 0) {
                // 正常完了
                break;
            } else if (result.status === 2) {
                // 連続失敗限界に達した
                // サジェストなし = min-distance 失敗が1件もなかった = Street View カバレッジ自体がない
                if (suggestedMinDist === null) {
                    console.error(`${prefix} ✗ Street View カバレッジなし（min-distance 無関係の失敗）: ${entry.name} → 中断`);
                    areaAborted = true;
                    break;
                }

                const prevDist = currentMinDist;
                const inSubKm = currentMinDist < 1.0 - 0.001;

                if (inSubKm) {
                    // サブkmフェーズ: 100m 単位で減少、300m が下限
                    if (currentMinDist <= MIN_SUB_KM_FLOOR + 0.001) {
                        console.error(`${prefix} ✗ min-distance=${currentMinDist}km でも ${MAX_CONSECUTIVE_FAIL} 回連続失敗: ${entry.name} → 中断`);
                        areaAborted = true;
                        break;
                    }
                    currentMinDist = Math.max(MIN_SUB_KM_FLOOR, Math.round((currentMinDist - 0.1) * 10) / 10);
                    console.log(`${prefix} ▼ min-distanceを ${prevDist}km → ${currentMinDist}km に引き下げて再試行: ${entry.name}`);
                } else {
                    // km フェーズ
                    if (currentMinDist <= KM_ABORT_THRESHOLD + 0.001) {
                        // しきい値に到達 → サブkmフェーズへ移行（0.9km から開始）
                        currentMinDist = 0.9;
                        console.log(`${prefix} ▼ min-distanceを ${prevDist}km → ${currentMinDist}km に引き下げて再試行: ${entry.name}`);
                    } else {
                        // 95パーセンタイルのサジェストを使って次の min-distance を決定
                        let nextDist;
                        if (suggestedMinDist !== null && suggestedMinDist < currentMinDist - 0.5) {
                            nextDist = Math.max(KM_ABORT_THRESHOLD, Math.floor(suggestedMinDist));
                            if (nextDist >= currentMinDist) nextDist = currentMinDist - 1;
                        } else {
                            nextDist = Math.max(KM_ABORT_THRESHOLD, currentMinDist - 1);
                        }
                        currentMinDist = nextDist;
                        console.log(`${prefix} ▼ min-distanceを ${prevDist}km → ${currentMinDist}km に引き下げて再試行: ${entry.name}`);
                    }
                }
                // チェックポイントは残ったまま次ループで再開される
            } else {
                // その他のエラー (exit 1 等)
                console.error(`${prefix} ✗ エラー終了 (exit: ${result.status}): ${entry.name} → 次のエリアへ続行`);
                errorAreas.push(entry.name);
                break;
            }
        }

        if (areaAborted) {
            abortedAreas.push(entry.name);
        }
    }

    console.log("\n生成フェーズ完了\n");
}

// ── マージフェーズ ──
console.log("============================================================");
console.log("マージ開始...");
console.log("============================================================");

// 中断エリアがある場合はマージを実行しない
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
        const coords = Array.isArray(data)
            ? data
            : (data.customCoordinates || []);
        allCoords.push(...coords);
        console.log(`  + ${entry.name_jp || entry.name}: ${coords.length} 件`);
        mergedCount++;
    } catch (e) {
        console.warn(`  ⚠ 読み込み失敗: ${entry.name}: ${e.message}`);
        skippedCount++;
    }
}

// 最終ファイル出力
const finalDir = path.dirname(FINAL_OUT);
if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

fs.writeFileSync(FINAL_OUT, JSON.stringify({ customCoordinates: allCoords }), "utf-8");

const sizeMB = (fs.statSync(FINAL_OUT).size / 1024 / 1024).toFixed(2);

console.log("\n============================================================");
console.log("完了！");
console.log(`  マージエリア数:   ${mergedCount} 件（スキップ: ${skippedCount} 件）`);
console.log(`  総ロケーション数: ${allCoords.length} 件`);
console.log(`  出力:             ${FINAL_OUT} (${sizeMB} MB)`);
if (errorAreas.length > 0) {
    console.log(`\n  エラーでスキップされたエリア (${errorAreas.length} 件):`);
    for (const name of errorAreas) console.log(`    - ${name}`);
}
console.log("============================================================");
