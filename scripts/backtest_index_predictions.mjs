import { mkdir, writeFile } from "node:fs/promises";

const START_DATE = process.argv[2] || "2023-01-01";
const END_DATE = process.argv[3] || new Date().toISOString().slice(0, 10);
const MIN_HIT_RATE = Number(process.argv[4] || process.env.INDEX_BACKTEST_MIN_HIT_RATE || 70);
const MIN_COVERAGE = Number(process.argv[5] || process.env.INDEX_BACKTEST_MIN_COVERAGE || 10);
const TREND_POINTS = 28;
const ANALYSIS_POINTS = 260;

const TARGETS = [
  { id: "kospi", label: "KOSPI", market: "korea", profile: "broad" },
  { id: "kosdaq", label: "KOSDAQ", market: "korea", profile: "growth" },
  { id: "nasdaq", label: "NASDAQ", market: "us", profile: "growth" },
  { id: "sp500", label: "S&P 500", market: "us", profile: "broad" },
];

const MARKET_SOURCES = [
  { id: "kospi", symbol: "^KS11" },
  { id: "kosdaq", symbol: "^KQ11" },
  { id: "sp500", symbol: "^GSPC" },
  { id: "nasdaq", symbol: "^IXIC" },
  { id: "sox", symbol: "^SOX" },
  { id: "nikkei", symbol: "^N225" },
  { id: "nasdaqFutures", symbol: "NQ=F" },
  { id: "sp500Futures", symbol: "ES=F" },
  { id: "qqq", symbol: "QQQ" },
  { id: "qqqe", symbol: "QQQE" },
  { id: "spy", symbol: "SPY" },
  { id: "rsp", symbol: "RSP" },
  { id: "smh", symbol: "SMH" },
  { id: "vix3m", symbol: "^VIX3M" },
  { id: "nvda", symbol: "NVDA" },
  { id: "avgo", symbol: "AVGO" },
  { id: "amd", symbol: "AMD" },
  { id: "mu", symbol: "MU" },
  { id: "tsm", symbol: "TSM" },
  { id: "asml", symbol: "ASML" },
  { id: "qcom", symbol: "QCOM" },
  { id: "usdKrw", symbol: "KRW=X" },
  { id: "wti", symbol: "CL=F" },
  { id: "us10y", symbol: "^TNX" },
];

const SEMI_LEADER_IDS = ["nvda", "avgo", "amd", "mu", "tsm", "asml", "qcom"];
const FRED_SOURCES = [
  { id: "hySpread", seriesId: "BAMLH0A0HYM2" },
  { id: "nfci", seriesId: "NFCI" },
];
const SENTIMENT_SOURCES = {
  fearGreed:
    "https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv",
  vix: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
};

const fetchStartDate = shiftDate(START_DATE, -430);
const fetchEndDate = shiftDate(END_DATE, 8);

console.error(`fetching index backtest data ${fetchStartDate}..${fetchEndDate}`);
const [marketHistories, fredHistories, sentiment] = await Promise.all([
  fetchMarketHistories(),
  fetchFredHistories(),
  fetchSentimentHistories(),
]);

