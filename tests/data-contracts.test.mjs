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

test("managed holdings seed preserves the requested 14-item order", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../managed-holdings.json", import.meta.url), "utf8"),
  );
  assert.equal(seed.holdings.length, 14);
  assert.deepEqual(
    seed.holdings.map((holding) => holding.name),
    [
      "TIME 미국나스닥100채권혼합50액티브",
      "RISE 삼성전자SK하이닉스채권혼합50",
      "KODEX 코스닥150",
      "KODEX 200미국채혼합50",
      "KODEX Top5 PlusTR",
      "RISE 네트워크인프라",
      "TIGER 미국필라델피아반도체나스닥",
      "HANARO Fn K-반도체",
      "TIGER 글로벌AI사이버보안",
      "PLUS 글로벌HBM반도체",
      "PLUS K방산",
      "TIME 글로벌AI인공지능액티브",
      "KODEX 미국AI전력핵심인프라",
      "KODEX AI전력핵심설비",
    ],
  );
  assert.deepEqual(
    seed.holdings.map((holding) => holding.sortOrder),
    Array.from({ length: 14 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    seed.holdings.map((holding) => holding.code),
    [
      "0019K0", "0162Z0", "229200", "284430", "315930", "367760", "381180",
      "395270", "418670", "442580", "449450", "456600", "487230", "487240",
    ],
  );
  assert.ok(seed.holdings.every((holding) => holding.tags.length >= 2));
});

test("holdings tab uses durable D1 CRUD instead of browser storage", async () => {
  const [
    htmlSource,
    clientSource,
    serverSource,
    workerSource,
    hostingSource,
    migrationSource,
    positionMigrationSource,
  ] =
    await Promise.all([
      readFile(new URL("../index.html", import.meta.url), "utf8"),
      readFile(new URL("../app.js", import.meta.url), "utf8"),
      readFile(new URL("../server.js", import.meta.url), "utf8"),
      readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
      readFile(
        new URL("../drizzle/0000_classy_pandemic.sql", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../drizzle/0001_many_spot.sql", import.meta.url), "utf8"),
    ]);
  assert.match(htmlSource, /id="holdingsTab"/);
  assert.match(htmlSource, /id="holdingsPanel"/);
  assert.match(htmlSource, /id="holdingsSearchForm"/);
  assert.match(htmlSource, /id="holdingsSearchResults"/);
  assert.doesNotMatch(htmlSource, /id="holdingsAddForm"/);
  assert.match(clientSource, /runManagedHoldingSearch/);
  assert.match(clientSource, /\/api\/stock-search\?q=.*scope=holdings/);
  assert.match(clientSource, /data-holding-name=/);
  assert.match(clientSource, /보유중/);
  assert.match(clientSource, /method: "POST"/);
  assert.match(clientSource, /method: "PATCH"/);
  assert.match(clientSource, /method: "DELETE"/);
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage/);
  assert.match(workerSource, /createManagedHoldingsStore\(env\?\.DB\)/);
  assert.match(workerSource, /includeDomesticSecurities/);
  assert.match(workerSource, /scope.*holdings/);
  assert.match(workerSource, /\/api\/holdings\/diagnostics/);
  assert.match(htmlSource, /조건부 퀀트 진단/);
  assert.match(htmlSource, /id="holdingsRotationRecommendation"/);
  assert.match(htmlSource, /모멘텀 40 · 추세\/위험 25 · 포트폴리오 적합도 25 · 유동성\/비용 10/);
  assert.match(clientSource, /renderHoldingsRotation/);
  assert.match(clientSource, /Quant \$\{formatHoldingScore/);
  assert.match(clientSource, /currentValueKrw/);
  assert.match(serverSource, /NAVER_STOCK_AUTOCOMPLETE/);
  assert.match(serverSource, /searchNaverDomesticSecurities/);
  assert.match(serverSource, /getHoldingsDiagnostics/);
  assert.equal(JSON.parse(hostingSource).d1, "DB");
  assert.equal(
    (migrationSource.match(/INSERT OR IGNORE INTO `managed_holdings`/g) || []).length,
    14,
  );
  assert.match(positionMigrationSource, /CREATE TABLE `holding_positions`/);
  assert.equal(
    (positionMigrationSource.match(/INSERT OR IGNORE INTO `holding_positions`/g) || []).length,
    14,
  );
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
  assert.match(clientSource, /회고 적중/);
  assert.match(clientSource, /compactPredictionSummary/);
  assert.match(clientSource, /신호 커버리지/);
  assert.match(clientSource, /전향 수집 중/);
  assert.doesNotMatch(clientSource, /고신뢰 검증 구간/);
  assert.match(htmlSource, /id="recommendationValidationBadge"/);
  assert.match(htmlSource, /id="recommendationValidationSample"/);
  assert.match(htmlSource, /id="recommendationValidationProspective"/);
  assert.match(htmlSource, /검증 기준 자세히/);
  assert.match(htmlSource, /id="indexValidationNote"/);
  assert.match(htmlSource, /검증 기준 보기/);
});
