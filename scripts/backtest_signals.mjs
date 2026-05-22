const START_DATE = process.argv[2] || "2025-01-01";
const END_DATE = process.argv[3] || new Date().toISOString().slice(0, 10);
const HORIZON_DAYS = Number(process.env.BACKTEST_HORIZON_DAYS || process.argv[4] || 20);
const MIN_COVERAGE = Number(process.env.BACKTEST_MIN_COVERAGE || process.argv[5] || 0.7);
const TRANSACTION_COST_BPS = Number(
  process.env.BACKTEST_TRANSACTION_COST_BPS || process.argv[6] || 10,
);
const TREND_POINTS = 28;
const ANALYSIS_POINTS = 260;
const FORWARD_HORIZONS = [...new Set([5, HORIZON_DAYS, 60])].sort((a, b) => a - b);

const MARKET_SOURCES = [
  { id: "kospi", symbol: "^KS11" },
  { id: "sp500", symbol: "^GSPC" },
  { id: "nasdaq", symbol: "^IXIC" },
  { id: "sox", symbol: "^SOX" },
  { id: "usdKrw", symbol: "KRW=X" },
  { id: "wti", symbol: "CL=F" },
  { id: "us10y", symbol: "^TNX" },
];
const FRED_SOURCES = [
  { id: "hySpread", seriesId: "BAMLH0A0HYM2" },
  { id: "nfci", seriesId: "NFCI" },
];
const SENTIMENT_SOURCES = {
  fearGreed:
    "https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv",
  vix: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
};
const PORTFOLIO_HOLDINGS = [
  { amount: 30041571, benchmark: "kospi", code: "395270", id: "hanaroSemi", name: "HANARO Fn K-반도체" },
  { amount: 30003498, benchmark: "kospi", code: "487240", id: "kodexAiPower", name: "KODEX AI전력핵심설비" },
  { amount: 15064300, benchmark: "sox", code: "442580", id: "plusGlobalHbm", name: "PLUS 글로벌HBM반도체" },
  { amount: 15032675, benchmark: "sox", code: "381180", id: "tigerSox", name: "TIGER 미국필라델피아반도체나스닥" },
  { amount: 15005736, benchmark: "kospi", code: "0162Z0", id: "riseSamsungHynixBond", name: "RISE 삼성전자SK하이닉스채권혼합50" },
  { amount: 15005730, benchmark: "nasdaq", code: "0019K0", id: "timeNasdaqBond", name: "TIME 미국나스닥100채권혼합50액티브" },
  { amount: 15002399, benchmark: "kospi", code: "284430", id: "kodex200Treasury", name: "KODEX 200미국채혼합" },
  { amount: 10010605, benchmark: "nasdaq", code: "456600", id: "timeGlobalAi", name: "TIME 글로벌AI인공지능액티브" },
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
    transactionCostBps: TRANSACTION_COST_BPS,
  },
  assumptions: [
    "DDR5 spot, server DRAM contract, DXI, and historical foreign/institution flow are excluded where full historical public data is unavailable.",
    "Portfolio strategy exposure: split buy/new buy = 100%, hold = 60%, trim/sell = 20%.",
    "Transaction costs are charged when exposure changes, including initial entry exposure.",
    "A recovery-pulse overlay reduces false sell/trim signals when volatility is cooling and risk assets are confirming a rebound.",
    "VIX minus 22-day realized S&P 500 volatility is used as a variance-risk-premium proxy.",
    "Market and portfolio momentum are scored across 1, 3, 6, and 12 month windows.",
    "Backtest dates use the KOSPI trading calendar because the portfolio holdings are Korea-listed ETFs.",
    "Forward-return buckets use current portfolio weights and available ETF prices on each date.",
  ],
  summary,
  rows,
};

