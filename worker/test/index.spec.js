import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// JSON POST を簡潔に呼ぶためのテストヘルパー。
async function postJson(path, body) {
	return SELF.fetch(`http://example.com${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(body)
	});
}

describe("MapGuessr worker APIs", () => {
	// ヘルスチェック API が最低限生きていることを確認する。
	it("returns health status", async () => {
		const response = await SELF.fetch("http://example.com/api/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	// start 時点では正解座標を返さず、pano 情報だけ返すことを確認する。
	it("starts a session without exposing the answer", async () => {
		const response = await postJson("/api/game/start", {
			mapKey: "japan-50k",
			rounds: 2,
			mode: "move",
			timeLimit: 0
		});
		expect(response.status).toBe(200);

		const data = await response.json();
		expect(data.sessionId).toEqual(expect.any(String));
		expect(data.round).toBe(1);
		expect(data.totalRounds).toBe(2);
		expect(data.pano).toMatchObject({
			heading: expect.any(Number),
			pitch: expect.any(Number),
			zoom: expect.any(Number)
		});
		expect(data.answer).toBeUndefined();
	});

	// guess -> next の一連の流れで、採点とラウンド進行が成立することを確認する。
	it("scores a guess and advances to the next round", async () => {
		const startResponse = await postJson("/api/game/start", {
			mapKey: "world-40k",
			rounds: 2,
			mode: "move",
			timeLimit: 30
		});
		const startData = await startResponse.json();

		const guessResponse = await postJson("/api/game/guess", {
			sessionId: startData.sessionId,
			guess: { lat: 35, lng: 135 },
			roundTime: 42,
			travelDistance: 1234
		});
		expect(guessResponse.status).toBe(200);

		const guessData = await guessResponse.json();
		expect(guessData.round).toBe(1);
		expect(guessData.score).toEqual(expect.any(Number));
		expect(guessData.totalScore).toEqual(expect.any(Number));
		expect(guessData.answer).toMatchObject({
			lat: expect.any(Number),
			lng: expect.any(Number)
		});
		expect(guessData.isLastRound).toBe(false);

		const nextResponse = await postJson("/api/game/next", {
			sessionId: startData.sessionId
		});
		expect(nextResponse.status).toBe(200);

		const nextData = await nextResponse.json();
		expect(nextData.round).toBe(2);
		expect(nextData.totalRounds).toBe(2);
		expect(nextData.pano).toMatchObject({
			heading: expect.any(Number),
			pitch: expect.any(Number),
			zoom: expect.any(Number)
		});
	});
});