const rows = TARGETS.flatMap((target) =>
  runTargetBacktest(target, marketHistories, fredHistories, sentiment),
);
const summary = summarizeRows(rows);
const outStem = `screen_results/backtest_index_predictions_${START_DATE}_${END_DATE}`;
await mkdir("screen_results", { recursive: true });
await writeFile(
  `${outStem}.json`,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      range: {
        endDate: END_DATE,
        fetchEndDate,
        fetchStartDate,
        minCoverage: MIN_COVERAGE,
        targetHitRate: MIN_HIT_RATE,
        startDate: START_DATE,
      },
      summary,
      rows,
    },
    null,
    2,
  )}\n`,
);
await writeFile(`${outStem}.csv`, toCsv(rows));
printSummary(summary, outStem);

async function fetchMarketHistories() {
  const entries = await Promise.all(
    MARKET_SOURCES.map(async (source) => [
      source.id,
      await fetchYahooDaily(source.symbol, fetchStartDate, fetchEndDate),
    ]),
  );
  return Object.fromEntries(entries);
}

async function fetchFredHistories() {
  const entries = await Promise.all(
    FRED_SOURCES.map(async (source) => [
      source.id,
      await fetchFredDaily(source.seriesId),
    ]),
  );
  return Object.fromEntries(entries);
}

async function fetchSentimentHistories() {
  const [fearGreedCsv, vixCsv] = await Promise.all([
    fetchText(SENTIMENT_SOURCES.fearGreed),
    fetchText(SENTIMENT_SOURCES.vix),
  ]);
  return {
    fearGreed: parseFearGreed(fearGreedCsv),
    vix: parseVix(vixCsv),
  };
}

async function fetchYahooDaily(symbol, startDate, endDate) {
  const period1 = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson(url);
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp?.length || !quote) {
    throw new Error(`Yahoo history unavailable: ${symbol}`);
  }

  return result.timestamp
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      value: finiteNumber(quote.close?.[index]),
    }))
    .filter((row) => row.date && Number.isFinite(row.value) && row.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFredDaily(seriesId) {
  const rows = parseCsv(
    await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`),
  )
    .map((row) => ({
      date: row.observation_date,
      value: Number.parseFloat(row[seriesId]),
    }))
    .filter((row) => row.date && Number.isFinite(row.value));
  if (!rows.length) throw new Error(`FRED history unavailable: ${seriesId}`);
  return rows;
}

