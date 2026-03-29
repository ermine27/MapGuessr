#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

// --- Haversine距離（km） ---
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // 地球半径（km）
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeLng360(lng) {
    return ((lng % 360) + 360) % 360;
}

function normalizeLng180(lng) {
    const normalized = normalizeLng360(lng);
    return normalized > 180 ? normalized - 360 : normalized;
}

function findMinimalLongitudeBounds(locations) {
    const points = locations
        .map((loc) => ({ ...loc, lng360: normalizeLng360(loc.lng) }))
        .sort((a, b) => a.lng360 - b.lng360);

    let maxGap = -Infinity;
    let maxGapIndex = -1;

    for (let i = 0; i < points.length; i++) {
        const current = points[i].lng360;
        const next = i === points.length - 1 ? points[0].lng360 + 360 : points[i + 1].lng360;
        const gap = next - current;

        if (gap > maxGap) {
            maxGap = gap;
            maxGapIndex = i;
        }
    }

    const westIndex = (maxGapIndex + 1) % points.length;
    const eastIndex = maxGapIndex;
    const westPoint = points[westIndex];
    const eastPoint = points[eastIndex];
    const westLng360 = westPoint.lng360;
    let eastLng360 = eastPoint.lng360;

    if (eastLng360 < westLng360) {
        eastLng360 += 360;
    }

    return {
        westPoint,
        eastPoint,
        westLng360,
        eastLng360,
        lngSpan: eastLng360 - westLng360
    };
}

// --- 引数の解析 ---
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Usage: node calc-scale.js <map-file.json> <K>");
    console.error("  例: node calc-scale.js ../docs/maps/Japan-1000-locations.json 12");
    process.exit(1);
}

const mapFilePath = path.resolve(args[0]);
const K = Number(args[1]);

if (!Number.isFinite(K) || K <= 0) {
    console.error("エラー: K は正の数で指定してください。");
    process.exit(1);
}

// --- マップファイルの読み込み ---
let locations;
try {
    const raw = fs.readFileSync(mapFilePath, "utf-8");
    locations = JSON.parse(raw);
} catch (e) {
    console.error(`ファイル読み込みエラー: ${e.message}`);
    process.exit(1);
}

// 配列形式と { customCoordinates: [...] } 形式の両方に対応
if (!Array.isArray(locations)) {
    if (locations.customCoordinates && Array.isArray(locations.customCoordinates)) {
        locations = locations.customCoordinates;
    } else {
        console.error("エラー: マップファイルの形式が不正です。配列または { customCoordinates: [...] } が必要です。");
        process.exit(1);
    }
}
if (locations.length < 2) {
    console.error("エラー: マップファイルに2地点以上の配列が必要です。");
    process.exit(1);
}

console.log(`マップファイル : ${path.basename(mapFilePath)}`);
console.log(`地点数         : ${locations.length}`);

// --- バウンディングボックスの端点 ---
let north = -Infinity,
    south = Infinity,
    east,
    west;
let northPt, southPt, eastPt, westPt;

for (const loc of locations) {
    if (loc.lat > north) {
        north = loc.lat;
        northPt = loc;
    }
    if (loc.lat < south) {
        south = loc.lat;
        southPt = loc;
    }
}

const longitudeBounds = findMinimalLongitudeBounds(locations);
west = normalizeLng180(longitudeBounds.westLng360);
east = normalizeLng180(longitudeBounds.eastLng360);
westPt = longitudeBounds.westPoint;
eastPt = longitudeBounds.eastPoint;

// バウンディングボックスの中心座標を算出
const latSpan = north - south;
const lngSpan = longitudeBounds.lngSpan;

const centerLat = (north + south) / 2;
const centerLng = normalizeLng180(longitudeBounds.westLng360 + lngSpan / 2);

// ズームレベル算出（バウンディングボックスが1タイルに収まる最大ズーム）
const zoomByLng = Math.log2(360 / lngSpan);
const zoomByLat = Math.log2(180 / latSpan);
const mapZoom = Math.max(1, Math.round(Math.min(zoomByLng, zoomByLat)));

// 4端点からDmaxを計算（全組み合わせの最大値を採用）
const extremes = [northPt, southPt, eastPt, westPt];
let Dmax = 0;
for (let i = 0; i < extremes.length; i++) {
    for (let j = i + 1; j < extremes.length; j++) {
        const d = haversineKm(
            extremes[i].lat,
            extremes[i].lng,
            extremes[j].lat,
            extremes[j].lng
        );
        if (d > Dmax) Dmax = d;
    }
}

console.log(`\nバウンディングボックス:`);
console.log(`  最北端: lat=${north.toFixed(6)}, lng=${northPt.lng.toFixed(6)}`);
console.log(`  最南端: lat=${south.toFixed(6)}, lng=${southPt.lng.toFixed(6)}`);
console.log(`  最東端: lat=${eastPt.lat.toFixed(6)}, lng=${east.toFixed(6)}`);
console.log(`  最西端: lat=${westPt.lat.toFixed(6)}, lng=${west.toFixed(6)}`);
console.log(`\nDmax (対角線最大距離): ${Dmax.toFixed(2)} km`);

// --- Sの算出 ---
const S = Dmax / K;
console.log(`K              : ${K}`);
console.log(`S = Dmax / K   : ${S.toFixed(2)} km`);

// --- スコアプレビュー ---
// score = 5000 * exp(-distance / S)
// distance = -S * ln(score / 5000)
function distanceForScore(score) {
    if (score <= 0) return Infinity;
    if (score >= 5000) return 0;
    return -S * Math.log(score / 5000);
}

function formatDistance(km) {
    if (km < 1) return `${(km * 1000).toFixed(0)}m`;
    if (km < 10) return `${km.toFixed(2)}km`;
    if (km < 100) return `${km.toFixed(1)}km`;
    return `${km.toFixed(0)}km`;
}

const previewScores = [5000, 4999, 4990, 4900, 4500, 4000, 3000, 2000, 1000, 500, 100, 1, 0];

console.log("\n=== スコアプレビュー ===");
for (let i = 0; i < previewScores.length; i++) {
    const sc = previewScores[i];
    if (sc === 5000) {
        const upper = distanceForScore(4999.5); // 四捨五入で5000点になる上限距離
        console.log(`  5000点: ${formatDistance(upper)} 以内`);
    } else if (sc === 0) {
        const lower = distanceForScore(0.5); // 四捨五入で0点になる下限距離
        console.log(`     0点: ${formatDistance(lower)} 以上`);
    } else {
        // 生スコアが [sc - 0.5, sc + 0.5) のとき四捨五入後に sc 点になる
        const upper = distanceForScore(sc + 0.5);
        const lower = distanceForScore(sc - 0.5);
        const label = String(sc).padStart(5);
        console.log(`  ${label}点: ${formatDistance(upper)} ～ ${formatDistance(lower)}`);
    }
}

// map-list.json 用スニペット出力
const mapKey = path.basename(mapFilePath, ".json");
console.log("\n--- map-list.json 用スニペット ---");
console.log(`    {`);
console.log(`        "key": "${mapKey}",`);
console.log(`        "nameJa": "マップタイトル",`);
console.log(`        "description": "マップの説明",`);
console.log(`        "scaleS": ${Math.round(S)},`);
console.log(`        "locationCount": ${locations.length},`);
console.log(`        "mapCenter": { "lat": ${centerLat.toFixed(4)}, "lng": ${centerLng.toFixed(4)} },`);
console.log(`        "mapZoom": ${mapZoom}`);
console.log(`    },`);
