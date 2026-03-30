#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

// ──────────────────────────────────────────
// CLI引数解析
// ──────────────────────────────────────────

function parseArgs(argv) {
    const args = {
        area: null,
        count: null,
        output: null,
        apiKey: process.env.GMAPS_KEY || null,
        officialOnly: true,
        minDistance: 0,
        radius: 1000,
        concurrency: 5,
        saveInterval: 100,
        resume: null,
    };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case "--area": args.area = argv[++i]; break;
            case "--count": args.count = parseInt(argv[++i], 10); break;
            case "--output": args.output = argv[++i]; break;
            case "--api-key": args.apiKey = argv[++i]; break;
            case "--no-official-only": args.officialOnly = false; break;
            case "--min-distance": args.minDistance = parseFloat(argv[++i]); break;
            case "--radius": args.radius = parseInt(argv[++i], 10); break;
            case "--concurrency": args.concurrency = parseInt(argv[++i], 10); break;
            case "--save-interval": args.saveInterval = parseInt(argv[++i], 10); break;
            case "--resume": args.resume = argv[++i]; break;
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
        }
    }

    return args;
}

function printUsage() {
    console.log(`
使用方法:
  node generate-map.js --area <geojson> --count <n> [options]

オプション:
  --area <path>          エリアGeoJSONファイルのパス（必須）
  --count <n>            生成するロケーション数（必須）
  --output <path>        出力ファイルパス
                       （省略時: tools/output/maps/<name>-<count>.json）
  --api-key <key>        Google Maps APIキー（または環境変数 GMAPS_KEY）
  --no-official-only     Googleオフィシャル以外のパノラマも含める
  --min-distance <km>    ロケーション間の最小距離km（デフォルト: 0）
  --radius <m>           Street View検索半径メートル（デフォルト: 1000）
  --concurrency <n>      並列リクエスト数（デフォルト: 5）
  --save-interval <n>    チェックポイント保存間隔（デフォルト: 100）
  --resume <path>        チェックポイントファイルから再開

例:
    node generate-map.js --area tools/output/areas/jp.geojson --count 1000
    node generate-map.js --area tools/output/areas/north-america.geojson --count 500 --min-distance 5
    node generate-map.js --area tools/output/areas/jp.geojson --count 1000 --resume output.json.tmp.json
`);
}

function validateArgs(args) {
    const errors = [];
    if (!args.area) errors.push("--area <path> が必要です");
    if (!args.count || args.count <= 0) errors.push("--count <n> には正の整数を指定してください");
    if (!args.apiKey) errors.push("--api-key または環境変数 GMAPS_KEY が必要です");

    if (errors.length > 0) {
        errors.forEach(e => console.error("エラー: " + e));
        console.error("");
        printUsage();
        process.exit(1);
    }
}

// ──────────────────────────────────────────
// GeoJSON ジオメトリユーティリティ
// ──────────────────────────────────────────

function computeBbox(geometry) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    function scan(coords) {
        if (!Array.isArray(coords[0])) {
            // 末端の座標 [lng, lat]
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

function bboxArea(b) {
    return (b.maxLat - b.minLat) * (b.maxLng - b.minLng);
}

/** レイキャスト法による点の多角形内判定。ring は [[lng, lat], ...] */
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

/** Polygon / MultiPolygon に対して PIP テスト（穴あきポリゴン対応） */
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
// 重み付きフィーチャー選択
// ──────────────────────────────────────────

/** フィーチャーごとのバウンディングボックス面積に比例した重みテーブルを構築 */
function buildWeightTable(features) {
    const table = features.map(f => ({
        feature: f,
        box: computeBbox(f.geometry),
        cumulative: 0,
    }));

    const totalArea = table.reduce((s, t) => s + bboxArea(t.box), 0);
    let cum = 0;
    for (const t of table) {
        cum += bboxArea(t.box) / totalArea;
        t.cumulative = cum;
    }
    // 浮動小数点誤差対策: 末尾を必ず 1.0 にする
    table[table.length - 1].cumulative = 1.0;
    return table;
}

/** 重みに応じてランダムにフィーチャーを選択 */
function pickFeature(table) {
    const r = Math.random();
    for (const t of table) {
        if (r <= t.cumulative) return t;
    }
    return table[table.length - 1];
}

function randomPointInBbox(box) {
    return {
        lat: box.minLat + Math.random() * (box.maxLat - box.minLat),
        lng: box.minLng + Math.random() * (box.maxLng - box.minLng),
    };
}

/**
 * PIPテストに合格するランダム点をサンプリング。
 * maxTries 回試行しても見つからない場合は null を返す。
 */
function samplePoint(table, maxTries = 300) {
    for (let i = 0; i < maxTries; i++) {
        const t = pickFeature(table);
        const { lat, lng } = randomPointInBbox(t.box);
        if (pointInGeometry(lat, lng, t.feature.geometry)) {
            return { lat, lng, feature: t.feature };
        }
    }
    return null;
}

// ──────────────────────────────────────────
// Haversine 距離計算
// ──────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

function isTooClose(lat, lng, collected, minKm) {
    if (minKm <= 0) return false;
    return collected.some(loc => haversineKm(lat, lng, loc.lat, loc.lng) < minKm);
}

// ──────────────────────────────────────────
// Street View Metadata API
// ──────────────────────────────────────────

function fetchMetadata(lat, lng, apiKey, radius) {
    return new Promise((resolve, reject) => {
        const url =
            `https://maps.googleapis.com/maps/api/streetview/metadata` +
            `?location=${lat},${lng}&radius=${radius}&source=outdoor&key=${apiKey}`;
        https.get(url, res => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("API応答のパース失敗: " + e.message)); }
            });
        }).on("error", reject);
    });
}

