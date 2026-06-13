const START_DATE = process.argv[2] || "2025-01-01";
const END_DATE = process.argv[3] || new Date().toISOString().slice(0, 10);
const HORIZON_DAYS = Number(process.env.BACKTEST_HORIZON_DAYS || process.argv[4] || 20);
const MIN_COVERAGE = Number(process.env.BACKTEST_MIN_COVERAGE || process.argv[5] || 0.7);
const TRANSACTION_COST_BPS = Number(
  process.env.BACKTEST_TRANSACTION_COST_BPS || process.argv[6] || 10,
);
const ENTRY_MODE = normalizeEntryMode(
  process.env.BACKTEST_ENTRY_MODE || process.argv[7] || "nextOpen",
);
const BACKTEST_TRIALS = Number(process.env.BACKTEST_TRIALS || process.argv[8] || 12);
const TREND_POINTS = 28;
const ANALYSIS_POINTS = 260;
const FORWARD_HORIZONS = normalizeForwardHorizons(
  process.env.BACKTEST_FORWARD_HORIZONS,
  [5, HORIZON_DAYS, 60],
);
const ENTRY_MODES = ["close", "nextOpen", "nextClose"];
const PREDICTION_HORIZONS = [
  { days: 1, field: "nextDayReturn", flatThreshold: 0.75, label: "nextDay" },
  { days: 5, field: "forwardReturn5d", flatThreshold: 2.5, label: "nextWeek" },
];
const MIN_TUNING_TRAIN_ROWS = 500;
const MIN_TUNING_OBJECTIVE_EDGE = 6;
const DEFAULT_PORTFOLIO_EXPOSURE_CONFIG = {
  crisis: 0.5,
  crisisCap: 0.65,
  neutral: 0.8,
  riskWatch: 0.75,
  severeCrisis: 0.35,
  strongTrim: 1,
  weakRed: 0.05,
};

const MARKET_SOURCES = [
  { id: "kospi", symbol: "^KS11" },
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
];
const SENTIMENT_SOURCES = {
  fearGreed:
    "https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv",
  vix: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
};
const PORTFOLIO_HOLDINGS = [
  { amount: 30041571, benchmark: "kospi", code: "395270", id: "hanaroSemi", name: "HANARO Fn K-반도체", tags: ["semi", "korea"] },
  { amount: 30003498, benchmark: "kospi", code: "487240", id: "kodexAiPower", name: "KODEX AI전력핵심설비", tags: ["aiPower", "korea"] },
  { amount: 15064300, benchmark: "sox", code: "442580", id: "plusGlobalHbm", name: "PLUS 글로벌HBM반도체", tags: ["semi", "global"] },
  { amount: 15032675, benchmark: "sox", code: "381180", id: "tigerSox", name: "TIGER 미국필라델피아반도체나스닥", tags: ["semi", "us"] },
  { amount: 15005736, benchmark: "kospi", code: "0162Z0", id: "riseSamsungHynixBond", name: "RISE 삼성전자SK하이닉스채권혼합50", tags: ["semi", "bondMix", "korea"] },
  { amount: 15005730, benchmark: "nasdaq", code: "0019K0", id: "timeNasdaqBond", name: "TIME 미국나스닥100채권혼합50액티브", tags: ["nasdaq", "bondMix", "us"] },
  { amount: 15002399, benchmark: "kospi", code: "284430", id: "kodex200Treasury", name: "KODEX 200미국채혼합", tags: ["kospi", "bondMix", "korea"] },
  { amount: 10010605, benchmark: "nasdaq", code: "456600", id: "timeGlobalAi", name: "TIME 글로벌AI인공지능액티브", tags: ["aiPower", "global"] },
  { amount: 5000440, benchmark: "kospi", code: "466930", id: "solAutoTop3", name: "SOL 자동차TOP3플러스", tags: ["auto", "korea"] },
  { amount: 5003575, benchmark: "nasdaq", code: "418670", id: "tigerAiCyber", name: "TIGER 글로벌AI사이버보안", tags: ["aiPower", "cyber", "global"] },
  { amount: 5006750, benchmark: "nasdaq", code: "0183J0", id: "tigerUsSpaceTech", name: "TIGER 미국우주테크", tags: ["space", "us"] },
  { amount: 5012995, benchmark: "nasdaq", code: "0173Y0", id: "kodexAiOpticalNetwork", name: "KODEX 미국AI광통신네트워크", tags: ["aiPower", "network", "us"] },
  { amount: 5035970, benchmark: "nasdaq", code: "0023A0", id: "solUsQuantumTop10", name: "SOL 미국양자컴퓨팅TOP10", tags: ["quantum", "us"] },
];
const PORTFOLIO_TOTAL = PORTFOLIO_HOLDINGS.reduce(
  (sum, holding) => sum + holding.amount,
  0,
);

const fetchStartDate = shiftDate(START_DATE, -430);
const fetchEndDate = shiftDate(END_DATE, 40);

console.error(`fetching data ${fetchStartDate}..${fetchEndDate}`);
const [marketHistories, fredHistories, sentiment, portfolioHistories] =
  await Promise.all([
    fetchMarketHistories(),
    fetchFredHistories(),
    fetchSentimentHistories(),
    fetchPortfolioHistories(),
  ]);

const rows = runBacktest({
  endDate: END_DATE,
  fredHistories,
  marketHistories,
  portfolioHistories,
  sentiment,
  startDate: START_DATE,
});
const summary = summarizeBacktest(rows);
const payload = {
  generatedAt: new Date().toISOString(),
  range: {
    endDate: END_DATE,
    fetchEndDate,
    fetchStartDate,
    horizonTradingDays: HORIZON_DAYS,
    horizonTradingDaysTested: FORWARD_HORIZONS,
    minimumPortfolioCoverage: MIN_COVERAGE,
    startDate: START_DATE,
    entryMode: ENTRY_MODE,
    estimatedStrategyTrials: BACKTEST_TRIALS,
    transactionCostBps: TRANSACTION_COST_BPS,
  },
  assumptions: [
    "DDR5 spot, server DRAM contract, DXI, and historical foreign/institution flow are excluded where full historical public data is unavailable.",
    "Portfolio strategy exposure is score-based: weak red = 5%, risk watch = 75%, neutral = 80%, otherwise 100%, with crisis-mode caps.",
    "Market strategy exposure remains action-based: new buy = 100%, hold = 60%, sell = 20%.",
    "The primary strategy return uses the configured entry mode. Default is nextOpen.",
    "Transaction costs are charged when exposure changes, including initial entry exposure.",
    "A recovery-pulse overlay reduces false sell/trim signals when volatility is cooling and risk assets are confirming a rebound.",
    "Crisis mode activates when volatility, high-yield spread, and NASDAQ/SOX 200-day trend stress overlap.",
    "Walk-forward tuning chooses exposure parameters on prior years and validates them on the next year.",
    "VIX minus 22-day realized S&P 500 volatility is used as a variance-risk-premium proxy.",
    "Market and portfolio momentum are scored across 1, 3, 6, and 12 month windows.",
    "Backtest dates use the KOSPI trading calendar because the portfolio holdings are Korea-listed ETFs.",
    "Forward-return buckets use current portfolio weights and available ETF prices on each date.",
  ],
  summary,
  rows,
};

const coverageLabel = `cov${Math.round(MIN_COVERAGE * 100)}`;
const horizonLabel = process.env.BACKTEST_FORWARD_HORIZONS
  ? `_h${FORWARD_HORIZONS.join("-")}`
  : "";
const outStem = `screen_results/backtest_signals_${START_DATE}_${END_DATE}_${coverageLabel}${horizonLabel}`;
await writeFile(`${outStem}.json`, `${JSON.stringify(payload, null, 2)}\n`);
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