const coverageLabel = `cov${Math.round(MIN_COVERAGE * 100)}`;
const outStem = `screen_results/backtest_signals_${START_DATE}_${END_DATE}_${coverageLabel}`;
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
        portfolioForwardReturn(date, portfolioHistories, horizon),
      ]),
    );
    const nextDay = portfolioForwardReturn(date, portfolioHistories, 1);
    const forwardValues = Object.values(forwards);

    if (
      !Number.isFinite(nextDay.return) ||
      nextDay.coverage < MIN_COVERAGE ||
      forwardValues.some(
        (forward) =>
          !Number.isFinite(forward.return) || forward.coverage < MIN_COVERAGE,
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
      marketExposure: exposureForMarket(marketSignal.action),
      marketRecoveryScore: marketSignal.recoveryScore,
      marketScore: marketSignal.score,
      nextDayReturn: round(nextDay.return, 4),
      portfolioAction: portfolioSignal.action,
      portfolioConfidence: portfolioSignal.confidence,
      portfolioCoverage: round(
        Math.min(nextDay.coverage, ...forwardValues.map((forward) => forward.coverage)) * 100,
        1,
      ),
      portfolioExposure: exposureForPortfolio(portfolioSignal.action),
      portfolioRecoveryScore: portfolioSignal.recoveryScore,
      portfolioScore: portfolioSignal.score,
    });
  }

  return rows;
}

