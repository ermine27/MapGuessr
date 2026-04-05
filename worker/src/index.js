// 共通CORSヘッダー。ローカル開発中の Pages / Live Server からも API を呼べるようにしている。
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

// Phase 2A では Durable Objects ではなく Worker メモリ上でセッションを保持する。
const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const sessions = new Map();
let mapListCache = null;
const mapDataCache = new Map();

// JSON レスポンス生成を共通化。
function jsonResponse(data, init = {}) {
	return new Response(JSON.stringify(data, null, 2), {
		status: init.status || 200,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			...corsHeaders,
			...(init.headers || {})
		}
	});
}

function errorResponse(status, error) {
	return jsonResponse({ error }, { status });
}

function methodNotAllowed(allowedMethods) {
	return new Response('Method Not Allowed', {
		status: 405,
		headers: {
			Allow: allowedMethods.join(', '),
			...corsHeaders
		}
	});
}

async function readJsonBody(request) {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

async function fetchAsset(env, request, assetPath) {
	const assetUrl = new URL(request.url);
	assetUrl.pathname = assetPath;
	assetUrl.search = '';
	return env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
}

async function fetchAssetJson(env, request, assetPath) {
	const response = await fetchAsset(env, request, assetPath);
	if (!response.ok) {
		throw new Error('Failed to load asset: ' + assetPath + ' (' + response.status + ')');
	}
	return response.json();
}

function withCors(response) {
	const headers = new Headers(response.headers);
	Object.entries(corsHeaders).forEach(function ([key, value]) {
		headers.set(key, value);
	});
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function clampInt(value, fallback, min, max) {
	const num = Number.parseInt(value, 10);
	if (!Number.isFinite(num)) return fallback;
	return Math.max(min, Math.min(max, num));
}

function clampNumber(value, fallback, min) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.max(min, num);
}

function shuffleIndices(length) {
	const indices = Array.from({ length }, function (_, index) { return index; });
	for (let i = indices.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = indices[i];
		indices[i] = indices[j];
		indices[j] = tmp;
	}
	return indices;
}

// JSON 内の location を、ゲーム進行に必要な最小形式へ正規化する。
function normalizeLocation(location) {
	const extraPanoId = location && location.extra && typeof location.extra.panoId === 'string'
		? location.extra.panoId
		: null;
	return {
		lat: Number(location.lat),
		lng: Number(location.lng),
		heading: Number.isFinite(Number(location.heading)) ? Number(location.heading) : 0,
		pitch: Number.isFinite(Number(location.pitch)) ? Number(location.pitch) : 0,
		zoom: Number.isFinite(Number(location.zoom)) ? Number(location.zoom) : 0,
		panoId: location.panoId || extraPanoId || null
	};
}

function haversineMeters(a, b) {
	const earthRadius = 6371000;
	const toRadians = Math.PI / 180;
	const lat1 = a.lat * toRadians;
	const lat2 = b.lat * toRadians;
	const dLat = (b.lat - a.lat) * toRadians;
	const dLng = (b.lng - a.lng) * toRadians;
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
	return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function calculateScore(distanceKm, scaleS) {
	return Math.round(5000 * Math.exp(-distanceKm / (scaleS || 2000)));
}

function createSessionId() {
	return crypto.randomUUID();
}

function cleanupExpiredSessions() {
	const now = Date.now();
	for (const [sessionId, session] of sessions.entries()) {
		if (now - session.updatedAt > SESSION_TTL_MS) {
			sessions.delete(sessionId);
		}
	}
}

function touchSession(session) {
	session.updatedAt = Date.now();
}

function sanitizeMapInfo(mapInfo) {
	return {
		key: mapInfo.key,
		nameJa: mapInfo.nameJa,
		description: mapInfo.description,
		scaleS: mapInfo.scaleS,
		locationCount: mapInfo.locationCount,
		mapCenter: mapInfo.mapCenter,
		mapZoom: mapInfo.mapZoom
	};
}

function buildPanoPayload(location) {
	return {
		panoId: location.panoId,
		heading: location.heading,
		pitch: location.pitch,
		zoom: location.zoom
	};
}

function pickNextLocation(session, locations) {
	if (!Array.isArray(session.queue) || session.queue.length === 0) {
		session.queue = shuffleIndices(locations.length);
	}
	const nextIndex = session.queue.pop();
	const currentLocation = locations[nextIndex];
	session.currentLocationIndex = nextIndex;
	session.currentLocation = currentLocation;
	return currentLocation;
}

async function getMapList(env, request) {
	if (mapListCache) return mapListCache;
	const data = await fetchAssetJson(env, request, '/config/map-list.json');
	mapListCache = Array.isArray(data) ? data : [];
	return mapListCache;
}

// マップ一覧情報とロケーション配列をまとめて取得する。
// map-data は初回読み込み後に Worker 内でキャッシュする。
async function getMapBundle(env, request, mapKey) {
	const mapList = await getMapList(env, request);
	const mapInfo = mapList.find(function (map) { return map.key === mapKey; });
	if (!mapInfo) return null;
	if (!mapDataCache.has(mapKey)) {
		const raw = await fetchAssetJson(env, request, '/maps/' + mapKey + '.json');
		const locations = Array.isArray(raw) ? raw : (Array.isArray(raw.customCoordinates) ? raw.customCoordinates : []);
		mapDataCache.set(mapKey, locations.map(normalizeLocation).filter(function (location) {
			return Number.isFinite(location.lat) && Number.isFinite(location.lng);
		}));
	}
	return {
		mapInfo,
		locations: mapDataCache.get(mapKey)
	};
}

// ゲーム開始 API: セッションを作成し、1問目の pano 情報だけ返す。
async function handleGameStart(request, env) {
	const body = await readJsonBody(request);
	if (!body || typeof body !== 'object') {
		return errorResponse(400, 'Invalid JSON body');
	}

	const mapKey = typeof body.mapKey === 'string' ? body.mapKey : '';
	if (!/^[a-z0-9-]+$/i.test(mapKey)) {
		return errorResponse(400, 'Invalid map key');
	}

	const mapBundle = await getMapBundle(env, request, mapKey);
	if (!mapBundle) {
		return errorResponse(404, 'Map not found');
	}
	if (!mapBundle.locations.length) {
		return errorResponse(500, 'Map has no playable locations');
	}

	const session = {
		sessionId: createSessionId(),
		mapKey,
		mapInfo: sanitizeMapInfo(mapBundle.mapInfo),
		totalRounds: clampInt(body.rounds, 5, 1, 100),
		mode: typeof body.mode === 'string' ? body.mode : 'move',
		timeLimit: clampInt(body.timeLimit, 0, 0, 3600),
		currentRound: 1,
		totalScore: 0,
		queue: shuffleIndices(mapBundle.locations.length),
		currentLocationIndex: null,
		currentLocation: null,
		results: [],
		state: 'awaiting-guess',
		updatedAt: Date.now()
	};

	const firstLocation = pickNextLocation(session, mapBundle.locations);
	sessions.set(session.sessionId, session);

	return jsonResponse({
		sessionId: session.sessionId,
		round: session.currentRound,
		totalRounds: session.totalRounds,
		mode: session.mode,
		timeLimit: session.timeLimit,
		mapInfo: session.mapInfo,
		pano: buildPanoPayload(firstLocation)
	});
}

function getSessionFromBody(body) {
	if (!body || typeof body !== 'object' || typeof body.sessionId !== 'string') {
		return { error: errorResponse(400, 'sessionId is required') };
	}
	const session = sessions.get(body.sessionId);
	if (!session) {
		return { error: errorResponse(404, 'Session not found or expired') };
	}
	touchSession(session);
	return { session };
}

// Guess API: 推測座標を受け取り、Worker 側で距離計算と採点を行う。
async function handleGameGuess(request, env) {
	const body = await readJsonBody(request);
	if (!body || typeof body !== 'object') {
		return errorResponse(400, 'Invalid JSON body');
	}

	const sessionLookup = getSessionFromBody(body);
	if (sessionLookup.error) return sessionLookup.error;
	const session = sessionLookup.session;

	if (session.state !== 'awaiting-guess' || !session.currentLocation) {
		return errorResponse(409, 'This round has already been resolved');
	}

	const timedOut = Boolean(body.timedOut) || !body.guess;
	let distanceKm = null;
	let score = 0;
	let guessPosition = null;

	if (!timedOut) {
		const guess = body.guess || {};
		const lat = Number(guess.lat);
		const lng = Number(guess.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			return errorResponse(400, 'guess.lat and guess.lng must be numbers');
		}
		guessPosition = { lat, lng };
		distanceKm = haversineMeters(guessPosition, session.currentLocation) / 1000;
		score = calculateScore(distanceKm, session.mapInfo.scaleS);
	}

	session.totalScore += score;
	session.results.push({
		round: session.currentRound,
		score,
		distanceKm,
		roundTime: clampInt(body.roundTime, 0, 0, 36000),
		travelDistance: clampNumber(body.travelDistance, 0, 0),
		guess: guessPosition,
		answer: {
			lat: session.currentLocation.lat,
			lng: session.currentLocation.lng
		}
	});
	session.state = session.currentRound >= session.totalRounds ? 'finished' : 'awaiting-next';

	return jsonResponse({
		round: session.currentRound,
		distanceKm,
		score,
		totalScore: session.totalScore,
		answer: {
			lat: session.currentLocation.lat,
			lng: session.currentLocation.lng
		},
		isLastRound: session.state === 'finished'
	});
}

// Next API: 現在のセッションから次ラウンドを進め、次の pano を返す。
async function handleGameNext(request, env) {
	const body = await readJsonBody(request);
	if (!body || typeof body !== 'object') {
		return errorResponse(400, 'Invalid JSON body');
	}

	const sessionLookup = getSessionFromBody(body);
	if (sessionLookup.error) return sessionLookup.error;
	const session = sessionLookup.session;

	if (session.state === 'awaiting-guess') {
		return errorResponse(409, 'You must submit a guess before moving to the next round');
	}
	if (session.state === 'finished') {
		return errorResponse(409, 'The game is already finished');
	}

	const mapBundle = await getMapBundle(env, request, session.mapKey);
	if (!mapBundle || !mapBundle.locations.length) {
		return errorResponse(500, 'Map data is unavailable');
	}

	session.currentRound += 1;
	session.state = 'awaiting-guess';
	const nextLocation = pickNextLocation(session, mapBundle.locations);

	return jsonResponse({
		sessionId: session.sessionId,
		round: session.currentRound,
		totalRounds: session.totalRounds,
		pano: buildPanoPayload(nextLocation)
	});
}

async function handleGameResult(request) {
	const url = new URL(request.url);
	const sessionId = url.searchParams.get('sessionId') || '';
	if (!sessionId) {
		return errorResponse(400, 'sessionId is required');
	}
	const session = sessions.get(sessionId);
	if (!session) {
		return errorResponse(404, 'Session not found or expired');
	}
	touchSession(session);
	return jsonResponse({
		sessionId: session.sessionId,
		mapKey: session.mapKey,
		totalRounds: session.totalRounds,
		currentRound: session.currentRound,
		finished: session.state === 'finished',
		totalScore: session.totalScore,
		results: session.results
	});
}

export default {
	async fetch(request, env) {
		// リクエストのたびに期限切れセッションを軽く掃除する。
		cleanupExpiredSessions();
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		if (url.pathname === '/api/health') {
			return jsonResponse({ ok: true });
		}

		if (url.pathname === '/api/maps') {
			const response = await fetchAsset(env, request, '/config/map-list.json');
			return withCors(response);
		}

		if (url.pathname === '/api/map-data') {
			const key = url.searchParams.get('key') || '';
			if (!/^[a-z0-9-]+$/i.test(key)) {
				return jsonResponse({ error: 'Invalid map key' }, { status: 400 });
			}
			const response = await fetchAsset(env, request, '/maps/' + key + '.json');
			return withCors(response);
		}

		if (url.pathname === '/api/game/start') {
			if (request.method !== 'POST') return methodNotAllowed(['POST']);
			return handleGameStart(request, env);
		}

		if (url.pathname === '/api/game/guess') {
			if (request.method !== 'POST') return methodNotAllowed(['POST']);
			return handleGameGuess(request, env);
		}

		if (url.pathname === '/api/game/next') {
			if (request.method !== 'POST') return methodNotAllowed(['POST']);
			return handleGameNext(request, env);
		}

		if (url.pathname === '/api/game/result') {
			if (request.method !== 'GET') return methodNotAllowed(['GET']);
			return handleGameResult(request);
		}

		return env.ASSETS.fetch(request);
	}
};