// ──────────────────────────────────────────
// プログレス表示
// ──────────────────────────────────────────

let progressStartTime = Date.now();

function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function showProgress(collected, total, attempts) {
    const pct = (collected / total * 100).toFixed(1);
    const successRate = attempts > 0 ? (collected / attempts * 100).toFixed(1) : "0.0";
    const elapsed = (Date.now() - progressStartTime) / 1000;

    const totalLen = String(total).length;
    const collectedStr = String(collected).padStart(totalLen + 2);

    let etaStr = "--:--:--";
    if (collected > 0) {
        const remaining = (elapsed / collected) * (total - collected);
        etaStr = formatTime(remaining);
    }

    const line =
        `[${collectedStr} / ${total}] ${pct}%` +
        `  試行: ${attempts.toLocaleString('en-US')}` +
        `  成功率: ${successRate}%` +
        `  経過: ${formatTime(elapsed)}` +
        `  残り予測: ${etaStr}`;
    process.stdout.write("\r\x1b[K" + line);
}

// ──────────────────────────────────────────
// チェックポイント
// ──────────────────────────────────────────

function saveCheckpoint(tmpPath, collected) {
    const dir = path.dirname(tmpPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(collected), "utf8");
}

function loadCheckpoint(cpPath) {
    return JSON.parse(fs.readFileSync(cpPath, "utf8"));
}

// ──────────────────────────────────────────
// 出力ファイル書き込み
// ──────────────────────────────────────────

function writeOutput(outputPath, collected) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 1ロケーション1行の compact フォーマット
    const inner = collected.map(loc => JSON.stringify(loc)).join(",\n");
    const content = `{"customCoordinates":[\n${inner}\n]}`;
    fs.writeFileSync(outputPath, content, "utf8");
}

