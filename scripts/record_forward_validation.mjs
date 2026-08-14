import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { recommendationCriteriaHash, loadRecommendationCriteria } = require(
  "../lib/recommendationCriteria.js",
);
const { completedSessionCutoffDate } = require("../lib/marketDataPolicy.js");

const LEDGER_PATH = "validation/recommendation-forward-validation.json";
const criteriaHash = recommendationCriteriaHash(loadRecommendationCriteria());
const ledger = JSON.parse(await readFile(LEDGER_PATH, "utf8"));

if (ledger.policy?.criteriaHash !== criteriaHash) {
  throw new Error(
    `Validation policy is frozen to ${ledger.policy?.criteriaHash}; current criteria are ${criteriaHash}. Create a new versioned policy before recording signals.`,
  );
}

const files = (await readdir("screen_results"))
  .filter((file) => /^(?:kr|us)_monthly_breakout_.*\.json$/.test(file))
  .sort();
const snapshots = await Promise.all(
  files.map(async (file) => ({
    file,
    payload: JSON.parse(await readFile(`screen_results/${file}`, "utf8")),
  })),
);

for (const { file, payload } of snapshots) {
  const market = file.startsWith("kr_") ? "domestic" : "us";
  if (payload.marketMonth < ledger.policy.startMonth) continue;
  if (payload.criteriaHash !== ledger.policy.criteriaHash) continue;
  if (Date.parse(payload.generatedAt || "") < Date.parse(ledger.policy.frozenAt)) continue;

  const cohortId = [market, payload.marketMonth, payload.criteriaHash].join(":");
  const previous = ledger.cohorts.find((cohort) => cohort.id === cohortId);
  const previousBySignal = new Map(
    (previous?.signals || []).map((signal) => [signalKey(signal), signal]),
  );
  const cohort = {
    criteriaHash: payload.criteriaHash,
    dataAsOf: payload.dataAsOf,
    id: cohortId,
    market,
    marketMonth: payload.marketMonth,
    recordedAt: new Date().toISOString(),
    screenVersion: payload.screenVersion,
    snapshotGeneratedAt: payload.generatedAt,
    signals: (payload.results || []).map((item) => {
      const signal = {
        benchmark: item.benchmark || payload.benchmark || "",
        code: item.code || "",
        marketType: item.marketType || market,
        name: item.name || item.symbol,
        signalClose: finiteOrNull(item.lastClose),
        signalDate: item.lastDate || payload.dataAsOf,
        stage: item.recommendationStage,
        symbol: item.symbol,
        technicalStage: item.technicalRecommendationStage || item.recommendationStage,
      };
      const stored = previousBySignal.get(signalKey(signal));
      return stored?.outcome ? { ...signal, outcome: stored.outcome } : signal;
    }),
  };
  ledger.cohorts = ledger.cohorts.filter((item) => item.id !== cohortId);
  ledger.cohorts.push(cohort);
}

ledger.cohorts.sort(
  (left, right) =>
    left.marketMonth.localeCompare(right.marketMonth) ||
    left.market.localeCompare(right.market),
);
if (process.env.VALIDATION_SETTLE !== "0") {
  await settleMatureOutcomes(ledger.cohorts);
}
await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      cohorts: ledger.cohorts.length,
      criteriaHash,
      maturedSignals: ledger.cohorts
        .flatMap((cohort) => cohort.signals)
        .filter((signal) => Number.isFinite(signal.outcome?.return1m)).length,
      signals: ledger.cohorts.flatMap((cohort) => cohort.signals).length,
      startMonth: ledger.policy.startMonth,
    },
    null,
    2,
  ),
);

function signalKey(signal) {
  return `${signal.symbol}:${signal.signalDate}`;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function settleMatureOutcomes(cohorts) {
  const historyCache = new Map();
  for (const cohort of cohorts) {
    const cutoffDate = completedSessionCutoffDate({
      completionHour: cohort.market === "domestic" ? 16 : 17,
      now: new Date(),
      timeZone: cohort.market === "domestic" ? "Asia/Seoul" : "America/New_York",
    });
    for (const signal of cohort.signals || []) {
      if (Number.isFinite(signal.outcome?.return1m)) continue;
      const assetRows = await cachedHistory(historyCache, signal.symbol, signal.signalDate, cutoffDate);
      const signalIndex = assetRows.findIndex((row) => row.date === signal.signalDate);
      const outcomeRow = assetRows[signalIndex + Number(ledger.policy.horizonTradingDays || 21)];
      if (signalIndex < 0 || !outcomeRow || outcomeRow.date > cutoffDate) continue;
      const benchmarkSymbol = benchmarkYahooSymbol(signal, cohort.market);
      const benchmarkRows = await cachedHistory(
        historyCache,
        benchmarkSymbol,
        signal.signalDate,
        outcomeRow.date,
      );
      const benchmarkStart = benchmarkRows.find((row) => row.date === signal.signalDate);
      const benchmarkEnd = benchmarkRows.find((row) => row.date === outcomeRow.date);
      if (!benchmarkStart || !benchmarkEnd) continue;
      const signalClose = Number(signal.signalClose) || assetRows[signalIndex].close;
      const return1m = percentChange(outcomeRow.close, signalClose);
      const benchmarkReturn1m = percentChange(benchmarkEnd.close, benchmarkStart.close);
      signal.outcome = {
        benchmarkReturn1m: round(benchmarkReturn1m, 2),
        dataAsOf: outcomeRow.date,
        return1m: round(return1m, 2),
        return1mExcess: round(return1m - benchmarkReturn1m, 2),
      };
    }
  }
}

async function cachedHistory(cache, symbol, startDate, endDate) {
  const key = `${symbol}:${startDate}:${endDate}`;
  if (!cache.has(key)) cache.set(key, fetchYahooDaily(symbol, startDate, endDate));
  return cache.get(key);
}

async function fetchYahooDaily(symbol, startDate, endDate) {
  const period1 = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(
    new Date(`${shiftDate(endDate, 3)}T23:59:59Z`).getTime() / 1000,
  );
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?period1=${period1}&period2=${period2}&interval=1d`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) return [];
  const json = await response.json();
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp?.length || !quote) return [];
  return result.timestamp
    .map((timestamp, index) => ({
      close: Number(quote.close?.[index]),
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function benchmarkYahooSymbol(signal, market) {
  if (market === "us") return "QQQ";
  return String(signal.benchmark).toUpperCase().includes("KOSDAQ") ? "^KQ11" : "^KS11";
}

function percentChange(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
    ? ((current - previous) / previous) * 100
    : NaN;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function shiftDate(date, offset) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}
