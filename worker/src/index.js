import mapList from '../../docs/config/map-list.json';

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

export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		if (url.pathname === '/api/health') {
			return jsonResponse({ ok: true });
		}

		if (url.pathname === '/api/maps') {
			return jsonResponse(mapList);
		}

		return new Response('Not Found', {
			status: 404,
			headers: corsHeaders
		});
	}
};