// ──────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2));
    validateArgs(args);

    // エリアGeoJSON読み込み
    const areaPath = path.resolve(args.area);
    if (!fs.existsSync(areaPath)) {
        console.error(`エラー: エリアファイルが見つかりません: ${areaPath}`);
        process.exit(1);
    }

    let areaData;
    try {
        areaData = JSON.parse(fs.readFileSync(areaPath, "utf8"));
    } catch (e) {
        console.error("エラー: GeoJSONのパースに失敗しました:", e.message);
        process.exit(1);
    }

    const features =
        areaData.type === "FeatureCollection" ? areaData.features :
            areaData.type === "Feature" ? [areaData] : [];

    if (features.length === 0) {
        console.error("エラー: GeoJSONにフィーチャーが見つかりません。");
        process.exit(1);
    }

    // 出力パスの決定
    const areaBaseName = path.basename(areaPath, ".geojson");
    const outputPath = args.output
        ? path.resolve(args.output)
        : path.resolve(path.dirname(areaPath), "..", "maps", `${areaBaseName}-${args.count}.json`);

    const tmpPath = outputPath + ".tmp.json";

    // チェックポイントから再開 or 新規開始
    let collected = [];
    if (args.resume) {
        const resumePath = path.resolve(args.resume);
        if (!fs.existsSync(resumePath)) {
            console.error(`エラー: チェックポイントファイルが見つかりません: ${resumePath}`);
            process.exit(1);
        }
        try {
            collected = loadCheckpoint(resumePath);
            console.log(`チェックポイントから再開: ${collected.length} ロケーション読み込み済み`);
        } catch (e) {
            console.error("エラー: チェックポイントの読み込みに失敗:", e.message);
            process.exit(1);
        }
    }

    if (collected.length >= args.count) {
        console.log(`既に ${collected.length} ロケーションあります。出力ファイルを書き込んで終了します。`);
        writeOutput(outputPath, collected);
        process.exit(0);
    }

    // 起動情報表示
    console.log(`エリア:          ${areaBaseName} (${features.length} フィーチャー)`);
    console.log(`目標:            ${args.count} ロケーション（収集済み: ${collected.length}）`);
    console.log(`設定:            concurrency=${args.concurrency}, official-only=${args.officialOnly}, min-distance=${args.minDistance}km, radius=${args.radius}m`);
    console.log(`出力:            ${outputPath}`);
    console.log(`チェックポイント: ${tmpPath}`);
    console.log("");

    const weightTable = buildWeightTable(features);
    let attempts = 0;
    progressStartTime = Date.now();

    // Ctrl+C でチェックポイント保存してから終了
    process.on("SIGINT", () => {
        process.stdout.write("\n");
        console.log(`\n中断。${collected.length} ロケーションをチェックポイントに保存中...`);
        saveCheckpoint(tmpPath, collected);
        console.log(`チェックポイント: ${tmpPath}`);
        console.log(`再開コマンド: --resume "${tmpPath}" （--area, --count, --output は同じ値を使用）`);
        process.exit(0);
    });

    // ──── メイン収集ループ ────
    while (collected.length < args.count) {
        // 候補点を concurrency 個サンプリング（PIPテスト通過まで試行）
        const candidates = [];
        for (let i = 0; i < args.concurrency; i++) {
            const pt = samplePoint(weightTable);
            if (pt) candidates.push(pt);
        }

        if (candidates.length === 0) {
            process.stdout.write("\n");
            console.error("エラー: エリア内の有効な点をサンプリングできません。GeoJSONを確認してください。");
            process.exit(1);
        }

        const batchStart = Date.now();
        attempts += candidates.length;

        // API リクエストを並列実行
        const results = await Promise.all(
            candidates.map(c =>
                fetchMetadata(c.lat, c.lng, args.apiKey, args.radius)
                    .then(meta => ({ meta, candidate: c }))
                    .catch(() => null)
            )
        );

        // 結果を処理 — 致命的APIエラーの早期検出
        for (const result of results) {
            if (collected.length >= args.count) break;
            if (!result) continue;

            const { meta, candidate } = result;
            if (meta.status !== "OK") {
                if (meta.status === "REQUEST_DENIED" || meta.status === "OVER_QUERY_LIMIT") {
                    process.stdout.write("\n");
                    console.error(`\nAPIエラー: ${meta.status}`);
                    if (meta.error_message) console.error(meta.error_message);
                    if (meta.status === "REQUEST_DENIED") {
                        console.error("→ APIキーで Street View Static API が有効になっているか確認してください。");
                        console.error("  https://console.cloud.google.com/apis/library/street-view-image-backend.googleapis.com");
                    }
                    if (collected.length > 0) saveCheckpoint(tmpPath, collected);
                    process.exit(1);
                }
                continue;
            }

            // オフィシャルのみフィルタ（Googleコピーライト）
            if (args.officialOnly) {
                const copyright = (meta.copyright || "").toLowerCase();
                if (!copyright.includes("google")) continue;
            }

            const lat = meta.location.lat;
            const lng = meta.location.lng;

            // 最小距離チェック
            if (isTooClose(lat, lng, collected, args.minDistance)) continue;

            // フィーチャーのプロパティから国コード・州コードを取得
            const props = candidate.feature.properties || {};
            const countryCode = (props.iso_a2 && props.iso_a2 !== "-99") ? props.iso_a2 : null;
            const stateCode = props.hasc || null;

            collected.push({
                panoId: meta.pano_id,
                lat,
                lng,
                heading: Math.random() * 360,
                pitch: 0,
                zoom: 0,
                countryCode,
                stateCode,
            });

            // 定期チェックポイント保存
            if (collected.length % args.saveInterval === 0) {
                saveCheckpoint(tmpPath, collected);
            }
        }

        showProgress(collected.length, args.count, attempts);

        // レート制限: 100 QPS を超えないよう最小バッチ時間を確保
        // 100 QPS → 1リクエストあたり最低 10ms
        const elapsed = Date.now() - batchStart;
        const minMs = candidates.length * 10;
        if (elapsed < minMs) {
            await new Promise(r => setTimeout(r, minMs - elapsed));
        }
    }

    process.stdout.write("\n");
    const totalSec = ((Date.now() - progressStartTime) / 1000).toFixed(1);
    console.log(`\n完了！ ${collected.length} ロケーション / ${attempts} 試行（${totalSec}秒）`);

    // 最終出力ファイル書き込み
    writeOutput(outputPath, collected);
    console.log(`出力ファイル: ${outputPath}`);

    // チェックポイントを削除
    if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch { }
    }
}

main().catch(err => {
    console.error("\n致命的エラー:", err.message);
    process.exit(1);
});
