import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createSitesRecommendationProgress,
  selectLatestRecommendationSnapshot,
  withSitesRecommendationMetadata,
} = require("../lib/sitesRecommendation.js");

test("latest bundled recommendation snapshot is selected", () => {
  const latest = selectLatestRecommendationSnapshot({
    older: { generatedAt: "2026-06-01T00:00:00.000Z", marketMonth: "2026-06" },
    latest: { generatedAt: "2026-08-13T00:00:00.000Z", marketMonth: "2026-08" },
  });
  assert.equal(latest.marketMonth, "2026-08");
});

test("Sites recommendation responses block runtime refresh without losing saved data", () => {
  const response = withSitesRecommendationMetadata(
    { generatedAt: "2026-08-13T00:00:00.000Z", results: [{ symbol: "TEST" }] },
    { refreshRequested: true },
  );
  assert.equal(response.refreshBlocked, true);
  assert.equal(response.refreshSupported, false);
  assert.equal(response.refreshMode, "bundled-snapshot");
  assert.equal(response.results[0].symbol, "TEST");
  assert.ok(Number.isFinite(Date.parse(response.servedAt)));
});

test("Sites progress never reports a job that cannot run", () => {
  const progress = createSitesRecommendationProgress("domestic");
  assert.equal(progress.state, "idle");
  assert.equal(progress.refreshSupported, false);
});

test("client fails safely when a refresh request is not started", async () => {
  const clientSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(clientSource, /startPayload\?\.refreshStarted !== true/);
  assert.match(clientSource, /startPayload\?\.refreshSupported === false/);
});
