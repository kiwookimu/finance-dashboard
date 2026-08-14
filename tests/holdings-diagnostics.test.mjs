import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  buildHoldingsDiagnostics,
  cappedNormalize,
} = require("../lib/holdingsDiagnostics.js");

function priceHistory({ count = 300, dailyReturn = 0.0004, phase = 0 }) {
  const end = Date.parse("2026-08-14T00:00:00Z");
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    price *= 1 + dailyReturn + Math.sin(index / 9 + phase) * 0.0015;
    return {
      date: new Date(end - (count - index - 1) * 86400000).toISOString().slice(0, 10),
      close: price,
    };
  });
}

function holdings({ amountReady = false } = {}) {
  return Array.from({ length: 14 }, (_, index) => ({
    id: `holding-${index + 1}`,
    name: `테스트 ETF ${index + 1}`,
    code: String(100000 + index),
    currentValueKrw: amountReady ? (index + 1) * 1_000_000 : null,
    tags: index < 5 ? ["semi", "korea"] : ["broad", "korea"],
    history: priceHistory({ dailyReturn: (index - 6) * 0.00012, phase: index }),
  }));
}

test("conditional holding diagnostics uses equal weights until every amount is present", () => {
  const result = buildHoldingsDiagnostics(holdings(), {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.equal(result.assessment, "conditional-risk-screen");
  assert.equal(result.weightMode, "equal_assumption");
  assert.equal(result.missingAmountCount, 14);
  assert.equal(result.items.length, 14);
  assert.ok(Math.abs(result.items.reduce((sum, item) => sum + item.targetWeight, 0) - 1) < 0.002);
  assert.ok(result.items.every((item) => item.targetWeight <= 0.1501));
  assert.ok(result.items.every((item) => ["확대 후보", "유지", "축소 후보"].includes(item.action)));
});

test("actual holding values activate current-weight diagnostics", () => {
  const result = buildHoldingsDiagnostics(holdings({ amountReady: true }), {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.equal(result.weightMode, "actual");
  assert.equal(result.totalAmountKrw, 105_000_000);
  assert.equal(result.missingAmountCount, 0);
  assert.equal(result.items[0].currentWeight, 0.0095);
  assert.ok(result.items.every((item) => item.actionCode !== "pending"));
  assert.ok(result.items.every((item) => item.bindingConstraint));
});

test("short price history is explicitly held for more evidence", () => {
  const source = holdings();
  source[0].history = priceHistory({ count: 40 });
  const result = buildHoldingsDiagnostics(source, {
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.equal(result.items[0].actionCode, "pending");
  assert.equal(result.items[0].action, "판단 보류");
  assert.match(result.items[0].reasons[0], /최소 63일/);
});

test("risk-budget normalization respects the target cap and sums to one", () => {
  const weights = cappedNormalize([10, ...Array(13).fill(1)], 0.15);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-10);
  assert.ok(Math.max(...weights) <= 0.1500001);
});
