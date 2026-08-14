import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  completedSessionCutoffDate,
  exactDateIndex,
  latestDateInMonthAtOrBefore,
  rowsAtOrBefore,
} = require("../lib/marketDataPolicy.js");
const { getPortfolioConfig } = require("../lib/portfolioConfig.js");
const {
  pickWidestDatedFile,
  wilsonPercentInterval,
} = require("../lib/backtestSummary.js");

test("Korean recommendation cutoff excludes an unfinished trading session", () => {
  assert.equal(
    completedSessionCutoffDate({
      completionHour: 16,
      now: new Date("2026-08-14T00:30:00.000Z"),
      timeZone: "Asia/Seoul",
    }),
    "2026-08-13",
  );
  assert.equal(
    completedSessionCutoffDate({
      completionHour: 16,
      now: new Date("2026-08-14T07:01:00.000Z"),
      timeZone: "Asia/Seoul",
    }),
    "2026-08-14",
  );
});

test("US recommendation cutoff follows New York market time", () => {
  assert.equal(
    completedSessionCutoffDate({
      completionHour: 17,
      now: new Date("2026-08-14T00:30:00.000Z"),
      timeZone: "America/New_York",
    }),
    "2026-08-13",
  );
});

test("candidate and benchmark rows use the same completed date", () => {
  const rows = [
    { date: "2026-08-12" },
    { date: "2026-08-13" },
    { date: "2026-08-14" },
  ];
  assert.equal(
    latestDateInMonthAtOrBefore(rows, "2026-08", "2026-08-13"),
    "2026-08-13",
  );
  assert.equal(exactDateIndex(rows, "2026-08-13"), 1);
  assert.deepEqual(rowsAtOrBefore(rows, "2026-08-13"), rows.slice(0, 2));
});

test("backtest summary selects the widest validation range", () => {
  const files = [
    "backtest_index_predictions_2025-06-20_2026-06-20.json",
    "backtest_index_predictions_2023-01-01_2026-06-20.json",
  ];
  assert.equal(
    pickWidestDatedFile(
      files,
      /^backtest_index_predictions_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/,
    ),
    files[1],
  );
});

test("backtest hit rate exposes a bounded Wilson confidence interval", () => {
  const interval = wilsonPercentInterval(72.3, 501);
  assert.ok(interval.lower < 72.3);
  assert.ok(interval.upper > 72.3);
  assert.ok(interval.lower >= 0);
  assert.ok(interval.upper <= 100);
});

test("portfolio configuration is canonical and traceable", () => {
  const portfolio = getPortfolioConfig();
  assert.equal(portfolio.holdings.length, 12);
  assert.equal(portfolio.investedCount, 10);
  assert.equal(portfolio.totalAmount, 155173704);
  assert.match(portfolio.portfolioHash, /^sha256:[a-f0-9]{64}$/);
});

test("client loads portfolio holdings from the API", async () => {
  const clientSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(clientSource, /\/api\/portfolio-config/);
  assert.doesNotMatch(clientSource, /const PORTFOLIO_HOLDINGS = \[/);
});
