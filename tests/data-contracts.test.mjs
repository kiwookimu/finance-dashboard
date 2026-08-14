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
const { summarizeIndexValidation } = require("../lib/indexValidation.js");
const {
  summarizeRecommendationValidation,
} = require("../lib/recommendationValidation.js");

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

test("recommendation performance is labeled retrospective and excludes current fundamentals", async () => {
  const [backtest, ledger] = await Promise.all([
    readFile(
      new URL(
        "../screen_results/backtest_monthly_recommendations_both_2025-01_2026-05.json",
        import.meta.url,
      ),
      "utf8",
    ).then(JSON.parse),
    readFile(
      new URL("../validation/recommendation-forward-validation.json", import.meta.url),
      "utf8",
    ).then(JSON.parse),
  ]);
  const validation = summarizeRecommendationValidation(backtest, ledger);
  assert.equal(validation.independentPerformanceReady, false);
  assert.equal(validation.retrospective.status, "retrospective-only");
  assert.equal(validation.retrospective.metrics.sample, 110);
  assert.equal(validation.retrospective.metrics.medianReturn, 1.85);
  assert.equal(validation.retrospective.timeSlices[0].metrics.hitRate, 42.4);
  assert.equal(validation.retrospective.timeSlices[1].metrics.hitRate, 62.7);
  assert.equal(validation.dataQuality.fundamentalsIncludedInHistoricalPerformance, false);
  assert.equal(validation.prospective.startMonth, "2026-09");
  assert.equal(validation.prospective.performanceReady, false);
});

test("index validation reports yearly stability instead of only an aggregate hit rate", async () => {
  const backtest = JSON.parse(
    await readFile(
      new URL(
        "../screen_results/backtest_index_predictions_2023-01-01_2026-06-20.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validation = summarizeIndexValidation(backtest.rows);
  assert.equal(validation.assessment, "retrospective-only");
  assert.equal(validation.yearly.length, 4);
  assert.equal(validation.worstYearHitRate, 69.5);
  assert.equal(validation.byIndex.kospi.worstYearHitRate, 67.5);
  assert.equal(validation.yearly.at(-1).isPartial, true);
});

test("validation UI distinguishes retrospective results from prospective collection", async () => {
  const [clientSource, htmlSource] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(clientSource, /회고검증/);
  assert.match(clientSource, /전향 검증 수집 중/);
  assert.doesNotMatch(clientSource, /고신뢰 검증 구간/);
  assert.match(htmlSource, /id="recommendationValidationBadge"/);
  assert.match(htmlSource, /id="indexValidationNote"/);
});
