const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

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

async function fetchAsset(env, request, assetPath) {
	const assetUrl = new URL(request.url);
	assetUrl.pathname = assetPath;
	assetUrl.search = '';
	return env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
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

export default {
	async fetch(request, env) {
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

		return env.ASSETS.fetch(request);
	}
};

