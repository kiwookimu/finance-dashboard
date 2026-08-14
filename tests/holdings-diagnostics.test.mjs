import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  adjustCorporateActionRows,
  buildHoldingsDiagnostics,
  cappedNormalize,
  percentileRanks,
} = require("../lib/holdingsDiagnostics.js");

const PORTFOLIO = [
  ["0019K0", "TIME 미국나스닥100채권혼합50액티브"],
  ["0162Z0", "RISE 삼성전자SK하이닉스채권혼합50"],
  ["229200", "KODEX 코스닥150"],
  ["284430", "KODEX 200미국채혼합50"],
  ["315930", "KODEX Top5 PlusTR"],
  ["367760", "RISE 네트워크인프라"],
  ["381180", "TIGER 미국필라델피아반도체나스닥"],
  ["395270", "HANARO Fn K-반도체"],
  ["418670", "TIGER 글로벌AI사이버보안"],
  ["442580", "PLUS 글로벌HBM반도체"],
  ["449450", "PLUS K방산"],
  ["456600", "TIME 글로벌AI인공지능액티브"],
  ["487230", "KODEX 미국AI전력핵심인프라"],
  ["487240", "KODEX AI전력핵심설비"],
];

function priceHistory({ count = 300, dailyReturn = 0.0004, phase = 0 }) {
  const end = Date.parse("2026-08-14T00:00:00Z");
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    price *= 1 + dailyReturn + Math.sin(index / 9 + phase) * 0.0015;
    return {
      date: new Date(end - (count - index - 1) * 86400000).toISOString().slice(0, 10),
      close: price,
      volume: 500_000 + index * 1_000 + phase * 25_000,
    };
  });
}

function holdings({ amountReady = false } = {}) {
  return PORTFOLIO.map(([code, name], index) => ({
    id: `holding-${index + 1}`,
    name,
    code,
    currentValueKrw: amountReady ? (index + 1) * 1_000_000 : null,
    history: priceHistory({ dailyReturn: (index - 6) * 0.00022, phase: index }),
  }));
}

test("v2 diagnostics exposes a transparent 100-point factor model", () => {
  const result = buildHoldingsDiagnostics(holdings(), {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.equal(result.assessment, "conditional-risk-screen");
  assert.equal(result.modelVersion, "etf-quant-rotation-v2.0");
  assert.equal(result.weightMode, "equal_assumption");
  assert.equal(result.missingAmountCount, 14);
  assert.equal(result.items.length, 14);
  assert.deepEqual(result.methodology.factorWeights, {
    momentum: 40,
    trendRisk: 25,
    portfolioFit: 25,
    liquidityCost: 10,
  });
  assert.equal(result.dataCoverage.tradedValue, "connected");
  assert.equal(result.dataCoverage.expenseRatio, "missing-neutral-score");
  assert.ok(result.recoveryMode.maxPortfolioDrawdown1y <= result.recoveryMode.portfolioDrawdown);

  for (const item of result.items) {
    assert.ok(item.scores.momentum >= 0 && item.scores.momentum <= 40);
    assert.ok(item.scores.trendRisk >= 0 && item.scores.trendRisk <= 25);
    assert.ok(item.scores.portfolioFit >= 0 && item.scores.portfolioFit <= 25);
    assert.ok(item.scores.liquidityCost >= 0 && item.scores.liquidityCost <= 10);
    const factorSum = item.scores.momentum + item.scores.trendRisk +
      item.scores.portfolioFit + item.scores.liquidityCost;
    assert.ok(Math.abs(factorSum - item.quantScore) <= 0.25);
    assert.match(item.rating, /^[SABCD]$/);
    assert.equal(item.scores.detail.cost, 2);
  }
  assert.deepEqual(result.items.map((item) => item.rank), Array.from({ length: 14 }, (_, i) => i + 1));
});

test("target allocation respects product caps and reports portfolio exposure limits", () => {
  const result = buildHoldingsDiagnostics(holdings(), {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.ok(Math.abs(result.items.reduce((sum, item) => sum + item.targetWeight, 0) - 1) < 0.002);
  assert.ok(result.items.every((item) => item.targetWeight <= item.maxTargetWeight + 0.0001));
  assert.ok(Array.isArray(result.portfolioExposure.currentBreaches));
  assert.deepEqual(result.portfolioExposure.targetBreaches, []);
  assert.ok(result.items.every((item) => ["확대 후보", "유지", "축소 후보", "회전 후보"].includes(item.action)));
});

test("actual holding values activate current-weight and staged-rotation diagnostics", () => {
  const result = buildHoldingsDiagnostics(holdings({ amountReady: true }), {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  const first = result.items.find((item) => item.id === "holding-1");
  assert.equal(result.weightMode, "actual");
  assert.equal(result.totalAmountKrw, 105_000_000);
  assert.equal(result.missingAmountCount, 0);
  assert.equal(first.currentWeight, 0.0095);
  assert.ok(result.items.every((item) => item.actionCode !== "pending"));
  assert.ok(result.items.every((item) => item.bindingConstraint));
  assert.match(result.rotationRecommendation.status, /^(eligible|not-met)$/);
  if (result.rotationRecommendation.status === "eligible") {
    assert.ok(result.rotationRecommendation.scoreGap >= result.rotationRecommendation.scoreThreshold);
    assert.ok(result.rotationRecommendation.performanceGap >= result.rotationRecommendation.performanceThreshold);
    assert.equal(result.rotationRecommendation.firstStageFraction, 0.3);
    assert.ok(result.rotationRecommendation.estimatedAmountKrw > 0);
  }
});

test("short price history is explicitly held for more evidence", () => {
  const source = holdings();
  source[0].history = priceHistory({ count: 40 });
  const result = buildHoldingsDiagnostics(source, {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  const short = result.items.find((item) => item.id === "holding-1");
  assert.equal(short.actionCode, "pending");
  assert.equal(short.action, "판단 보류");
  assert.match(short.reasons[0], /최소 63일/);
  assert.equal(short.metrics.return63, null);
});

test("corporate-action discontinuities are adjusted before momentum is measured", () => {
  const rows = [
    { date: "2026-08-10", close: 100, volume: 1_000 },
    { date: "2026-08-11", close: 102, volume: 1_000 },
    { date: "2026-08-12", close: 51, volume: 2_000 },
    { date: "2026-08-13", close: 52, volume: 2_000 },
  ];
  const adjusted = adjustCorporateActionRows(rows);
  assert.equal(adjusted.adjustmentCount, 1);
  assert.deepEqual(adjusted.rows.map((row) => row.close), [50, 51, 51, 52]);
});

test("percentile ranks keep missing horizons neutral", () => {
  assert.deepEqual(percentileRanks([1, 2, null]), [0, 1, 0.5]);
});

test("risk-budget normalization supports per-product caps and sums to one", () => {
  const weights = cappedNormalize([10, ...Array(13).fill(1)], [0.08, ...Array(13).fill(0.15)]);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-10);
  assert.ok(weights[0] <= 0.0800001);
  assert.ok(Math.max(...weights.slice(1)) <= 0.1500001);
});