function parseFearGreed(csv) {
  return parseCsv(csv)
    .map((row) => ({
      date: row.Date,
      rating: row.Rating || "",
      value: Number.parseFloat(row["Fear Greed"]),
    }))
    .filter((row) => row.date && Number.isFinite(row.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseVix(csv) {
  return parseCsv(csv)
    .map((row) => ({
      date: toIsoDate(row.DATE),
      value: Number.parseFloat(row.CLOSE),
    }))
    .filter((row) => row.date && Number.isFinite(row.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function runTargetBacktest(target, marketHistories, fredHistories, sentiment) {
  const history = marketHistories[target.id] || [];
  const rows = [];
  for (let index = 0; index < history.length - 1; index += 1) {
    const current = history[index];
    const next = history[index + 1];
    if (!current?.date || current.date < START_DATE || current.date > END_DATE) continue;
    if (!next?.value || !current.value) continue;

    const quotes = buildQuotesAsOf(current.date, marketHistories, fredHistories);
    const sentimentAsOf = buildSentimentAsOf(current.date, sentiment);
    const prediction = evaluateNextDayIndexPrediction(target, quotes, sentimentAsOf);
    if (!prediction) continue;

    const nextDayReturn = ((next.value - current.value) / current.value) * 100;
    const actualDirection = nextDayReturn >= 0 ? "상승" : "하락";
    const hit = prediction.direction === actualDirection;
    rows.push({
      actualDirection,
      components: Object.fromEntries(
        prediction.components.map((item) => [item.label, round(item.score, 4)]),
      ),
      date: current.date,
      direction: prediction.direction,
      hit: hit ? 1 : 0,
      indexId: target.id,
      label: target.label,
      nextDate: next.date,
      nextDayReturn: round(nextDayReturn, 4),
      score: round(prediction.score, 4),
      strength: round(Math.abs(prediction.score), 4),
      summary: prediction.summary,
    });
  }
  return rows;
}

function buildQuotesAsOf(date, marketHistories, fredHistories) {
  const quote = (id, histories = marketHistories) =>
    buildQuoteFromHistory(historyAsOf(histories[id] || [], date));
  const qqq = quote("qqq");
  const qqqe = quote("qqqe");
  const spy = quote("spy");
  const rsp = quote("rsp");
  const smh = quote("smh");
  const semiLeaderHistories = Object.fromEntries(
    SEMI_LEADER_IDS.map((id) => [id, historyAsOf(marketHistories[id] || [], date)]),
  );
  return {
    hySpread: quote("hySpread", fredHistories),
    kosdaq: quote("kosdaq"),
    kospi: quote("kospi"),
    nasdaq: quote("nasdaq"),
    nasdaqBreadth: buildRelativeStrengthQuoteFromQuotes(qqqe, qqq),
    nasdaqFutures: quote("nasdaqFutures"),
    nfci: quote("nfci", fredHistories),
    nikkei: quote("nikkei"),
    semiBreadth: buildMovingAverageBreadthQuoteFromHistories(semiLeaderHistories, 50),
    semiLeadership: buildRelativeStrengthQuoteFromQuotes(smh, qqq),
    sox: quote("sox"),
    sp500: quote("sp500"),
    sp500Breadth: buildRelativeStrengthQuoteFromQuotes(rsp, spy),
    sp500Futures: quote("sp500Futures"),
    us10y: quote("us10y"),
    usdKrw: quote("usdKrw"),
    vix3m: quote("vix3m"),
    wti: quote("wti"),
  };
}

function buildQuoteFromHistory(rows) {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  if (!latest) return null;
  const change = previous ? latest.value - previous.value : 0;
  return {
    analysisHistory: rows.slice(-ANALYSIS_POINTS),
    change,
    changePercent: previous?.value ? (change / previous.value) * 100 : 0,
    history: rows.slice(-TREND_POINTS),
    price: latest.value,
  };
}

function buildRelativeStrengthQuoteFromQuotes(numerator, denominator) {
  const ratioSeries = buildRatioSeries(
    numerator?.analysisHistory || [],
    denominator?.analysisHistory || [],
  );
  const history = ratioSeries.slice(-TREND_POINTS);
  const trend = trendPercent(history);
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!latest || !Number.isFinite(trend)) return null;
  return {
    analysisHistory: ratioSeries.slice(-ANALYSIS_POINTS),
    change: previous ? latest.value - previous.value : 0,
    changePercent: Number(numerator?.changePercent) - Number(denominator?.changePercent),
    history,
    price: trend,
  };
}

function buildRatioSeries(numeratorRows, denominatorRows) {
  const denominatorByDate = new Map(
    denominatorRows.map((row) => [row.date, Number(row.value)]),
  );
  return numeratorRows
    .map((row) => {
      const numeratorValue = Number(row.value);
      const denominatorValue = denominatorByDate.get(row.date);
      if (
        !Number.isFinite(numeratorValue) ||
        !Number.isFinite(denominatorValue) ||
        denominatorValue <= 0
      ) {
        return null;
      }
      return {
        date: row.date,
        value: (numeratorValue / denominatorValue) * 100,
      };
    })
    .filter(Boolean);
}

function buildMovingAverageBreadthQuoteFromHistories(historiesById, period) {
  const series = buildMovingAverageBreadthSeries(historiesById, period);
  const history = series.slice(-TREND_POINTS);
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!latest) return null;
  return {
    analysisHistory: series.slice(-ANALYSIS_POINTS),
    change: previous ? latest.value - previous.value : 0,
    changePercent: previous ? latest.value - previous.value : 0,
    history,
    price: latest.value,
  };
}

function buildMovingAverageBreadthSeries(historiesById, period) {
  const breadthByDate = new Map();
  for (const rows of Object.values(historiesById)) {
    for (let index = period - 1; index < rows.length; index += 1) {
      const date = rows[index].date;
      const price = Number(rows[index].value);
      const ma = average(
        rows.slice(index - period + 1, index + 1).map((row) => Number(row.value)),
      );
      if (!date || !Number.isFinite(price) || !Number.isFinite(ma)) continue;
      const item = breadthByDate.get(date) || { above: 0, total: 0 };
      item.total += 1;
      if (price > ma) item.above += 1;
      breadthByDate.set(date, item);
    }
  }

  return [...breadthByDate.entries()]
    .map(([date, item]) => ({
      date,
      value: item.total ? (item.above / item.total) * 100 : NaN,
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildSentimentAsOf(date, sentiment) {
  const fearRows = historyAsOf(sentiment.fearGreed, date);
  const vixRows = historyAsOf(sentiment.vix, date);
  const fear = fearRows.at(-1);
  const fearPrev = fearRows.at(-2);
  const vix = vixRows.at(-1);
  const vixPrev = vixRows.at(-2);
  return {
    fearGreed: fear
      ? {
          change: fearPrev ? fear.value - fearPrev.value : 0,
          rating: fear.rating || "",
          score: fear.value,
          series: fearRows.slice(-TREND_POINTS),
        }
      : null,
    vix: vix
      ? {
          change: vixPrev ? vix.value - vixPrev.value : 0,
          close: vix.value,
          series: vixRows.slice(-TREND_POINTS),
        }
      : null,
  };
}

function evaluateNextDayIndexPrediction(target, quotes, sentiment) {
  const quote = quotes?.[target.id];
  if (!quote || !Number.isFinite(Number(quote.price))) return null;

  const components = [];
  const add = (label, score, weight) => {
    if (!Number.isFinite(score)) return;
    const cleanScore = clamp(score, -1, 1);
    components.push({ label, score: cleanScore, weight, weighted: cleanScore * weight });
  };

  add("당일", scoreOneDayMove(quote), 1);
  add("5일", scoreShortMomentum(quote, 5, target.profile === "growth" ? 3.4 : 2.8), 0.75);
  add("20일", scoreShortMomentum(quote, 20, target.profile === "growth" ? 7 : 5.5), 0.6);
  add("추세", scoreRiskAsset(quote), 0.65);
  add("VIX", scoreVix(sentiment?.vix), target.profile === "growth" ? 0.9 : 0.7);
  add("VIX구조", scoreVixTermStructure(quotes?.vix3m, sentiment?.vix), 0.45);
  add("공포탐욕", scoreFearGreed(sentiment?.fearGreed), 0.35);
  add("금리", scoreYield(quotes?.us10y), target.profile === "growth" ? 0.7 : 0.45);

  if (target.market === "korea") {
    add("나스닥선물", scoreFutureMove(quotes?.nasdaqFutures?.changePercent), 0.9);
    add("S&P선물", scoreFutureMove(quotes?.sp500Futures?.changePercent), 0.6);
    add("니케이", scoreOneDayMove(quotes?.nikkei), 0.7);
    add("달러원", scoreUsdKrw(quotes?.usdKrw), 0.65);
    add("유가", scoreWti(quotes?.wti), 0.25);
    add("미국장", average([
      scoreOneDayMove(quotes?.nasdaq),
      scoreOneDayMove(quotes?.sp500),
    ]), 0.45);
    if (target.profile === "growth") {
      add("반도체", scoreSemiconductorCycle(quotes), 0.65);
      add("나스닥폭", scoreRelativeBreadth(quotes?.nasdaqBreadth), 0.45);
    }
  } else {
    add(
      target.id === "nasdaq" ? "나스닥선물" : "S&P선물",
      scoreFutureMove(
        target.id === "nasdaq"
          ? quotes?.nasdaqFutures?.changePercent
          : quotes?.sp500Futures?.changePercent,
      ),
      1.3,
    );
    add(
      target.id === "nasdaq" ? "나스닥폭" : "S&P폭",
      scoreRelativeBreadth(target.id === "nasdaq" ? quotes?.nasdaqBreadth : quotes?.sp500Breadth),
      0.8,
    );
    add("시장레짐", scoreMarketRegime(quotes), 0.55);
    if (target.id === "nasdaq") {
      add("반도체", scoreSemiconductorCycle(quotes), 0.65);
    } else {
      add("동일가중", scoreRelativeBreadth(quotes?.sp500Breadth), 0.55);
    }
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return null;
  const score =
    components.reduce((sum, item) => sum + item.weighted, 0) / totalWeight;
  const direction = score >= 0 ? "상승" : "하락";
  const summary = summarizeIndexPrediction(components, direction);
  return { components, direction, label: target.label, score, summary };
}

function summarizeRows(rows) {
  const byIndex = Object.fromEntries(
    TARGETS.map((target) => {
      const targetRows = rows.filter((row) => row.indexId === target.id);
      return [target.id, summarizeSubset(targetRows)];
    }),
  );
  return {
    all: summarizeSubset(rows),
    byIndex,
    highConfidenceRules: summarizeHighConfidenceRules(rows),
    tunedByIndex: Object.fromEntries(
      TARGETS.map((target) => {
        const targetRows = rows.filter((row) => row.indexId === target.id);
        return [target.id, chooseThreshold(targetRows)];
      }),
    ),
    tunedCombined: chooseThreshold(rows),
  };
}

function summarizeHighConfidenceRules(rows) {
  const ruleRows = TARGETS.map((target) => {
    const targetRows = rows.filter((row) => row.indexId === target.id);
    const signals = targetRows
      .map((row) => ({
        direction: highConfidenceDirection(row),
        row,
      }))
      .filter((item) => item.direction);
    return {
      coverage: rate(signals.length, targetRows.length),
      hitRate: rate(
        signals.filter((item) => item.direction === item.row.actualDirection).length,
        signals.length,
      ),
      indexId: target.id,
      observations: signals.length,
    };
  });
  const allSignals = rows
    .map((row) => ({
      direction: highConfidenceDirection(row),
      row,
    }))
    .filter((item) => item.direction);
  return {
    all: {
      coverage: rate(allSignals.length, rows.length),
      hitRate: rate(
        allSignals.filter((item) => item.direction === item.row.actualDirection).length,
        allSignals.length,
      ),
      observations: allSignals.length,
    },
    byIndex: Object.fromEntries(ruleRows.map((row) => [row.indexId, row])),
    rules: [
      "KOSPI: 미국장 점수 >= 0.45 상승, S&P선물 점수 <= -0.8 하락",
      "KOSDAQ: 미국장 점수 > 0.45 상승, 유가 점수 <= -0.4 하락",
      "NASDAQ/S&P 500: VIX 기간구조 점수 >= 0.35 상승, <= 0 하락",
    ],
  };
}

function highConfidenceDirection(row) {
  const components = row.components || {};
  const usMarket = Number(components["미국장"]);
  const spFuture = Number(components["S&P선물"]);
  const wti = Number(components["유가"]);
  const vixTerm = Number(components["VIX구조"]);

  if (row.indexId === "kospi") {
    if (usMarket >= 0.45) return "상승";
    if (spFuture <= -0.8) return "하락";
  }
  if (row.indexId === "kosdaq") {
    if (usMarket > 0.45) return "상승";
    if (wti <= -0.4) return "하락";
  }
  if (row.indexId === "nasdaq" || row.indexId === "sp500") {
    if (vixTerm >= 0.35) return "상승";
    if (vixTerm <= 0) return "하락";
  }
  return null;
}

function summarizeSubset(rows) {
  const hits = rows.filter((row) => row.hit).length;
  return {
    avgNextDayReturn: round(average(rows.map((row) => row.nextDayReturn)), 3),
    downCount: rows.filter((row) => row.direction === "하락").length,
    downHitRate: hitRate(rows.filter((row) => row.direction === "하락")),
    hitRate: hitRate(rows),
    observations: rows.length,
    upCount: rows.filter((row) => row.direction === "상승").length,
    upHitRate: hitRate(rows.filter((row) => row.direction === "상승")),
  };
}

function chooseThreshold(rows) {
  const candidates = [];
  for (let threshold = 0; threshold <= 0.8; threshold += 0.01) {
    const signals = rows.filter((row) => row.strength >= round(threshold, 2));
    const coverage = rate(signals.length, rows.length);
    candidates.push({
      avgNextDayReturn: round(average(signals.map((row) => row.nextDayReturn)), 3),
      count: signals.length,
      coverage,
      downHitRate: hitRate(signals.filter((row) => row.direction === "하락")),
      hitRate: hitRate(signals),
      threshold: round(threshold, 2),
      upHitRate: hitRate(signals.filter((row) => row.direction === "상승")),
    });
  }
  const viable = candidates
    .filter((item) => item.coverage >= MIN_COVERAGE && item.hitRate >= MIN_HIT_RATE)
    .sort((a, b) => b.coverage - a.coverage || a.threshold - b.threshold);
  const best = candidates
    .filter((item) => item.coverage >= MIN_COVERAGE)
    .sort((a, b) => b.hitRate - a.hitRate || b.coverage - a.coverage)[0];
  return {
    bestCoverageAtTarget: viable[0] || null,
    bestHitRate: best || null,
    targetHitRate: MIN_HIT_RATE,
  };
}

function hitRate(rows) {
  return rate(rows.filter((row) => row.hit).length, rows.length);
}

function scoreOneDayMove(quote) {
  const change = Number(quote?.changePercent);
  if (!Number.isFinite(change)) return NaN;
  if (change >= 1.2) return 0.8;
  if (change >= 0.45) return 0.45;
  if (change > -0.35) return 0.08;
  if (change > -1) return -0.4;
  return -0.8;
}

function scoreFutureMove(changePercent) {
  const change = Number(changePercent);
  if (!Number.isFinite(change)) return NaN;
  if (change >= 1) return 0.9;
  if (change >= 0.45) return 0.55;
  if (change > -0.25) return 0.08;
  if (change > -0.75) return -0.45;
  return -0.85;
}

function scoreShortMomentum(quote, days, threshold) {
  const trend = trendPercentOverPeriod(quote?.analysisHistory || quote?.history, days);
  if (!Number.isFinite(trend)) return NaN;
  return clamp(trend / threshold, -1, 1);
}

function summarizeIndexPrediction(components, direction) {
  const sorted = [...components]
    .filter((item) => (direction === "상승" ? item.weighted > 0.05 : item.weighted < -0.05))
    .sort((a, b) =>
      direction === "상승" ? b.weighted - a.weighted : a.weighted - b.weighted,
    )
    .map((item) => `${item.label} ${direction === "상승" ? "양호" : "부담"}`);
  return sorted.slice(0, 3).join(" · ") || "혼조 신호";
}

function scoreRiskAsset(quote) {
  const trend = trendPercent(quote?.history);
  if (!Number.isFinite(trend)) return NaN;
  let score = scoreTrendPercent(trend);
  const daily = Number(quote.changePercent);
  if (daily >= 1) score += 0.15;
  if (daily <= -1) score -= 0.15;
  return clamp(score, -1, 1);
}

function scoreMultiPeriodMomentum(quote) {
  const series = quote?.analysisHistory || quote?.history;
  const periods = [
    { days: 21, threshold: 4, weight: 0.25 },
    { days: 63, threshold: 8, weight: 0.3 },
    { days: 126, threshold: 14, weight: 0.25 },
    { days: 252, threshold: 22, weight: 0.2 },
  ];
  const scores = periods
    .map(({ days, threshold, weight }) => {
      const trend = trendPercentOverPeriod(series, days);
      return Number.isFinite(trend)
        ? { score: clamp(trend / threshold, -1, 1), weight }
        : null;
    })
    .filter(Boolean);
  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? scores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreRelativeMomentum(assetQuote, benchmarkQuote) {
  const assetSeries = assetQuote?.analysisHistory || assetQuote?.history;
  const benchmarkSeries = benchmarkQuote?.analysisHistory || benchmarkQuote?.history;
  const periods = [
    { days: 21, threshold: 3, weight: 0.25 },
    { days: 63, threshold: 6, weight: 0.3 },
    { days: 126, threshold: 9, weight: 0.25 },
    { days: 252, threshold: 14, weight: 0.2 },
  ];
  const scores = periods
    .map(({ days, threshold, weight }) => {
      const assetTrend = trendPercentOverPeriod(assetSeries, days);
      const benchmarkTrend = trendPercentOverPeriod(benchmarkSeries, days);
      if (!Number.isFinite(assetTrend) || !Number.isFinite(benchmarkTrend)) return null;
      return { score: clamp((assetTrend - benchmarkTrend) / threshold, -1, 1), weight };
    })
    .filter(Boolean);
  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? scores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreSemiconductorCycle(quotes) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ score: clamp(score, -1, 1), weight });
  };
  add(scoreRiskAsset(quotes?.sox), 1.15);
  add(scoreMultiPeriodMomentum(quotes?.sox), 1.1);
  add(scoreRelativeMomentum(quotes?.sox, quotes?.nasdaq), 0.9);
  add(scoreRelativeBreadth(quotes?.semiLeadership), 0.75);
  add(scoreSemiconductorBreadth(quotes?.semiBreadth), 0.75);
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreRelativeBreadth(quote) {
  const relativeTrend = Number(quote?.price);
  if (!Number.isFinite(relativeTrend)) return NaN;
  if (relativeTrend >= 2.5) return 0.75;
  if (relativeTrend >= 0.75) return 0.4;
  if (relativeTrend > -0.75) return 0.05;
  if (relativeTrend > -2.5) return -0.4;
  return -0.75;
}

function scoreSemiconductorBreadth(quote) {
  const value = Number(quote?.price);
  const change = Number(quote?.change);
  if (!Number.isFinite(value)) return NaN;
  let score = 0;
  if (value >= 75) score = 0.75;
  else if (value >= 55) score = 0.35;
  else if (value >= 40) score = 0.05;
  else if (value >= 25) score = -0.35;
  else score = -0.75;
  if (change >= 14) score += 0.15;
  if (change <= -14) score -= 0.15;
  return clamp(score, -1, 1);
}

function scoreVixTermStructure(vix3mQuote, vixData) {
  const vix3m = Number(vix3mQuote?.price);
  const vix = Number(vixData?.close);
  if (!Number.isFinite(vix3m) || !Number.isFinite(vix)) return NaN;
  const spread = vix3m - vix;
  let score = 0;
  if (spread >= 4) score = 0.7;
  else if (spread >= 1.5) score = 0.35;
  else if (spread >= 0) score = 0.05;
  else if (spread >= -2) score = -0.4;
  else score = -0.8;
  const trend = pointChange(buildVixTermSeries(vix3mQuote, vixData));
  if (trend >= 1) score += 0.1;
  if (trend <= -1) score -= 0.1;
  return clamp(score, -1, 1);
}

function buildVixTermSeries(vix3mQuote, vixData) {
  const vix3mSeries = vix3mQuote?.history || [];
  const vixByDate = new Map(
    (vixData?.series || []).map((point) => [point.date, Number(point.value)]),
  );
  return vix3mSeries
    .map((point) => {
      const vix = vixByDate.get(point.date);
      const vix3m = Number(point.value);
      if (!Number.isFinite(vix) || !Number.isFinite(vix3m)) return null;
      return { date: point.date, value: vix3m - vix };
    })
    .filter(Boolean);
}

function scoreFearGreed(data) {
  const score = Number(data?.score);
  if (!Number.isFinite(score)) return NaN;
  let result = 0;
  if (score >= 45 && score <= 70) result = 0.8;
  else if (score >= 35 && score < 45) result = 0.25;
  else if (score > 70 && score <= 80) result = 0.1;
  else if (score >= 25 && score < 35) result = -0.4;
  else if (score < 25) result = -0.9;
  else result = -0.6;
  const change = Number(data.change);
  if (change >= 3 && score <= 80) result += 0.1;
  if (change <= -3) result -= 0.1;
  return clamp(result, -1, 1);
}

function scoreVix(data) {
  const value = Number(data?.close);
  if (!Number.isFinite(value)) return NaN;
  let score = 0;
  if (value < 15) score = 0.85;
  else if (value < 20) score = 0.55;
  else if (value < 25) score = 0.05;
  else if (value < 30) score = -0.55;
  else score = -1;
  const trend = trendPercent(data.series);
  if (trend <= -10) score += 0.2;
  if (trend >= 10) score -= 0.2;
  return clamp(score, -1, 1);
}

function scoreYield(quote) {
  const move = pointChange(quote?.history);
  if (!Number.isFinite(move)) return NaN;
  let score = 0;
  if (move <= -0.2) score = 0.6;
  else if (move <= 0.05) score = 0.15;
  else if (move <= 0.2) score = -0.15;
  else score = -0.6;
  const daily = Number(quote.change);
  if (daily <= -0.05) score += 0.1;
  if (daily >= 0.05) score -= 0.1;
  return clamp(score, -1, 1);
}

function scoreUsdKrw(quote) {
  const trend = trendPercent(quote?.history);
  if (!Number.isFinite(trend)) return NaN;
  let score = 0;
  if (trend <= -1) score = 0.5;
  else if (trend <= 0) score = 0.15;
  else if (trend <= 1) score = -0.15;
  else score = -0.5;
  const daily = Number(quote.changePercent);
  if (daily <= -0.5) score += 0.1;
  if (daily >= 0.5) score -= 0.1;
  return clamp(score, -1, 1);
}

function scoreWti(quote) {
  const price = Number(quote?.price);
  const trend = trendPercent(quote?.history);
  if (!Number.isFinite(price) && !Number.isFinite(trend)) return NaN;
  let score = 0;
  if (Number.isFinite(price)) {
    if (price < 70) score += 0.2;
    if (price > 85) score -= 0.25;
  }
  if (Number.isFinite(trend)) {
    if (trend <= -8) score += 0.25;
    if (trend >= 8) score -= 0.35;
  }
  return clamp(score, -1, 1);
}

function scoreMarketRegime(quotes) {
  return average([
    scoreHySpread(quotes?.hySpread),
    scoreNfci(quotes?.nfci),
  ]);
}

function scoreHySpread(quote) {
  const value = Number(quote?.price);
  if (!Number.isFinite(value)) return NaN;
  let score = 0;
  if (value < 3.5) score = 0.75;
  else if (value < 4.5) score = 0.35;
  else if (value < 5.5) score = -0.15;
  else if (value < 7) score = -0.55;
  else score = -0.95;
  const move = pointChange(quote.history);
  if (move <= -0.3) score += 0.15;
  if (move >= 0.4) score -= 0.2;
  return clamp(score, -1, 1);
}

function scoreNfci(quote) {
  const value = Number(quote?.price);
  if (!Number.isFinite(value)) return NaN;
  let score = 0;
  if (value <= -0.4) score = 0.75;
  else if (value <= -0.15) score = 0.35;
  else if (value <= 0.15) score = -0.05;
  else if (value <= 0.5) score = -0.5;
  else score = -0.9;
  const move = pointChange(quote.history);
  if (move <= -0.05) score += 0.1;
  if (move >= 0.08) score -= 0.15;
  return clamp(score, -1, 1);
}

function scoreTrendPercent(percent) {
  if (percent >= 4) return 0.85;
  if (percent >= 1) return 0.45;
  if (percent > -1) return 0.05;
  if (percent > -4) return -0.45;
  return -0.85;
}

function trendPercent(series) {
  const points = numericSeries(series);
  if (points.length < 2 || points[0] === 0) return NaN;
  return ((points.at(-1) - points[0]) / points[0]) * 100;
}

function trendPercentOverPeriod(series, period) {
  const points = numericSeries(series);
  const start = points.at(-period - 1);
  if (points.length < period + 1 || !Number.isFinite(start) || start === 0) return NaN;
  return ((points.at(-1) - start) / start) * 100;
}

function pointChange(series) {
  const points = numericSeries(series);
  if (points.length < 2) return NaN;
  return points.at(-1) - points[0];
}

function numericSeries(series) {
  return (series || [])
    .map((point) => Number(point.value))
    .filter((value) => Number.isFinite(value));
}

function historyAsOf(rows, date) {
  return rows.filter((row) => row.date <= date);
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function rate(count, total) {
  return total ? round((count / total) * 100, 1) : null;
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function toIsoDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`request failed ${response.status}: ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/csv,text/plain,*/*",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`request failed ${response.status}: ${url}`);
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header = [], ...body] = rows.filter((item) => item.some((cell) => cell !== ""));
  return body.map((item) =>
    Object.fromEntries(header.map((key, index) => [key.trim(), item[index]?.trim() ?? ""])),
  );
}

function toCsv(rows) {
  const headers = [
    "date",
    "nextDate",
    "indexId",
    "label",
    "direction",
    "actualDirection",
    "hit",
    "nextDayReturn",
    "score",
    "strength",
    "summary",
  ];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}

function printSummary(summary, outStem) {
  console.log(`saved ${outStem}.json`);
  console.log(`saved ${outStem}.csv`);
  console.log(`all hit rate: ${summary.all.hitRate}% (${summary.all.observations} obs)`);
  console.table(
    Object.entries(summary.byIndex).map(([id, item]) => ({
      id,
      hitRate: item.hitRate,
      observations: item.observations,
      upHitRate: item.upHitRate,
      downHitRate: item.downHitRate,
    })),
  );
  console.table(
    Object.entries(summary.tunedByIndex).map(([id, item]) => ({
      id,
      targetThreshold: item.bestCoverageAtTarget?.threshold ?? null,
      targetHitRate: item.bestCoverageAtTarget?.hitRate ?? null,
      targetCoverage: item.bestCoverageAtTarget?.coverage ?? null,
      bestThreshold: item.bestHitRate?.threshold ?? null,
      bestHitRate: item.bestHitRate?.hitRate ?? null,
      bestCoverage: item.bestHitRate?.coverage ?? null,
    })),
  );
  console.log("high confidence rules");
  console.table(
    Object.entries(summary.highConfidenceRules.byIndex).map(([id, item]) => ({
      id,
      coverage: item.coverage,
      hitRate: item.hitRate,
      observations: item.observations,
    })),
  );
  console.log(
    `combined high-confidence hit rate: ${summary.highConfidenceRules.all.hitRate}% ` +
      `(${summary.highConfidenceRules.all.coverage}% coverage)`,
  );
}