async function fetchPortfolioHistories() {
  const entries = await Promise.all(
    PORTFOLIO_HOLDINGS.map(async (holding) => [
      holding.id,
      {
        ...holding,
        history: await fetchNaverDaily(holding.code, 1400),
      },
    ]),
  );
  return Object.fromEntries(entries);
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

async function fetchNaverDaily(code, count) {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(
    code,
  )}&timeframe=day&count=${count}&requestType=0`;
  const xml = new TextDecoder("euc-kr").decode(
    await fetchBinary(url, "application/xml,text/xml,text/plain,*/*"),
  );
  const rows = [...xml.matchAll(/<item data="([^"]+)"/g)]
    .map((match) => {
      const [date, open, high, low, close, volume] = match[1].split("|");
      return {
        close: finiteNumber(close),
        date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        high: finiteNumber(high),
        low: finiteNumber(low),
        open: finiteNumber(open),
        value: finiteNumber(close),
        volume: finiteNumber(volume),
      };
    })
    .filter((row) => row.date && Number.isFinite(row.value) && row.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error(`Naver history unavailable: ${code}`);
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

function runBacktest({
  endDate,
  fredHistories,
  marketHistories,
  portfolioHistories,
  sentiment,
  startDate,
}) {
  const dates = marketHistories.kospi
    .map((row) => row.date)
    .filter((date) => date >= startDate && date <= endDate);
  const rows = [];

  for (const date of dates) {
    const quotes = buildQuotesAsOf(date, marketHistories, fredHistories);
    const sentimentAsOf = buildSentimentAsOf(date, sentiment);
    const portfolioMetrics = buildPortfolioMetricsAsOf(date, portfolioHistories);
    const marketSignal = evaluateTradingSignal(quotes, sentimentAsOf);
    const portfolioSignal = evaluatePortfolioSignal(quotes, sentimentAsOf, portfolioMetrics);
    const forwards = Object.fromEntries(
      FORWARD_HORIZONS.map((horizon) => [
        horizon,
        portfolioForwardReturn(date, portfolioHistories, horizon, ENTRY_MODE),
      ]),
    );
    const strategyDay = portfolioForwardReturn(date, portfolioHistories, 1, ENTRY_MODE);
    const entryModeReturns = Object.fromEntries(
      ENTRY_MODES.map((mode) => [
        mode,
        portfolioForwardReturn(date, portfolioHistories, 1, mode),
      ]),
    );
    const forwardValues = Object.values(forwards);
    const entryModeValues = Object.values(entryModeReturns);

    if (
      !Number.isFinite(strategyDay.return) ||
      strategyDay.coverage < MIN_COVERAGE ||
      forwardValues.some(
        (forward) =>
          !Number.isFinite(forward.return) || forward.coverage < MIN_COVERAGE,
      ) ||
      entryModeValues.some(
        (entryReturn) =>
          !Number.isFinite(entryReturn.return) || entryReturn.coverage < MIN_COVERAGE,
      )
    ) {
      continue;
    }

    rows.push({
      date,
      ...Object.fromEntries(
        FORWARD_HORIZONS.map((horizon) => [
          `forwardReturn${horizon}d`,
          round(forwards[horizon].return, 4),
        ]),
      ),
      marketAction: marketSignal.action,
      marketConfidence: marketSignal.confidence,
      marketDownProbability: marketSignal.downProbability,
      marketExposure: actionExposureForMarket(marketSignal.action),
      marketRegime: marketSignal.regime,
      marketRecoveryScore: marketSignal.recoveryScore,
      marketScore: marketSignal.score,
      marketUpProbability: marketSignal.upProbability,
      closeToCloseReturn: round(entryModeReturns.close.return, 4),
      nextCloseReturn: round(entryModeReturns.nextClose.return, 4),
      nextDayReturn: round(strategyDay.return, 4),
      nextOpenReturn: round(entryModeReturns.nextOpen.return, 4),
      portfolioAction: portfolioSignal.action,
      portfolioConfidence: portfolioSignal.confidence,
      portfolioCrisisMode: portfolioSignal.crisisMode.active
        ? portfolioSignal.crisisMode.severity
        : "normal",
      portfolioCrisisScore: portfolioSignal.crisisMode.score,
      portfolioCrisisShock: portfolioSignal.crisisMode.shock ? 1 : 0,
      portfolioCrisisTailRisk: portfolioSignal.crisisMode.tailRisk ? 1 : 0,
      portfolioDownProbability: portfolioSignal.downProbability,
      portfolioCoverage: round(
        Math.min(
          strategyDay.coverage,
          ...forwardValues.map((forward) => forward.coverage),
          ...entryModeValues.map((entryReturn) => entryReturn.coverage),
        ) * 100,
        1,
      ),
      portfolioExposure: targetPortfolioExposure(
        portfolioSignal.score,
        portfolioSignal.action,
        portfolioSignal.confidence,
        portfolioSignal.crisisMode,
        DEFAULT_PORTFOLIO_EXPOSURE_CONFIG,
        portfolioSignal.upProbability,
        portfolioSignal.downProbability,
        portfolioSignal.regime,
      ),
      portfolioFixedExposure: actionExposureForPortfolio(portfolioSignal.action),
      portfolioRegime: portfolioSignal.regime,
      portfolioRecoveryScore: portfolioSignal.recoveryScore,
      portfolioScore: portfolioSignal.score,
      portfolioUpProbability: portfolioSignal.upProbability,
      strategyReturn: round(strategyDay.return, 4),
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
    kospi: quote("kospi"),
    sp500: quote("sp500"),
    nasdaq: quote("nasdaq"),
    sox: quote("sox"),
    nikkei: quote("nikkei"),
    nasdaqFutures: quote("nasdaqFutures"),
    sp500Futures: quote("sp500Futures"),
    nasdaqBreadth: buildRelativeStrengthQuoteFromQuotes(qqqe, qqq),
    sp500Breadth: buildRelativeStrengthQuoteFromQuotes(rsp, spy),
    semiBreadth: buildMovingAverageBreadthQuoteFromHistories(semiLeaderHistories, 50),
    semiLeadership: buildRelativeStrengthQuoteFromQuotes(smh, qqq),
    vix3m: quote("vix3m"),
    usdKrw: quote("usdKrw"),
    wti: quote("wti"),
    us10y: quote("us10y"),
    hySpread: quote("hySpread", fredHistories),
    ddr5Spot: null,
    serverDdr5Contract: null,
  };
}

function buildQuoteFromHistory(rows) {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  if (!latest) return null;
  const change = previous ? latest.value - previous.value : 0;
  return {
    change,
    changePercent: previous?.value ? (change / previous.value) * 100 : 0,
    history: rows.slice(-TREND_POINTS),
    analysisHistory: rows.slice(-ANALYSIS_POINTS),
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
          analysisSeries: fearRows.slice(-ANALYSIS_POINTS),
          rating: fear.rating || getFearGreedRating(fear.value),
          score: fear.value,
          series: fearRows.slice(-TREND_POINTS),
        }
      : null,
    vix: vix
      ? {
          change: vixPrev ? vix.value - vixPrev.value : 0,
          analysisSeries: vixRows.slice(-ANALYSIS_POINTS),
          close: vix.value,
          series: vixRows.slice(-TREND_POINTS),
        }
      : null,
  };
}

function buildPortfolioMetricsAsOf(date, portfolioHistories) {
  return {
    holdings: Object.values(portfolioHistories).map((holding) => {
      const rows = historyAsOf(holding.history, date);
      const closes = rows.map((row) => row.value);
      const latest = rows.at(-1);
      const high52 = Math.max(...closes.slice(-252).filter(Number.isFinite));
      return {
        ...holding,
        latestClose: latest?.value ?? null,
        high52: Number.isFinite(high52) ? high52 : null,
        highProximity:
          latest && Number.isFinite(high52) && high52 > 0
            ? (latest.value / high52) * 100
            : null,
        analysisHistory: rows.slice(-ANALYSIS_POINTS).map((row) => ({
          date: row.date,
          value: row.value,
        })),
        ma50: movingAverage(closes, 50),
        ma200: movingAverage(closes, 200),
        trend28: trendPercent(rows.slice(-TREND_POINTS)),
      };
    }),
    totalAmount: PORTFOLIO_TOTAL,
  };
}

function portfolioForwardReturn(date, portfolioHistories, horizon, entryMode = "close") {
  let weighted = 0;
  let weight = 0;
  for (const holding of Object.values(portfolioHistories)) {
    const index = holding.history.findIndex((row) => row.date >= date);
    if (index === 0 && holding.history[index]?.date > date) continue;
    const entryOffset = entryMode === "close" ? 0 : 1;
    const exitOffset = entryMode === "close" ? horizon : horizon + 1;
    const entryIndex = index + entryOffset;
    const exitIndex = index + exitOffset;
    if (index < 0 || entryIndex >= holding.history.length || exitIndex >= holding.history.length) {
      continue;
    }
    const entryRow = holding.history[entryIndex];
    const exitRow = holding.history[exitIndex];
    const start = entryMode === "nextOpen" ? entryRow.open : entryRow.value;
    const end = entryMode === "nextOpen" ? exitRow.open : exitRow.value;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) continue;
    weighted += ((end - start) / start) * holding.amount;
    weight += holding.amount;
  }
  return {
    coverage: PORTFOLIO_TOTAL ? weight / PORTFOLIO_TOTAL : 0,
    return: weight ? (weighted / weight) * 100 : NaN,
  };
}

function evaluateTradingSignal(quotes, sentiment) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ weighted: clamp(score, -1, 1) * weight, weight });
  };
  const broadScores = [
    scoreRiskAsset(quotes.sp500),
    scoreRiskAsset(quotes.nasdaq),
    scoreRiskAsset(quotes.kospi),
  ].filter(Number.isFinite);
  const broadScore = average(broadScores);
  const marketBreadthScore = scoreMarketBreadth(quotes);
  const vixTermScore = scoreVixTermStructure(quotes.vix3m, sentiment.vix);
  const rateScore = scoreYield(quotes.us10y);
  const regimeScore = scoreMarketRegime(quotes);
  const crisisMode = detectPortfolioCrisisMode(quotes, sentiment);
  const geopoliticalReliefScore = scoreGeopoliticalRelief(quotes, sentiment);
  const shortTermEventScore = scoreShortTermEventImpulse(quotes, sentiment);
  add(broadScore, 2.1);
  add(scoreRiskAsset(quotes.sox), 1.3);
  add(geopoliticalReliefScore, 0.65);
  add(marketBreadthScore, 1.15);
  add(vixTermScore, 0.8);
  add(scoreFearGreed(sentiment.fearGreed), 1.15);
  add(scoreVix(sentiment.vix), 1.45);
  add(rateScore, 0.85);
  add(scoreUsdKrw(quotes.usdKrw), 0.65);
  add(scoreWti(quotes.wti), 0.45);
  add(regimeScore, 1.25);
  const recoveryScore = scoreRecoveryPulse(quotes, sentiment);
  add(recoveryScore, 0.75);

  let score = weightedScore(components);
  score = clamp(Math.round(score + shortTermEventScoreAdjustment(shortTermEventScore)), -100, 100);
  const vixLevel = Number(sentiment.vix?.close);
  const hasRecovery = Number.isFinite(recoveryScore) && recoveryScore >= 0.35;
  const recoveryForAction = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  const slowMarketDownRisk =
    score <= -45 && recoveryForAction >= -0.6 && recoveryForAction <= -0.35;
  const probability = evaluateSignalProbability({
    broadScore,
    crisisMode,
    geopoliticalReliefScore,
    marketBreadthScore,
    rateScore,
    recoveryScore,
    regimeScore,
    score,
    shortTermEventScore,
    vixLevel,
    vixTermScore,
  });
  let action = "중립";
  if (slowMarketDownRisk) {
    action = "하락";
  } else if (
    score >= Math.max(50, probability.buyScoreThreshold) &&
    probability.upProbability >= probability.buyProbabilityThreshold &&
    broadScore > 0 &&
    (!Number.isFinite(vixLevel) || vixLevel < 28) &&
    (hasRecovery || !Number.isFinite(vixLevel) || vixLevel < 25)
  ) {
    action = "상승";
  }
  return {
    action,
    confidence: signalConfidence(action, score),
    downProbability: probability.downProbability,
    regime: probability.regime,
    recoveryScore: round(recoveryScore, 4),
    score,
    upProbability: probability.upProbability,
  };
}

function evaluatePortfolioSignal(quotes, sentiment, portfolioMetrics) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ weighted: clamp(score, -1, 1) * weight, weight });
  };

  const semiScore = scoreRiskAsset(quotes.sox);
  const nasdaqScore = scoreRiskAsset(quotes.nasdaq);
  const rateScore = scoreYield(quotes.us10y);
  const relativeScore = scorePortfolioRelativeStrength(portfolioMetrics, quotes);
  const multiRelativeScore = scorePortfolioMultiPeriodRelativeStrength(portfolioMetrics, quotes);
  const movingAverageScore = scorePortfolioMovingAverage(portfolioMetrics);
  const regimeScore = scoreMarketRegime(quotes);
  const recoveryScore = scoreRecoveryPulse(quotes, sentiment, portfolioMetrics);
  const semiconductorCycleScore = scoreSemiconductorCycle(quotes);
  const marketBreadthScore = scoreMarketBreadth(quotes);
  const vixTermScore = scoreVixTermStructure(quotes.vix3m, sentiment.vix);
  const highProximityScore = scorePortfolioHighProximity(portfolioMetrics);
  const variancePremiumScore = scoreVarianceRiskPremium(quotes, sentiment);
  const crisisMode = detectPortfolioCrisisMode(quotes, sentiment);
  const geopoliticalReliefScore = scoreGeopoliticalRelief(quotes, sentiment);
  const shortTermEventScore = scoreShortTermEventImpulse(quotes, sentiment);

  add(semiScore, 2.4);
  add(nasdaqScore, 1.25);
  add(scoreRiskAsset(quotes.kospi), 0.75);
  add(geopoliticalReliefScore, 0.5);
  add(relativeScore, 1.35);
  add(multiRelativeScore, 1.1);
  add(movingAverageScore, 1.15);
  add(regimeScore, 1.35);
  add(semiconductorCycleScore, 1.25);
  add(marketBreadthScore, 1.05);
  add(highProximityScore, 0.85);
  add(rateScore, 1.2);
  add(scoreUsdKrw(quotes.usdKrw), 0.85);
  add(scoreVix(sentiment.vix), 1.05);
  add(vixTermScore, 0.75);
  add(variancePremiumScore, 0.85);
  add(scoreFearGreed(sentiment.fearGreed), 0.65);
  add(scoreWti(quotes.wti), 0.2);
  add(recoveryScore, 0.8);

  let score = weightedScore(components);
  score += Math.round(shortTermEventScoreAdjustment(shortTermEventScore) * 0.65);
  const vixLevel = Number(sentiment.vix?.close);
  const hasRecovery = Number.isFinite(recoveryScore) && recoveryScore >= 0.35;
  const recoveryForPenalty = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  const recoveryForAction = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  if (vixLevel >= 25 && recoveryForPenalty < 0.25) score -= 8;
  if (vixLevel >= 25 && hasRecovery) score += 4;
  if (rateScore < -0.35 && semiScore < 0.2) score -= 6;
  if (relativeScore < -0.25 && movingAverageScore < 0) score -= 6;
  if (multiRelativeScore < -0.35 && semiconductorCycleScore < 0) score -= 5;
  if (variancePremiumScore < -0.55 && recoveryForPenalty < 0.25) score -= 4;
  if (crisisMode.tailRisk) score -= crisisMode.severity === "severe" ? 18 : 12;
  score = clamp(Math.round(score), -100, 100);
  const slowPortfolioDownRisk =
    score <= -10 && recoveryForAction >= -0.1 && recoveryForAction < 0.2;
  const probability = evaluateSignalProbability({
    broadScore: nasdaqScore,
    concentration: portfolioRiskThemeWeight(),
    crisisMode,
    geopoliticalReliefScore,
    highProximityScore,
    marketBreadthScore,
    rateScore,
    recoveryScore,
    regimeScore,
    score,
    semiconductorCycleScore,
    semiScore,
    shortTermEventScore,
    variancePremiumScore,
    vixLevel,
    vixTermScore,
  });

  let action = "중립";
  if (slowPortfolioDownRisk) {
    action = "하락";
  } else if (
    score >= Math.max(40, probability.buyScoreThreshold) &&
    probability.upProbability >= probability.buyProbabilityThreshold &&
    semiScore > 0 &&
    semiconductorCycleScore > -0.2 &&
    regimeScore > -0.25 &&
    rateScore > -0.35 &&
    !crisisMode.active &&
    vixLevel < 28 &&
    (!Number.isFinite(variancePremiumScore) || variancePremiumScore > -0.6) &&
    (!Number.isFinite(recoveryScore) || recoveryScore > -0.2)
  ) {
    action = "상승";
  }
  return {
    action,
    confidence: signalConfidence(action, score),
    crisisMode,
    downProbability: probability.downProbability,
    regime: probability.regime,
    recoveryScore: round(recoveryScore, 4),
    score,
    upProbability: probability.upProbability,
  };
}

function evaluateSignalProbability({
  broadScore,
  concentration = 0,
  crisisMode,
  geopoliticalReliefScore,
  highProximityScore,
  marketBreadthScore,
  rateScore,
  recoveryScore,
  regimeScore,
  score,
  semiconductorCycleScore,
  semiScore,
  shortTermEventScore,
  variancePremiumScore,
  vixLevel,
  vixTermScore,
}) {
  const cleanScore = Number(score);
  const breadth = cleanSignalScore(marketBreadthScore);
  const vixTerm = cleanSignalScore(vixTermScore);
  const rate = cleanSignalScore(rateScore);
  const recovery = cleanSignalScore(recoveryScore);
  const regimeScoreValue = cleanSignalScore(regimeScore);
  const variancePremium = cleanSignalScore(variancePremiumScore);
  const geopoliticalRelief = cleanSignalScore(geopoliticalReliefScore);
  const shortTermEvent = cleanSignalScore(shortTermEventScore);
  const semiCycle = cleanSignalScore(semiconductorCycleScore);
  const highProximity = cleanSignalScore(highProximityScore);
  const broad = cleanSignalScore(broadScore);
  const semi = cleanSignalScore(semiScore);
  const regime = classifySignalRegime({
    concentration,
    crisisMode,
    marketBreadthScore: breadth,
    rateScore: rate,
    vixLevel,
    vixTermScore: vixTerm,
  });
  const crisisPenalty =
    (crisisMode?.active ? 0.45 : 0) + (crisisMode?.tailRisk ? 0.55 : 0);
  const vixPenalty = Number.isFinite(vixLevel) && vixLevel >= 28 ? 0.28 : 0;
  const upLogit =
    -0.1 +
    cleanScore / 36 +
    positivePart(broad) * 0.35 +
    breadth * 0.7 +
    vixTerm * 0.45 +
    regimeScoreValue * 0.3 +
    recovery * 0.35 +
    geopoliticalRelief * 0.35 +
    shortTermEvent * 0.3 +
    semiCycle * 0.4 +
    highProximity * 0.22 +
    positivePart(semi) * 0.25 -
    negativePart(rate) * 0.35 -
    negativePart(variancePremium) * 0.35 -
    crisisPenalty -
    vixPenalty;
  const downLogit =
    -0.85 -
    cleanScore / 36 +
    negativePart(broad) * 0.35 +
    negativePart(breadth) * 0.8 +
    negativePart(vixTerm) * 0.65 +
    negativePart(rate) * 0.25 +
    negativePart(variancePremium) * 0.35 +
    negativePart(recovery) * 0.35 +
    negativePart(geopoliticalRelief) * 0.25 +
    negativePart(shortTermEvent) * 0.25 +
    (crisisMode?.active ? 0.45 : 0) +
    (crisisMode?.tailRisk ? 0.65 : 0) +
    (Number.isFinite(vixLevel) && vixLevel >= 32 ? 0.35 : 0);

  const thresholds = probabilityThresholdsForRegime(regime);
  return {
    ...thresholds,
    downProbability: round(clamp(calibratedSignalProbability(downLogit), 1, 99), 0),
    regime,
    upProbability: round(clamp(calibratedSignalProbability(upLogit), 1, 99), 0),
  };
}

function classifySignalRegime({
  concentration,
  crisisMode,
  marketBreadthScore,
  rateScore,
  vixLevel,
  vixTermScore,
}) {
  if (
    crisisMode?.tailRisk ||
    (Number.isFinite(vixLevel) && vixLevel >= 32) ||
    vixTermScore <= -0.45 ||
    ((Number.isFinite(vixLevel) && vixLevel >= 28) && marketBreadthScore < 0)
  ) {
    return "stress";
  }
  if (rateScore <= -0.35 && concentration >= 70) return "ratePressure";
  if (
    marketBreadthScore >= 0.25 &&
    vixTermScore >= 0.2 &&
    (!Number.isFinite(vixLevel) || vixLevel < 25)
  ) {
    return "trend";
  }
  return "balanced";
}

function probabilityThresholdsForRegime(regime) {
  if (regime === "trend") {
    return {
      buyProbabilityThreshold: 62,
      buyScoreThreshold: 38,
      sellProbabilityThreshold: 66,
    };
  }
  if (regime === "ratePressure") {
    return {
      buyProbabilityThreshold: 70,
      buyScoreThreshold: 48,
      sellProbabilityThreshold: 60,
    };
  }
  if (regime === "stress") {
    return {
      buyProbabilityThreshold: 74,
      buyScoreThreshold: 58,
      sellProbabilityThreshold: 58,
    };
  }
  return {
    buyProbabilityThreshold: 66,
    buyScoreThreshold: 42,
    sellProbabilityThreshold: 62,
  };
}

function cleanSignalScore(value) {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

function shortTermEventScoreAdjustment(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  if (value >= 0.75) return value * 12;
  if (value >= 0.4) return value * 10;
  if (value <= -0.55) return value * 10;
  return 0;
}

function positivePart(value) {
  return Math.max(0, cleanSignalScore(value));
}

function negativePart(value) {
  return Math.max(0, -cleanSignalScore(value));
}

function logisticProbability(logit) {
  return 1 / (1 + Math.exp(-logit));
}

function calibratedSignalProbability(logit) {
  return 50 + (logisticProbability(logit) - 0.5) * 60;
}

function portfolioRiskThemeWeight() {
  return portfolioAnyTagWeight(["semi", "aiPower", "nasdaq", "cyber", "network", "space", "quantum"]);
}

function portfolioAnyTagWeight(tags) {
  const taggedAmount = PORTFOLIO_HOLDINGS
    .filter((holding) => tags.some((tag) => holding.tags.includes(tag)))
    .reduce((sum, holding) => sum + holding.amount, 0);
  return PORTFOLIO_TOTAL ? (taggedAmount / PORTFOLIO_TOTAL) * 100 : 0;
}

function summarizeBacktest(rows) {
  const dailyReturns = rows.map((row) => row.strategyReturn / 100);
  const portfolioExposure = rows.map((row) => Number(row.portfolioExposure));
  const portfolioFixedExposure = rows.map((row) => Number(row.portfolioFixedExposure));
  const marketExposure = rows.map((row) => Number(row.marketExposure));
  return {
    benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1), 0),
    entryMode: ENTRY_MODE,
    entryModeComparison: summarizeEntryModes(rows),
    firstDate: rows[0]?.date || null,
    lastDate: rows.at(-1)?.date || null,
    marketSignal: {
      actionBuckets: bucketStats(rows, "marketAction"),
      curve: summarizeCurve(dailyReturns, marketExposure, TRANSACTION_COST_BPS),
      predictionStats: signalPredictionStats(rows, "marketAction", "market"),
    },
    observations: rows.length,
    averagePortfolioCoverage: round(
      average(rows.map((row) => Number(row.portfolioCoverage))) || 0,
      1,
    ),
    portfolioSignal: {
      actionBuckets: bucketStats(rows, "portfolioAction"),
      curve: summarizeCurve(dailyReturns, portfolioExposure, TRANSACTION_COST_BPS),
      fixedExposureCurve: summarizeCurve(
        dailyReturns,
        portfolioFixedExposure,
        TRANSACTION_COST_BPS,
      ),
      predictionStats: signalPredictionStats(rows, "portfolioAction", "portfolio"),
    },
    transactionCostBps: TRANSACTION_COST_BPS,
    yearly: summarizeByYear(rows),
    walkForward: summarizeWalkForward(rows),
  };
}

function signalPredictionStats(rows, actionKey, probabilityPrefix) {
  return Object.fromEntries(
    PREDICTION_HORIZONS.map((horizon) => {
      const horizonRows = rows.filter((row) => Number.isFinite(row[horizon.field]));
      const actualLabels = horizonRows.map((row) =>
        actualMoveLabel(row[horizon.field], horizon.flatThreshold),
      );
      const hitRows = horizonRows.filter(
        (row, index) => row[actionKey] === actualLabels[index],
      );
      const actionableRows = horizonRows.filter((row) => row[actionKey] !== "중립");
      const actionableHitRows = actionableRows.filter((row) =>
        directionalHit(row[actionKey], row[horizon.field], horizon.flatThreshold),
      );
      const byAction = Object.fromEntries(
        [...groupRows(horizonRows, (row) => row[actionKey]).entries()].map(
          ([action, groupRowsForAction]) => {
            const values = groupRowsForAction.map((row) => row[horizon.field]);
            const actualCounts = summarizeActualMoveCounts(
              values,
              horizon.flatThreshold,
            );
            const hitCount = groupRowsForAction.filter(
              (row) =>
                row[actionKey] ===
                actualMoveLabel(row[horizon.field], horizon.flatThreshold),
            ).length;
            return [
              action,
              {
                actualDownRate: rate(actualCounts["하락"], values.length),
                actualNeutralRate: rate(actualCounts["중립"], values.length),
                actualUpRate: rate(actualCounts["상승"], values.length),
                avgReturn: round(average(values), 2),
                count: groupRowsForAction.length,
                hitRate: rate(hitCount, values.length),
                medianReturn: round(median(values), 2),
                negativeRate: rate(values.filter((value) => value < 0).length, values.length),
                positiveRate: rate(values.filter((value) => value > 0).length, values.length),
              },
            ];
          },
        ),
      );
      const probabilityTable = probabilityPrefix
        ? probabilityThresholdStats(horizonRows, probabilityPrefix, horizon)
        : [];
      return [
        horizon.label,
        {
          accuracy: rate(hitRows.length, horizonRows.length),
          actionableCoverage: rate(actionableRows.length, horizonRows.length),
          actionableHitRate: rate(actionableHitRows.length, actionableRows.length),
          actualMoveThreshold: horizon.flatThreshold,
          byAction,
          byProbabilityThreshold: probabilityTable,
          byRegime: probabilityPrefix
            ? regimePredictionStats(horizonRows, probabilityPrefix, horizon)
            : {},
          days: horizon.days,
          observations: horizonRows.length,
        },
      ];
    }),
  );
}

function actualMoveLabel(returnValue, flatThreshold) {
  if (returnValue >= flatThreshold) return "상승";
  if (returnValue <= -flatThreshold) return "하락";
  return "중립";
}

function directionalHit(action, returnValue, flatThreshold) {
  if (action === "상승") return returnValue > 0;
  if (action === "하락") return returnValue < 0;
  return Math.abs(returnValue) < flatThreshold;
}

function probabilityThresholdStats(rows, prefix, horizon) {
  const thresholds = [55, 60, 65, 70, 75];
  return thresholds.map((threshold) => {
    const signals = rows
      .map((row) => probabilitySignalForThreshold(row, prefix, threshold))
      .filter(Boolean);
    const hitRows = signals.filter((signal) =>
      directionalHit(signal.action, signal.row[horizon.field], horizon.flatThreshold),
    );
    const upSignals = signals.filter((signal) => signal.action === "상승");
    const downSignals = signals.filter((signal) => signal.action === "하락");
    return {
      threshold,
      count: signals.length,
      coverage: rate(signals.length, rows.length),
      hitRate: rate(hitRows.length, signals.length),
      upCount: upSignals.length,
      upHitRate: rate(
        upSignals.filter((signal) => signal.row[horizon.field] > 0).length,
        upSignals.length,
      ),
      downCount: downSignals.length,
      downHitRate: rate(
        downSignals.filter((signal) => signal.row[horizon.field] < 0).length,
        downSignals.length,
      ),
    };
  });
}

function probabilitySignalForThreshold(row, prefix, threshold) {
  const up = Number(row[`${prefix}UpProbability`]);
  const down = Number(row[`${prefix}DownProbability`]);
  if (Number.isFinite(up) && up >= threshold && (!Number.isFinite(down) || up >= down)) {
    return { action: "상승", probability: up, row };
  }
  if (Number.isFinite(down) && down >= threshold && (!Number.isFinite(up) || down > up)) {
    return { action: "하락", probability: down, row };
  }
  return null;
}

function regimePredictionStats(rows, prefix, horizon) {
  return Object.fromEntries(
    [...groupRows(rows, (row) => row[`${prefix}Regime`] || "unknown").entries()].map(
      ([regime, groupRowsForRegime]) => {
        const values = groupRowsForRegime.map((row) => row[horizon.field]);
        return [
          regime,
          {
            avgReturn: round(average(values), 2),
            count: groupRowsForRegime.length,
            negativeRate: rate(values.filter((value) => value < 0).length, values.length),
            positiveRate: rate(values.filter((value) => value > 0).length, values.length),
          },
        ];
      },
    ),
  );
}

function summarizeActualMoveCounts(values, flatThreshold) {
  return values.reduce(
    (counts, value) => {
      counts[actualMoveLabel(value, flatThreshold)] += 1;
      return counts;
    },
    { 상승: 0, 중립: 0, 하락: 0 },
  );
}

function bucketStats(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([label, groupRows]) => {
      const closeToCloseValues = groupRows.map((row) => row.closeToCloseReturn);
      const nextOpenValues = groupRows.map((row) => row.nextOpenReturn);
      const strategyValues = groupRows.map((row) => row.strategyReturn);
      const horizonStats = Object.fromEntries(
        FORWARD_HORIZONS.flatMap((horizon) => {
          const forwardValues = groupRows
            .map((row) => row[`forwardReturn${horizon}d`])
            .filter(Number.isFinite);
          return [
            [`avgForward${horizon}d`, round(average(forwardValues), 2)],
            [`medianForward${horizon}d`, round(median(forwardValues), 2)],
            [
              `winRate${horizon}d`,
              round(
                (forwardValues.filter((value) => value > 0).length /
                  forwardValues.length) *
                  100,
                1,
              ),
            ],
          ];
        }),
      );
      return [
        label,
        {
          ...horizonStats,
          avgCloseToClose: round(average(closeToCloseValues), 2),
          avgNextOpen: round(average(nextOpenValues), 2),
          avgStrategyDay: round(average(strategyValues), 2),
          count: groupRows.length,
          strategyDayWinRate: round(
            (strategyValues.filter((value) => value > 0).length /
              strategyValues.length) *
              100,
            1,
          ),
        },
      ];
    }),
  );
}

function summarizeCurve(dailyReturns, exposures, transactionCostBps = 0) {
  let equity = 1;
  let netEquity = 1;
  let peak = 1;
  let netPeak = 1;
  let maxDrawdown = 0;
  let netMaxDrawdown = 0;
  let totalTurnover = 0;
  let previousExposure = 0;
  const grossReturns = [];
  const netReturns = [];
  for (let index = 0; index < dailyReturns.length; index += 1) {
    const exposure = Number(exposures[index]) || 0;
    const turnover = Math.abs(exposure - previousExposure);
    const cost = turnover * (transactionCostBps / 10000);
    const grossReturn = dailyReturns[index] * exposure;
    const netReturn = grossReturn - cost;
    totalTurnover += turnover;
    grossReturns.push(grossReturn);
    netReturns.push(netReturn);
    equity *= 1 + grossReturn;
    netEquity *= Math.max(0, 1 + netReturn);
    peak = Math.max(peak, equity);
    netPeak = Math.max(netPeak, netEquity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    netMaxDrawdown = Math.min(netMaxDrawdown, netEquity / netPeak - 1);
    previousExposure = exposure;
  }
  const grossMetrics = performanceMetrics(grossReturns, maxDrawdown, BACKTEST_TRIALS);
  const netMetrics = performanceMetrics(netReturns, netMaxDrawdown, BACKTEST_TRIALS);
  return {
    averageExposure: round(average(exposures) * 100, 1),
    costDrag: round((equity - netEquity) * 100, 2),
    grossMetrics,
    maxDrawdown: round(maxDrawdown * 100, 2),
    netMetrics,
    netMaxDrawdown: round(netMaxDrawdown * 100, 2),
    netTotalReturn: round((netEquity - 1) * 100, 2),
    transactionCostBps,
    totalReturn: round((equity - 1) * 100, 2),
    turnover: round(totalTurnover, 2),
  };
}

function summarizeByYear(rows) {
  const groups = groupRows(rows, (row) => row.date.slice(0, 4));
  return Object.fromEntries(
    [...groups.entries()].map(([year, yearRows]) => [
      year,
      summarizePeriod(yearRows),
    ]),
  );
}

function summarizeWalkForward(rows) {
  const years = [...new Set(rows.map((row) => row.date.slice(0, 4)))].sort();
  const folds = [];
  const tunedValidationRows = [];
  for (let index = 1; index < years.length; index += 1) {
    const testYear = years[index];
    const trainRows = rows.filter((row) => row.date.slice(0, 4) < testYear);
    const testRows = rows.filter((row) => row.date.slice(0, 4) === testYear);
    if (!trainRows.length || !testRows.length) continue;
    const tuned = selectExposureConfig(trainRows);
    tunedValidationRows.push(
      ...testRows.map((row) => ({
        config: tuned.config,
        row,
      })),
    );
    folds.push({
      testPeriod: periodLabel(testRows),
      testRows: testRows.length,
      testYear,
      trainPeriod: periodLabel(trainRows),
      trainRows: trainRows.length,
      trainSummary: summarizePeriod(trainRows),
      tunedConfig: tuned.config,
      tunedReason: tuned.reason,
      tunedTrainObjective: tuned.objective,
      tunedTrainSummary: tuned.trainSummary,
      tunedValidationSummary: summarizePeriodWithConfig(testRows, tuned.config),
      validationSummary: summarizePeriod(testRows),
    });
  }
  const validationRows = folds.flatMap((fold) =>
    rows.filter((row) => row.date.slice(0, 4) === fold.testYear),
  );
  return {
    folds,
    tunedConfigCounts: summarizeTunedConfigCounts(folds),
    tunedValidationAggregate: summarizeTunedValidationRows(tunedValidationRows),
    validationAggregate: summarizePeriod(validationRows),
  };
}

function summarizePeriod(rows) {
  const dailyReturns = rows.map((row) => row.strategyReturn / 100);
  const portfolioExposure = rows.map((row) => Number(row.portfolioExposure));
  const portfolioFixedExposure = rows.map((row) => Number(row.portfolioFixedExposure));
  const marketExposure = rows.map((row) => Number(row.marketExposure));
  return {
    benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1), 0),
    firstDate: rows[0]?.date || null,
    lastDate: rows.at(-1)?.date || null,
    marketSignal: summarizeCurve(dailyReturns, marketExposure, TRANSACTION_COST_BPS),
    observations: rows.length,
    portfolioSignal: summarizeCurve(dailyReturns, portfolioExposure, TRANSACTION_COST_BPS),
    portfolioSignalFixedExposure: summarizeCurve(
      dailyReturns,
      portfolioFixedExposure,
      TRANSACTION_COST_BPS,
    ),
  };
}

function summarizePeriodWithConfig(rows, config) {
  const dailyReturns = rows.map((row) => row.strategyReturn / 100);
  const tunedExposure = rows.map((row) => exposureForConfig(row, config));
  return {
    benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1), 0),
    firstDate: rows[0]?.date || null,
    lastDate: rows.at(-1)?.date || null,
    observations: rows.length,
    portfolioSignal: summarizeCurve(dailyReturns, tunedExposure, TRANSACTION_COST_BPS),
  };
}

function summarizeTunedValidationRows(items) {
  const rows = items.map((item) => item.row);
  const dailyReturns = rows.map((row) => row.strategyReturn / 100);
  const tunedExposure = items.map((item) => exposureForConfig(item.row, item.config));
  return {
    benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1), 0),
    firstDate: rows[0]?.date || null,
    lastDate: rows.at(-1)?.date || null,
    observations: rows.length,
    portfolioSignal: summarizeCurve(dailyReturns, tunedExposure, TRANSACTION_COST_BPS),
  };
}

function selectExposureConfig(trainRows) {
  const defaultConfig = normalizeExposureConfig(DEFAULT_PORTFOLIO_EXPOSURE_CONFIG);
  const defaultSummary = summarizePeriodWithConfig(trainRows, defaultConfig).portfolioSignal;
  const defaultObjective = exposureTuningObjective(defaultSummary);
  let selected = {
    config: defaultConfig,
    objective: round(defaultObjective, 4),
    reason: "default",
    trainSummary: defaultSummary,
  };
  if (trainRows.length < MIN_TUNING_TRAIN_ROWS) {
    return {
      ...selected,
      reason: "insufficient_history",
    };
  }

  for (const config of buildExposureConfigCandidates()) {
    const trainSummary = summarizePeriodWithConfig(trainRows, config).portfolioSignal;
    const objective = exposureTuningObjective(trainSummary);
    if (objective > selected.objective) {
      selected = {
        config,
        objective: round(objective, 4),
        reason: "optimized",
        trainSummary,
      };
    }
  }
  if (selected.objective < defaultObjective + MIN_TUNING_OBJECTIVE_EDGE) {
    return {
      config: defaultConfig,
      objective: round(defaultObjective, 4),
      reason: "default_guard",
      trainSummary: defaultSummary,
    };
  }
  return selected;
}

function exposureTuningObjective(curve) {
  const sharpe = Number(curve.netMetrics?.sharpe) || 0;
  const drawdown = Number(curve.netMaxDrawdown) || 0;
  const turnover = Number(curve.turnover) || 0;
  return curve.netTotalReturn + drawdown * 0.75 + sharpe * 8 - turnover * 0.05;
}

function buildExposureConfigCandidates() {
  const candidates = [];
  const seen = new Set();
  const push = (config) => {
    const normalized = normalizeExposureConfig(config);
    const key = JSON.stringify(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
  };

  push(DEFAULT_PORTFOLIO_EXPOSURE_CONFIG);
  for (const weakRed of [0.05, 0.1, 0.15, 0.25]) {
    for (const riskWatch of [0.65, 0.75, 0.85, 1]) {
      for (const neutral of [0.8, 0.9, 1]) {
        for (const strongTrim of [0.75, 1]) {
          for (const crisis of [0.35, 0.5]) {
            for (const crisisCap of [0.55, 0.65, 0.75]) {
              push({
                crisis,
                crisisCap,
                neutral,
                riskWatch,
                severeCrisis: 0.35,
                strongTrim,
                weakRed,
              });
            }
          }
        }
      }
    }
  }
  return candidates;
}

function normalizeExposureConfig(config) {
  return {
    crisis: config.crisis,
    crisisCap: config.crisisCap,
    neutral: config.neutral,
    riskWatch: config.riskWatch,
    severeCrisis: config.severeCrisis,
    strongTrim: config.strongTrim,
    weakRed: config.weakRed,
  };
}

function exposureForConfig(row, config) {
  return targetPortfolioExposure(
    row.portfolioScore,
    row.portfolioAction,
    row.portfolioConfidence,
    crisisModeFromRow(row),
    config,
    row.portfolioUpProbability,
    row.portfolioDownProbability,
    row.portfolioRegime,
  );
}

function crisisModeFromRow(row) {
  const severity = row.portfolioCrisisMode || "normal";
  return {
    active: severity !== "normal",
    severity,
    shock: Number(row.portfolioCrisisShock) === 1,
    tailRisk: Number(row.portfolioCrisisTailRisk) === 1,
  };
}

function summarizeTunedConfigCounts(folds) {
  const counts = new Map();
  for (const fold of folds) {
    const key = JSON.stringify(fold.tunedConfig);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([config, count]) => ({ config: JSON.parse(config), count }))
    .sort((a, b) => b.count - a.count);
}

function summarizeEntryModes(rows) {
  const returnFieldByMode = {
    close: "closeToCloseReturn",
    nextClose: "nextCloseReturn",
    nextOpen: "nextOpenReturn",
  };
  return Object.fromEntries(
    ENTRY_MODES.map((mode) => {
      const modeRows = rows.filter((row) => Number.isFinite(row[returnFieldByMode[mode]]));
      const dailyReturns = modeRows.map((row) => row[returnFieldByMode[mode]] / 100);
      const portfolioExposure = modeRows.map((row) => Number(row.portfolioExposure));
      const portfolioFixedExposure = modeRows.map((row) => Number(row.portfolioFixedExposure));
      const marketExposure = modeRows.map((row) => Number(row.marketExposure));
      return [
        mode,
        {
          benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1), 0),
          firstDate: modeRows[0]?.date || null,
          lastDate: modeRows.at(-1)?.date || null,
          marketSignal: summarizeCurve(dailyReturns, marketExposure, TRANSACTION_COST_BPS),
          observations: modeRows.length,
          portfolioSignal: summarizeCurve(dailyReturns, portfolioExposure, TRANSACTION_COST_BPS),
          portfolioSignalFixedExposure: summarizeCurve(
            dailyReturns,
            portfolioFixedExposure,
            TRANSACTION_COST_BPS,
          ),
        },
      ];
    }),
  );
}

function performanceMetrics(dailyReturns, maxDrawdown, strategyTrials) {
  const returns = dailyReturns.filter(Number.isFinite);
  if (returns.length < 2) {
    return {
      annualReturn: null,
      annualVolatility: null,
      calmar: null,
      deflatedSharpeProbability: null,
      probabilisticSharpeRatio: null,
      sharpe: null,
      sortino: null,
      winRate: null,
    };
  }

  const mean = average(returns);
  const volatility = standardDeviation(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length
    ? Math.sqrt(average(downside.map((value) => value ** 2)))
    : NaN;
  const cumulative = returns.reduce((equity, value) => equity * (1 + value), 1);
  const annualReturn = cumulative > 0
    ? cumulative ** (252 / returns.length) - 1
    : NaN;
  const annualVolatility = Number.isFinite(volatility) ? volatility * Math.sqrt(252) : NaN;
  const sharpe = annualVolatility ? (mean * 252) / annualVolatility : NaN;
  const sortino = downsideDeviation ? (mean * 252) / (downsideDeviation * Math.sqrt(252)) : NaN;
  const calmar = Number.isFinite(annualReturn) && maxDrawdown < 0
    ? annualReturn / Math.abs(maxDrawdown)
    : NaN;

  return {
    annualReturn: round(annualReturn * 100, 2),
    annualVolatility: round(annualVolatility * 100, 2),
    calmar: round(calmar, 2),
    deflatedSharpeProbability: round(
      deflatedSharpeProbability(returns, strategyTrials) * 100,
      1,
    ),
    probabilisticSharpeRatio: round(
      probabilisticSharpeRatio(returns, 0) * 100,
      1,
    ),
    sharpe: round(sharpe, 2),
    sortino: round(sortino, 2),
    winRate: round(
      (returns.filter((value) => value > 0).length / returns.length) * 100,
      1,
    ),
  };
}

function probabilisticSharpeRatio(returns, benchmarkSharpe = 0) {
  const clean = returns.filter(Number.isFinite);
  if (clean.length < 3) return NaN;
  const sr = sharpeRatio(clean);
  const skew = skewness(clean);
  const kurt = kurtosis(clean);
  const denominator = Math.sqrt(
    Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr ** 2),
  );
  const z = ((sr - benchmarkSharpe) * Math.sqrt(clean.length - 1)) / denominator;
  return normalCdf(z);
}

function deflatedSharpeProbability(returns, strategyTrials) {
  const clean = returns.filter(Number.isFinite);
  if (clean.length < 3) return NaN;
  const sr = sharpeRatio(clean);
  const skew = skewness(clean);
  const kurt = kurtosis(clean);
  const srStdError = Math.sqrt(
    Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr ** 2) /
      (clean.length - 1),
  );
  const benchmarkSharpe = expectedMaxZ(strategyTrials) * srStdError;
  return probabilisticSharpeRatio(clean, benchmarkSharpe);
}

function sharpeRatio(returns) {
  const mean = average(returns);
  const volatility = standardDeviation(returns);
  return volatility ? (mean / volatility) * Math.sqrt(252) : NaN;
}

function skewness(values) {
  const clean = values.filter(Number.isFinite);
  const mean = average(clean);
  const sd = standardDeviation(clean);
  if (!sd) return 0;
  return average(clean.map((value) => ((value - mean) / sd) ** 3));
}

function kurtosis(values) {
  const clean = values.filter(Number.isFinite);
  const mean = average(clean);
  const sd = standardDeviation(clean);
  if (!sd) return 3;
  return average(clean.map((value) => ((value - mean) / sd) ** 4));
}

function expectedMaxZ(strategyTrials) {
  const trials = Math.max(1, Number(strategyTrials) || 1);
  if (trials <= 1) return 0;
  const eulerGamma = 0.5772156649;
  return (
    (1 - eulerGamma) * inverseNormalCdf(1 - 1 / trials) +
    eulerGamma * inverseNormalCdf(1 - 1 / (trials * Math.E))
  );
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x));
  return sign * y;
}

function inverseNormalCdf(probability) {
  const p = clamp(probability, 1e-12, 1 - 1e-12);
  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
    q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function groupRows(rows, keyForRow) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyForRow(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function periodLabel(rows) {
  return rows.length ? `${rows[0].date}..${rows.at(-1).date}` : null;
}

function actionExposureForPortfolio(action) {
  if (action === "상승") return 1;
  if (action === "하락") return 0.2;
  return 0.6;
}

function actionExposureForMarket(action) {
  if (action === "상승") return 1;
  if (action === "하락") return 0.2;
  return 0.6;
}

function targetPortfolioExposure(
  score,
  action,
  confidence = "",
  crisisMode = null,
  config = DEFAULT_PORTFOLIO_EXPOSURE_CONFIG,
  upProbability = NaN,
  downProbability = NaN,
  regime = "",
) {
  const cleanScore = Number(score);
  if (!Number.isFinite(cleanScore)) return actionExposureForPortfolio(action);
  let exposure = 1;
  if (confidence === "약한 빨간색") exposure = config.weakRed;
  else if (confidence === "위험 경계") exposure = config.riskWatch;
  else if (confidence === "중립") exposure = config.neutral;
  else if (action === "하락") exposure = config.strongTrim;

  if (crisisMode?.tailRisk) {
    const crisisExposure =
      crisisMode.severity === "severe" ? config.severeCrisis : config.crisis;
    const crisisCap =
      crisisMode.severity === "severe" ? config.severeCrisis : config.crisisCap;
    if (action === "하락" || confidence.includes("빨간색")) {
      return Math.min(exposure, crisisExposure);
    }
    return Math.min(exposure, crisisCap);
  }
  return applyProbabilityExposureCap(
    exposure,
    action,
    upProbability,
    downProbability,
    regime,
  );
}

function applyProbabilityExposureCap(
  exposure,
  action,
  upProbability,
  downProbability,
  regime,
) {
  let adjusted = exposure;
  const up = Number(upProbability);
  const down = Number(downProbability);
  if (action === "상승" && Number.isFinite(up) && up < 70) {
    adjusted = Math.min(adjusted, 0.95);
  }
  if (action === "중립") {
    if (regime === "ratePressure") adjusted = Math.min(adjusted, 0.9);
    if (Number.isFinite(up) && up < 60) adjusted = Math.min(adjusted, 0.85);
    if (Number.isFinite(down) && down >= 65) adjusted = Math.min(adjusted, 0.75);
  }
  if (action === "하락" && Number.isFinite(down) && down >= 65) {
    adjusted = Math.min(adjusted, 0.5);
  }
  return adjusted;
}

function detectPortfolioCrisisMode(quotes, sentiment) {
  const vixLevel = Number(sentiment?.vix?.close);
  const vixChange = Number(sentiment?.vix?.change);
  const vixTrend = trendPercent(sentiment?.vix?.series || sentiment?.vix?.analysisSeries);
  const spreadLevel = Number(quotes?.hySpread?.price);
  const spreadMove = pointChangeOverPeriod(
    quotes?.hySpread?.analysisHistory || quotes?.hySpread?.history,
    63,
  );
  const nasdaqBelow200 = isBelowMovingAverage(quotes?.nasdaq, 200);
  const soxBelow200 = isBelowMovingAverage(quotes?.sox, 200);
  const riskMove = average([
    Number(quotes?.sox?.changePercent),
    Number(quotes?.nasdaq?.changePercent),
    Number(quotes?.kospi?.changePercent),
  ]);
  const vixStress =
    vixLevel >= 32 ||
    (vixLevel >= 28 && vixChange >= 3) ||
    (vixLevel >= 25 && vixTrend >= 20);
  const spreadStress = spreadLevel >= 5.5 || spreadMove >= 0.5;
  const trendStress = nasdaqBelow200 || soxBelow200;
  const active =
    (vixStress && spreadStress && trendStress) ||
    (vixLevel >= 35 && trendStress) ||
    (spreadLevel >= 7 && vixLevel >= 25);
  const severe =
    active &&
    ((vixLevel >= 35 && spreadLevel >= 6) ||
      (vixLevel >= 32 && spreadStress && nasdaqBelow200 && soxBelow200));
  const shock =
    active &&
    ((Number.isFinite(vixChange) &&
      Number.isFinite(riskMove) &&
      vixChange >= 5 &&
      riskMove <= -1) ||
      (Number.isFinite(vixChange) &&
        Number.isFinite(riskMove) &&
        vixChange >= 2 &&
        riskMove <= -3.5));
  const tailRisk =
    active &&
    ((vixLevel >= 40 && spreadLevel >= 6.5 && trendStress) ||
      (vixLevel >= 35 && spreadLevel >= 7 && nasdaqBelow200 && soxBelow200));

  return {
    active,
    nasdaqBelow200,
    score: [vixStress, spreadStress, nasdaqBelow200, soxBelow200].filter(Boolean).length,
    shock,
    severity: severe ? "severe" : active ? "elevated" : "normal",
    soxBelow200,
    spreadLevel: round(spreadLevel, 2),
    spreadMove: round(spreadMove, 2),
    tailRisk,
    vixLevel: round(vixLevel, 2),
  };
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

function scoreVarianceRiskPremium(quotes, sentiment) {
  const vix = Number(sentiment?.vix?.close);
  const realizedVol = realizedVolatility(quotes?.sp500?.analysisHistory || quotes?.sp500?.history, 22);
  if (!Number.isFinite(vix) || !Number.isFinite(realizedVol)) return NaN;

  const premium = vix - realizedVol;
  let score = 0;
  if (premium < 2) score = 0.35;
  else if (premium < 6) score = 0.1;
  else if (premium < 12) score = -0.25;
  else score = -0.65;

  const vixChange = Number(sentiment?.vix?.change);
  if (vixChange <= -2) score += 0.15;
  if (vixChange >= 2) score -= 0.15;
  return clamp(score, -1, 1);
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

function scoreMarketBreadth(quotes) {
  return average([
    scoreRelativeBreadth(quotes?.nasdaqBreadth),
    scoreRelativeBreadth(quotes?.sp500Breadth),
    scoreRelativeBreadth(quotes?.semiLeadership),
    scoreSemiconductorBreadth(quotes?.semiBreadth),
  ]);
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
  return clamp(score, -1, 1);
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
  return average([scoreHySpread(quotes?.hySpread)]);
}

function scoreShortTermEventImpulse(quotes, sentiment) {
  const signals = [];
  const add = (value, weight) => {
    if (!Number.isFinite(value)) return;
    signals.push({ value, weight });
  };

  const nasdaqFutureChange = Number(quotes?.nasdaqFutures?.changePercent);
  if (nasdaqFutureChange >= 1.5) add(1, 1.35);
  else if (nasdaqFutureChange >= 0.8) add(0.7, 1.35);
  else if (nasdaqFutureChange >= 0.35) add(0.35, 1.35);
  else if (nasdaqFutureChange <= -1) add(-0.7, 1.35);

  const spFutureChange = Number(quotes?.sp500Futures?.changePercent);
  if (spFutureChange >= 1.2) add(0.85, 1);
  else if (spFutureChange >= 0.6) add(0.55, 1);
  else if (spFutureChange >= 0.25) add(0.25, 1);
  else if (spFutureChange <= -0.8) add(-0.55, 1);

  const nikkeiChange = Number(quotes?.nikkei?.changePercent);
  if (nikkeiChange >= 2) add(0.85, 1);
  else if (nikkeiChange >= 1.2) add(0.55, 1);
  else if (nikkeiChange <= -1) add(-0.45, 1);

  const oilChange = Number(quotes?.wti?.changePercent);
  if (oilChange <= -3) add(0.75, 0.8);
  else if (oilChange <= -1.2) add(0.35, 0.8);
  else if (oilChange >= 2) add(-0.45, 0.8);

  const vixChange = Number(sentiment?.vix?.change);
  const vixLevel = Number(sentiment?.vix?.close);
  if (Number.isFinite(vixChange) && Number.isFinite(vixLevel)) {
    if (vixChange <= -2 || (vixChange <= 0 && vixLevel < 22)) add(0.35, 0.55);
    else if (vixChange >= 2 || vixLevel >= 28) add(-0.45, 0.55);
  }

  const usdKrwChange = Number(quotes?.usdKrw?.changePercent);
  if (usdKrwChange <= -0.3) add(0.25, 0.45);
  else if (usdKrwChange >= 0.6) add(-0.3, 0.45);

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (!totalWeight) return NaN;
  const score =
    signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) /
    totalWeight;
  return Math.abs(score) >= 0.2 ? clamp(score, -1, 1) : NaN;
}

function scoreGeopoliticalRelief(quotes, sentiment) {
  const signals = [];
  const add = (value, weight) => {
    if (!Number.isFinite(value)) return;
    signals.push({ value, weight });
  };

  const nikkeiChange = Number(quotes?.nikkei?.changePercent);
  if (nikkeiChange >= 1.5) add(1, 1.15);
  else if (nikkeiChange >= 0.7) add(0.45, 1.15);
  else if (nikkeiChange <= -1) add(-0.45, 1.15);

  const oilChange = Number(quotes?.wti?.changePercent);
  const oilTrend = trendPercent(quotes?.wti?.history);
  if (oilChange <= -2) add(0.9, 1);
  else if (oilChange <= -0.7 || oilTrend <= -4) add(0.45, 1);
  else if (oilChange >= 2 || oilTrend >= 5) add(-0.55, 1);

  const vixChange = Number(sentiment?.vix?.change);
  const vixLevel = Number(sentiment?.vix?.close);
  if (Number.isFinite(vixChange) && Number.isFinite(vixLevel)) {
    if (vixChange <= -1 || (vixChange <= 0 && vixLevel < 22)) add(0.6, 0.85);
    else if (vixChange >= 2) add(-0.6, 0.85);
  }

  const usdKrwChange = Number(quotes?.usdKrw?.changePercent);
  if (usdKrwChange <= -0.25) add(0.45, 0.75);
  else if (usdKrwChange <= 0.3) add(0.2, 0.75);
  else if (usdKrwChange >= 0.7) add(-0.55, 0.75);

  const semiRisk = average([
    Number(quotes?.sox?.changePercent),
    Number(quotes?.semiLeadership?.changePercent),
    Number(quotes?.nasdaq?.changePercent),
  ]);
  if (semiRisk >= 1) add(0.75, 0.8);
  else if (semiRisk >= 0.35) add(0.35, 0.8);
  else if (semiRisk <= -1) add(-0.45, 0.8);

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (!totalWeight) return NaN;
  const score =
    signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) /
    totalWeight;
  return Math.abs(score) >= 0.18 ? clamp(score, -1, 1) : NaN;
}

function scoreRecoveryPulse(quotes, sentiment, portfolioMetrics = null) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ score: clamp(score, -1, 1), weight });
  };

  add(scoreVixRelief(sentiment?.vix), 1.2);
  add(scoreCapitulationRelief(quotes, sentiment), 0.75);
  add(scoreGeopoliticalRelief(quotes, sentiment), 0.65);
  add(scoreShortTermEventImpulse(quotes, sentiment), 0.45);
  add(scoreRiskAsset(quotes?.sox), 1.1);
  add(scoreRiskAsset(quotes?.nasdaq), 0.95);
  add(scoreRiskAsset(quotes?.sp500), 0.55);
  add(scoreRiskAsset(quotes?.kospi), 0.35);
  add(scoreMarketRegime(quotes), 0.65);

  if (portfolioMetrics) {
    add(scorePortfolioRelativeStrength(portfolioMetrics, quotes), 0.65);
    add(scorePortfolioMovingAverage(portfolioMetrics), 0.45);
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return NaN;
  return components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
}

function scoreVixRelief(data) {
  const value = Number(data?.close);
  const trend = trendPercent(data?.series);
  if (!Number.isFinite(value) || !Number.isFinite(trend)) return NaN;

  let score = 0;
  if (trend <= -15) score = 0.9;
  else if (trend <= -7) score = 0.55;
  else if (trend <= 2) score = 0.1;
  else if (trend <= 10) score = -0.35;
  else score = -0.8;

  if (value < 22 && trend <= 0) score += 0.1;
  if (value >= 32 && trend > -10) score -= 0.2;
  const daily = Number(data.change);
  if (daily <= -4) score += 0.35;
  else if (daily <= -2) score += 0.25;
  else if (daily >= 5) score -= 0.35;
  else if (daily >= 3) score -= 0.25;
  return clamp(score, -1, 1);
}

function scoreCapitulationRelief(quotes, sentiment) {
  const fear = Number(sentiment?.fearGreed?.score);
  const vix = Number(sentiment?.vix?.close);
  if (!Number.isFinite(fear) || !Number.isFinite(vix) || vix < 25 || fear > 35) {
    return NaN;
  }

  const vixChange = Number(sentiment?.vix?.change);
  const dailyRisk = average([
    Number(quotes?.sox?.changePercent),
    Number(quotes?.nasdaq?.changePercent),
    Number(quotes?.kospi?.changePercent),
  ]);

  let score = vix >= 30 && fear <= 25 ? -0.25 : -0.05;
  if (Number.isFinite(vixChange) && vixChange <= -3) score += 0.55;
  else if (Number.isFinite(vixChange) && vixChange <= -1.5) score += 0.35;
  if (Number.isFinite(dailyRisk) && dailyRisk >= 1) score += 0.35;
  else if (Number.isFinite(dailyRisk) && dailyRisk >= 0.3) score += 0.2;
  if (
    vix >= 32 &&
    Number.isFinite(vixChange) &&
    vixChange >= 3 &&
    Number.isFinite(dailyRisk) &&
    dailyRisk <= -1
  ) {
    score -= 0.55;
  }
  return clamp(score, -1, 1);
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

function scorePortfolioRelativeStrength(portfolioMetrics, quotes) {
  return weightedPortfolioScore(portfolioMetrics, (holding) => {
    const ownTrend = Number(holding.trend28);
    const benchmarkTrend = trendPercent(quotes?.[holding.benchmark]?.history);
    if (!Number.isFinite(ownTrend) || !Number.isFinite(benchmarkTrend)) return NaN;
    const spread = ownTrend - benchmarkTrend;
    if (spread >= 8) return 0.9;
    if (spread >= 3) return 0.55;
    if (spread > -3) return 0.05;
    if (spread > -8) return -0.55;
    return -0.9;
  });
}

function scorePortfolioMultiPeriodRelativeStrength(portfolioMetrics, quotes) {
  return weightedPortfolioScore(portfolioMetrics, (holding) =>
    scoreRelativeMomentum(
      { analysisHistory: holding.analysisHistory, history: holding.history },
      quotes?.[holding.benchmark],
    ),
  );
}

function scorePortfolioMovingAverage(portfolioMetrics) {
  return weightedPortfolioScore(portfolioMetrics, (holding) => {
    const price = Number(holding.latestClose);
    const ma50 = Number(holding.ma50);
    const ma200 = Number(holding.ma200);
    if (!Number.isFinite(price) || !Number.isFinite(ma50)) return NaN;
    if (Number.isFinite(ma200)) {
      if (price > ma50 && price > ma200 && ma50 > ma200) return 0.9;
      if (price > ma50 && price > ma200) return 0.55;
      if (price > ma50) return 0.2;
      if (price < ma200) return -0.8;
      return -0.35;
    }
    return price > ma50 ? 0.35 : -0.35;
  });
}

function scorePortfolioHighProximity(portfolioMetrics) {
  return weightedPortfolioScore(portfolioMetrics, (holding) => {
    const proximity = Number(holding.highProximity);
    if (!Number.isFinite(proximity)) return NaN;
    if (proximity >= 97) return 0.85;
    if (proximity >= 92) return 0.55;
    if (proximity >= 85) return 0.15;
    if (proximity >= 75) return -0.35;
    return -0.75;
  });
}

function weightedPortfolioScore(portfolioMetrics, scoreForHolding) {
  const holdings = portfolioMetrics?.holdings || [];
  const totalAmount = Number(portfolioMetrics?.totalAmount) || PORTFOLIO_TOTAL;
  let weighted = 0;
  let weight = 0;
  for (const holding of holdings) {
    const score = scoreForHolding(holding);
    const holdingWeight = totalAmount ? Number(holding.amount) / totalAmount : 0;
    if (!Number.isFinite(score) || !Number.isFinite(holdingWeight)) continue;
    weighted += clamp(score, -1, 1) * holdingWeight;
    weight += holdingWeight;
  }
  return weight ? weighted / weight : NaN;
}

function scoreTrendPercent(percent) {
  if (percent >= 4) return 0.85;
  if (percent >= 1) return 0.45;
  if (percent > -1) return 0.05;
  if (percent > -4) return -0.45;
  return -0.85;
}

function weightedScore(components) {
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const total = components.reduce((sum, item) => sum + item.weighted, 0);
  return totalWeight ? Math.round((total / totalWeight) * 100) : 0;
}

function signalConfidence(action, score) {
  const value = Math.abs(Number(score));
  if (action === "상승") {
    return value >= 45 ? "강한 녹색" : "약한 녹색";
  }
  if (action === "하락") {
    return value >= 55 ? "강한 빨간색" : "약한 빨간색";
  }
  if (value <= 12) return "중립";
  return score > 0 ? "녹색 대기" : "위험 경계";
}

function historyAsOf(rows, date) {
  return rows.filter((row) => row.date <= date);
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

function realizedVolatility(series, period) {
  const points = numericSeries(series).slice(-(period + 1));
  if (points.length < period + 1) return NaN;
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1] > 0 && points[index] > 0) {
      returns.push(Math.log(points[index] / points[index - 1]));
    }
  }
  if (returns.length < period) return NaN;
  return standardDeviation(returns) * Math.sqrt(252) * 100;
}

function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return NaN;
  const mean = average(clean);
  const variance = average(clean.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function pointChange(series) {
  const points = numericSeries(series);
  if (points.length < 2) return NaN;
  return points.at(-1) - points[0];
}

function pointChangeOverPeriod(series, period) {
  const points = numericSeries(series);
  if (points.length < 2) return NaN;
  const windowPoints = points.slice(-Math.min(period + 1, points.length));
  return windowPoints.at(-1) - windowPoints[0];
}

function isBelowMovingAverage(quote, period) {
  const points = numericSeries(quote?.analysisHistory || quote?.history);
  if (points.length < period) return false;
  const latest = points.at(-1);
  const movingAverageValue = average(points.slice(-period));
  return Number.isFinite(latest) &&
    Number.isFinite(movingAverageValue) &&
    latest < movingAverageValue;
}

function numericSeries(series) {
  return (series || [])
    .map((point) => Number(point.value))
    .filter((value) => Number.isFinite(value));
}

function movingAverage(values, period) {
  if (values.length < period) return NaN;
  return average(values.slice(-period));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return NaN;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getFearGreedRating(score) {
  if (score < 25) return "extreme fear";
  if (score < 45) return "fear";
  if (score < 55) return "neutral";
  if (score < 75) return "greed";
  return "extreme greed";
}

function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values.map((item) => item.trim());
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url, "application/json,text/plain,*/*"));
}

function fetchText(url, accept = "text/csv,text/plain,*/*") {
  return fetch(url, {
    headers: { Accept: accept, "User-Agent": "Mozilla/5.0" },
  }).then((response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
    return response.text();
  });
}

function fetchBinary(url, accept = "application/octet-stream,*/*") {
  return fetch(url, {
    headers: { Accept: accept, "User-Agent": "Mozilla/5.0" },
  }).then((response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
    return response.arrayBuffer();
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function toIsoDate(usDate) {
  const [month, day, year] = String(usDate || "").split("/");
  if (!month || !day || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeEntryMode(value) {
  const normalized = String(value || "").trim();
  if (["close", "nextOpen", "nextClose"].includes(normalized)) return normalized;
  if (normalized === "next-open") return "nextOpen";
  if (normalized === "next-close") return "nextClose";
  return "nextOpen";
}

function normalizeForwardHorizons(value, fallback) {
  const raw = String(value || "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);
  return [...new Set(raw.length ? raw : fallback)].sort((a, b) => a - b);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function rate(count, total) {
  return total ? round((count / total) * 100, 1) : null;
}

async function writeFile(filePath, contents) {
  const { writeFile: writeFileNode } = await import("node:fs/promises");
  await writeFileNode(filePath, contents);
}

function toCsv(rows) {
  const headers = [
    "date",
    "portfolioAction",
    "portfolioConfidence",
    "portfolioUpProbability",
    "portfolioDownProbability",
    "portfolioRegime",
    "portfolioExposure",
    "portfolioFixedExposure",
    "portfolioScore",
    "portfolioCrisisMode",
    "portfolioCrisisScore",
    "portfolioCrisisShock",
    "portfolioCrisisTailRisk",
    "portfolioCoverage",
    "portfolioRecoveryScore",
    "marketAction",
    "marketConfidence",
    "marketUpProbability",
    "marketDownProbability",
    "marketRegime",
    "marketExposure",
    "marketScore",
    "marketRecoveryScore",
    "closeToCloseReturn",
    "nextOpenReturn",
    "nextCloseReturn",
    "nextDayReturn",
    "strategyReturn",
    ...FORWARD_HORIZONS.map((horizon) => `forwardReturn${horizon}d`),
  ];
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header] ?? "")).join(","),
    ),
  ].join("\n");
}

function csvEscape(value) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function printSummary(summary, outStem) {
  console.log(`observations: ${summary.observations}`);
  console.log(
    `tested range: ${summary.firstDate}..${summary.lastDate} / avg coverage ${summary.averagePortfolioCoverage}%`,
  );
  console.log(`entry mode: ${summary.entryMode}`);
  console.log(`benchmark total return: ${summary.benchmark.totalReturn}%`);
  console.log(
    `portfolio-signal gross/net return: ${summary.portfolioSignal.curve.totalReturn}% / ${summary.portfolioSignal.curve.netTotalReturn}% / net max DD ${summary.portfolioSignal.curve.netMaxDrawdown}%`,
  );
  console.log(
    `portfolio fixed-exposure net return: ${summary.portfolioSignal.fixedExposureCurve.netTotalReturn}%`,
  );
  console.log(
    `market-signal gross/net return: ${summary.marketSignal.curve.totalReturn}% / ${summary.marketSignal.curve.netTotalReturn}% / net max DD ${summary.marketSignal.curve.netMaxDrawdown}%`,
  );
  console.log("portfolio net metrics:", summary.portfolioSignal.curve.netMetrics);
  console.log("entry mode comparison:", summary.entryModeComparison);
  console.log(`transaction cost: ${summary.transactionCostBps} bps per exposure change`);
  console.log("walk-forward aggregate:", summary.walkForward.validationAggregate);
  console.log("walk-forward tuned aggregate:", summary.walkForward.tunedValidationAggregate);
  console.log("walk-forward tuned config counts:", summary.walkForward.tunedConfigCounts);
  console.log(
    "portfolio next-week probability table:",
    summary.portfolioSignal.predictionStats.nextWeek?.byProbabilityThreshold,
  );
  console.log(
    "market next-week probability table:",
    summary.marketSignal.predictionStats.nextWeek?.byProbabilityThreshold,
  );
  console.log("portfolio buckets:", summary.portfolioSignal.actionBuckets);
  console.log("market buckets:", summary.marketSignal.actionBuckets);
  console.log(`saved: ${outStem}.json, ${outStem}.csv`);
}