function buildQuotesAsOf(date, marketHistories, fredHistories) {
  const quote = (id, histories = marketHistories) =>
    buildQuoteFromHistory(historyAsOf(histories[id] || [], date));
  return {
    kospi: quote("kospi"),
    sp500: quote("sp500"),
    nasdaq: quote("nasdaq"),
    sox: quote("sox"),
    usdKrw: quote("usdKrw"),
    wti: quote("wti"),
    us10y: quote("us10y"),
    hySpread: quote("hySpread", fredHistories),
    nfci: quote("nfci", fredHistories),
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
      return {
        ...holding,
        latestClose: latest?.value ?? null,
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

function portfolioForwardReturn(date, portfolioHistories, horizon) {
  let weighted = 0;
  let weight = 0;
  for (const holding of Object.values(portfolioHistories)) {
    const index = holding.history.findIndex((row) => row.date >= date);
    if (index === 0 && holding.history[index]?.date > date) continue;
    if (index < 0 || index + horizon >= holding.history.length) continue;
    const start = holding.history[index].value;
    const end = holding.history[index + horizon].value;
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
  add(broadScore, 2.1);
  add(scoreRiskAsset(quotes.sox), 1.3);
  add(scoreFearGreed(sentiment.fearGreed), 1.15);
  add(scoreVix(sentiment.vix), 1.45);
  add(scoreYield(quotes.us10y), 0.85);
  add(scoreUsdKrw(quotes.usdKrw), 0.65);
  add(scoreWti(quotes.wti), 0.45);
  add(scoreMarketRegime(quotes), 1.25);
  const recoveryScore = scoreRecoveryPulse(quotes, sentiment);
  add(recoveryScore, 0.75);

  const score = weightedScore(components);
  const vixLevel = Number(sentiment.vix?.close);
  const hasRecovery = Number.isFinite(recoveryScore) && recoveryScore >= 0.35;
  const recoveryForAction = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  let action = "홀딩";
  if (
    (vixLevel >= 35 && recoveryForAction < -0.5) ||
    score <= -55 ||
    (score <= -32 && recoveryForAction < -0.45) ||
    (score <= -22 && recoveryForAction < -0.65)
  ) {
    action = "매도";
  } else if (score >= 25 && broadScore > 0 && vixLevel < 28 && (hasRecovery || vixLevel < 25)) {
    action = "신규 매수";
  }
  return {
    action,
    confidence: signalConfidence(action, score),
    recoveryScore: round(recoveryScore, 4),
    score,
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
  const variancePremiumScore = scoreVarianceRiskPremium(quotes, sentiment);

  add(semiScore, 2.4);
  add(nasdaqScore, 1.25);
  add(scoreRiskAsset(quotes.kospi), 0.75);
  add(relativeScore, 1.35);
  add(multiRelativeScore, 1.1);
  add(movingAverageScore, 1.15);
  add(regimeScore, 1.35);
  add(semiconductorCycleScore, 1.25);
  add(rateScore, 1.2);
  add(scoreUsdKrw(quotes.usdKrw), 0.85);
  add(scoreVix(sentiment.vix), 1.05);
  add(variancePremiumScore, 0.85);
  add(scoreFearGreed(sentiment.fearGreed), 0.65);
  add(scoreWti(quotes.wti), 0.2);
  add(recoveryScore, 0.8);

  let score = weightedScore(components);
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
  score = clamp(Math.round(score), -100, 100);

  let action = "보유";
  if (
    (vixLevel >= 35 && recoveryForAction < -0.5) ||
    score <= -60 ||
    (score <= -35 && recoveryForAction < -0.5) ||
    (score <= -24 && recoveryForAction < -0.65)
  ) {
    action = "비중 축소";
  } else if (
    score >= 30 &&
    semiScore > 0 &&
    semiconductorCycleScore > -0.2 &&
    regimeScore > -0.25 &&
    rateScore > -0.35 &&
    vixLevel < 28 &&
    (!Number.isFinite(variancePremiumScore) || variancePremiumScore > -0.6) &&
    (!Number.isFinite(recoveryScore) || recoveryScore > -0.2)
  ) {
    action = "분할 매수";
  }
  return {
    action,
    confidence: signalConfidence(action, score),
    recoveryScore: round(recoveryScore, 4),
    score,
  };
}

function summarizeBacktest(rows) {
  const dailyReturns = rows.map((row) => row.nextDayReturn / 100);
  const portfolioExposure = rows.map((row) => exposureForPortfolio(row.portfolioAction));
  const marketExposure = rows.map((row) => exposureForMarket(row.marketAction));
  return {
    benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1)),
    firstDate: rows[0]?.date || null,
    lastDate: rows.at(-1)?.date || null,
    marketSignal: {
      actionBuckets: bucketStats(rows, "marketAction"),
      curve: summarizeCurve(dailyReturns, marketExposure, TRANSACTION_COST_BPS),
    },
    observations: rows.length,
    averagePortfolioCoverage: round(
      average(rows.map((row) => Number(row.portfolioCoverage))) || 0,
      1,
    ),
    portfolioSignal: {
      actionBuckets: bucketStats(rows, "portfolioAction"),
      curve: summarizeCurve(dailyReturns, portfolioExposure, TRANSACTION_COST_BPS),
    },
    transactionCostBps: TRANSACTION_COST_BPS,
    yearly: summarizeByYear(rows),
    walkForward: summarizeWalkForward(rows),
  };
}

function bucketStats(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([label, groupRows]) => {
      const nextDayValues = groupRows.map((row) => row.nextDayReturn);
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
          avgNextDay: round(average(nextDayValues), 2),
          count: groupRows.length,
          nextDayWinRate: round(
            (nextDayValues.filter((value) => value > 0).length /
              nextDayValues.length) *
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
  for (let index = 0; index < dailyReturns.length; index += 1) {
    const exposure = Number(exposures[index]) || 0;
    const turnover = Math.abs(exposure - previousExposure);
    const cost = turnover * (transactionCostBps / 10000);
    totalTurnover += turnover;
    equity *= 1 + dailyReturns[index] * exposure;
    netEquity *= Math.max(0, 1 + dailyReturns[index] * exposure - cost);
    peak = Math.max(peak, equity);
    netPeak = Math.max(netPeak, netEquity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    netMaxDrawdown = Math.min(netMaxDrawdown, netEquity / netPeak - 1);
    previousExposure = exposure;
  }
  return {
    averageExposure: round(average(exposures) * 100, 1),
    costDrag: round((equity - netEquity) * 100, 2),
    maxDrawdown: round(maxDrawdown * 100, 2),
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
  for (let index = 1; index < years.length; index += 1) {
    const testYear = years[index];
    const trainRows = rows.filter((row) => row.date.slice(0, 4) < testYear);
    const testRows = rows.filter((row) => row.date.slice(0, 4) === testYear);
    if (!trainRows.length || !testRows.length) continue;
    folds.push({
      testPeriod: periodLabel(testRows),
      testRows: testRows.length,
      testYear,
      trainPeriod: periodLabel(trainRows),
      trainRows: trainRows.length,
      trainSummary: summarizePeriod(trainRows),
      validationSummary: summarizePeriod(testRows),
    });
  }
  const validationRows = folds.flatMap((fold) =>
    rows.filter((row) => row.date.slice(0, 4) === fold.testYear),
  );
  return {
    folds,
    validationAggregate: summarizePeriod(validationRows),
  };
}

function summarizePeriod(rows) {
  const dailyReturns = rows.map((row) => row.nextDayReturn / 100);
  const portfolioExposure = rows.map((row) => exposureForPortfolio(row.portfolioAction));
  const marketExposure = rows.map((row) => exposureForMarket(row.marketAction));
  return {
    benchmark: summarizeCurve(dailyReturns, dailyReturns.map(() => 1)),
    firstDate: rows[0]?.date || null,
    lastDate: rows.at(-1)?.date || null,
    marketSignal: summarizeCurve(dailyReturns, marketExposure, TRANSACTION_COST_BPS),
    observations: rows.length,
    portfolioSignal: summarizeCurve(dailyReturns, portfolioExposure, TRANSACTION_COST_BPS),
  };
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

function exposureForPortfolio(action) {
  if (action === "분할 매수") return 1;
  if (action === "비중 축소") return 0.2;
  return 0.6;
}

function exposureForMarket(action) {
  if (action === "신규 매수") return 1;
  if (action === "매도") return 0.2;
  return 0.6;
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

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
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
  return average([scoreHySpread(quotes?.hySpread), scoreNfci(quotes?.nfci)]);
}

function scoreRecoveryPulse(quotes, sentiment, portfolioMetrics = null) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ score: clamp(score, -1, 1), weight });
  };

  add(scoreVixRelief(sentiment?.vix), 1.2);
  add(scoreCapitulationRelief(quotes, sentiment), 0.75);
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
  if (action === "신규 매수" || action === "분할 매수") {
    return value >= 45 ? "강한 녹색" : "약한 녹색";
  }
  if (action === "매도" || action === "비중 축소") {
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

async function writeFile(filePath, contents) {
  const { writeFile: writeFileNode } = await import("node:fs/promises");
  await writeFileNode(filePath, contents);
}

function toCsv(rows) {
  const headers = [
    "date",
    "portfolioAction",
    "portfolioConfidence",
    "portfolioExposure",
    "portfolioScore",
    "portfolioCoverage",
    "portfolioRecoveryScore",
    "marketAction",
    "marketConfidence",
    "marketExposure",
    "marketScore",
    "marketRecoveryScore",
    "nextDayReturn",
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
  console.log(`benchmark total return: ${summary.benchmark.totalReturn}%`);
  console.log(
    `portfolio-signal gross/net return: ${summary.portfolioSignal.curve.totalReturn}% / ${summary.portfolioSignal.curve.netTotalReturn}% / net max DD ${summary.portfolioSignal.curve.netMaxDrawdown}%`,
  );
  console.log(
    `market-signal gross/net return: ${summary.marketSignal.curve.totalReturn}% / ${summary.marketSignal.curve.netTotalReturn}% / net max DD ${summary.marketSignal.curve.netMaxDrawdown}%`,
  );
  console.log(`transaction cost: ${summary.transactionCostBps} bps per exposure change`);
  console.log("walk-forward aggregate:", summary.walkForward.validationAggregate);
  console.log("portfolio buckets:", summary.portfolioSignal.actionBuckets);
  console.log("market buckets:", summary.marketSignal.actionBuckets);
  console.log(`saved: ${outStem}.json, ${outStem}.csv`);
}
