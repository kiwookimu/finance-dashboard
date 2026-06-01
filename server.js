const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const MARKET_CACHE_MS = 60 * 1000;
const SENTIMENT_CACHE_MS = 15 * 60 * 1000;
const PORTFOLIO_CACHE_MS = 5 * 60 * 1000;
const STOCK_RECOMMENDATION_CACHE_MS = 30 * 60 * 1000;
const STOCK_RECOMMENDATION_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const TREND_POINTS = 28;
const ANALYSIS_POINTS = 260;
const RECOMMENDATION_SCRIPT_START_PERCENT = 8;
const RECOMMENDATION_SCRIPT_DONE_PERCENT = 92;
const RECOMMENDATION_STOP_LOSS_PERCENT = -8;
const RECOMMENDATION_MAX_MONTH_HIGH_DRAWDOWN = -20;
const DOMESTIC_FUNDAMENTAL_SUPPORT_SCORE = 58;
const DOMESTIC_FUNDAMENTAL_CAUTION_SCORE = 45;
const DOMESTIC_STOCK_RECOMMENDATION_VERSION = "kr-rolling-21-v3";
const US_STOCK_RECOMMENDATION_VERSION = "us-rolling-21-v3";
const TRAFFIC_EVENT_LIMIT = 20000;
const TRAFFIC_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const TRAFFIC_VISITOR_SALT = crypto.randomBytes(16).toString("hex");
const NASDAQ_API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
  "User-Agent": "Mozilla/5.0",
};

const MARKET_SOURCES = [
  { id: "kospi", label: "KOSPI", symbol: "^KS11", decimals: 2 },
  { id: "kosdaq", label: "KOSDAQ", symbol: "^KQ11", decimals: 2 },
  { id: "sp500", label: "S&P 500", symbol: "^GSPC", decimals: 2 },
  { id: "nasdaq", label: "NASDAQ", symbol: "^IXIC", decimals: 2 },
  { id: "sox", label: "SOX", symbol: "^SOX", decimals: 2 },
  { id: "nikkei", label: "Nikkei 225", symbol: "^N225", decimals: 2 },
  {
    id: "nasdaqFutures",
    label: "NASDAQ 100 선물",
    symbol: "NQ=F",
    stooqSymbol: "nq.f",
    decimals: 2,
  },
  {
    id: "sp500Futures",
    label: "S&P 500 선물",
    symbol: "ES=F",
    stooqSymbol: "es.f",
    decimals: 2,
  },
  { id: "usdKrw", label: "USD/KRW", symbol: "KRW=X", decimals: 1 },
  { id: "wti", label: "WTI", symbol: "CL=F", stooqSymbol: "cl.f", decimals: 2 },
  {
    id: "us10y",
    label: "미국 10년물 금리",
    symbol: "^TNX",
    decimals: 2,
    valueSuffix: "%",
    changeUnit: "p",
  },
];
const DERIVED_YAHOO_SOURCES = [
  { id: "qqq", label: "Invesco QQQ", symbol: "QQQ", decimals: 2 },
  { id: "qqqe", label: "NASDAQ 100 동일가중", symbol: "QQQE", decimals: 2 },
  { id: "spy", label: "SPDR S&P 500", symbol: "SPY", decimals: 2 },
  { id: "rsp", label: "S&P 500 동일가중", symbol: "RSP", decimals: 2 },
  { id: "smh", label: "VanEck Semiconductor ETF", symbol: "SMH", decimals: 2 },
  { id: "vix3m", label: "VIX 3개월", symbol: "^VIX3M", decimals: 1 },
];
const SEMI_LEADER_SOURCES = [
  { id: "nvda", label: "NVIDIA", symbol: "NVDA", decimals: 2 },
  { id: "avgo", label: "Broadcom", symbol: "AVGO", decimals: 2 },
  { id: "amd", label: "AMD", symbol: "AMD", decimals: 2 },
  { id: "mu", label: "Micron", symbol: "MU", decimals: 2 },
  { id: "tsm", label: "TSMC", symbol: "TSM", decimals: 2 },
  { id: "asml", label: "ASML", symbol: "ASML", decimals: 2 },
  { id: "qcom", label: "Qualcomm", symbol: "QCOM", decimals: 2 },
];
const SENTIMENT_SOURCES = {
  fearGreed:
    "https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv",
  vix: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
};
const TREND_FORCE_SOURCES = {
  ddr5Spot: "https://www.trendforce.com/price/dram/dram_spot",
};
const FRED_SOURCES = [
  {
    id: "hySpread",
    label: "하이일드 스프레드",
    seriesId: "BAMLH0A0HYM2",
    decimals: 2,
    valueSuffix: "%",
    changeUnit: "p",
  },
  {
    id: "nfci",
    label: "금융상황지수 NFCI",
    seriesId: "NFCI",
    decimals: 2,
    changeUnit: "",
  },
];
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
  { amount: 5006750, benchmark: "nasdaq", code: "0183J0", id: "tigerUsSpaceTech", name: "TIGER 미국우주테크", tags: ["space", "us"] },
  { amount: 0, benchmark: "nasdaq", code: "491010", id: "tigerGlobalAiPowerInfra", name: "TIGER 글로벌AI전력인프라액티브", tags: ["aiPower", "global"] },
  { amount: 0, benchmark: "kospi", code: "367760", id: "riseNetworkInfra", name: "RISE 네트워크인프라", tags: ["network", "korea"] },
];

let cachedMarketOverview = null;
let cachedMarketAt = 0;
let marketOverviewRefreshPromise = null;
let cachedSentiment = null;
let cachedSentimentAt = 0;
let cachedPortfolio = null;
let cachedPortfolioAt = 0;
let portfolioRefreshPromise = null;
let cachedStockRecommendations = null;
let cachedStockRecommendationsAt = 0;
let stockRecommendationRefreshPromise = null;
let cachedUsStockRecommendations = null;
let cachedUsStockRecommendationsAt = 0;
let usStockRecommendationRefreshPromise = null;
const trafficEvents = [];
const trafficStartedAt = new Date().toISOString();
const recommendationRefreshProgress = {
  domestic: createRecommendationRefreshProgress("domestic"),
  us: createRecommendationRefreshProgress("us"),
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    trackTraffic(request, response, url);

    if (url.pathname === "/api/health") {
      sendJson(response, { ok: true, service: "finance-dashboard" });
      return;
    }

    if (url.pathname === "/api/traffic") {
      sendJson(response, getTrafficSummary());
      return;
    }

    if (url.pathname === "/api/market-overview") {
      sendJson(response, await getMarketOverview());
      return;
    }

    if (url.pathname === "/api/market-sentiment") {
      sendJson(response, await getMarketSentiment());
      return;
    }

    if (url.pathname === "/api/portfolio-metrics") {
      sendJson(response, await getPortfolioMetrics());
      return;
    }

    if (url.pathname === "/api/stock-recommendations") {
      sendJson(
        response,
        await getStockRecommendations({
          asyncRefresh: url.searchParams.get("async") === "1",
          forceRefresh: url.searchParams.get("refresh") === "1",
        }),
      );
      return;
    }

    if (url.pathname === "/api/us-stock-recommendations") {
      sendJson(
        response,
        await getUsStockRecommendations({
          asyncRefresh: url.searchParams.get("async") === "1",
          forceRefresh: url.searchParams.get("refresh") === "1",
        }),
      );
      return;
    }

    if (url.pathname === "/api/recommendation-refresh-progress") {
      sendJson(
        response,
        getRecommendationRefreshProgress(
          url.searchParams.get("market") === "us" ? "us" : "domestic",
        ),
      );
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(
      response,
      { error: "market_data_unavailable", message: error.message },
      500,
    );
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log(`Finance dashboard: http://${displayHost}:${PORT}/`);
});

async function getMarketOverview() {
  const now = Date.now();
  if (cachedMarketOverview && now - cachedMarketAt < MARKET_CACHE_MS) {
    return { ...cachedMarketOverview, cached: true };
  }

  if (cachedMarketOverview) {
    refreshMarketOverview().catch((error) => {
      console.warn("Market overview background refresh failed", error);
    });
    return {
      ...cachedMarketOverview,
      cached: true,
      refreshing: Boolean(marketOverviewRefreshPromise),
      stale: true,
    };
  }

  return refreshMarketOverview();
}

function refreshMarketOverview() {
  if (marketOverviewRefreshPromise) return marketOverviewRefreshPromise;

  marketOverviewRefreshPromise = fetchMarketOverview()
    .then((payload) => {
      cachedMarketOverview = payload;
      cachedMarketAt = Date.now();
      return cachedMarketOverview;
    })
    .finally(() => {
      marketOverviewRefreshPromise = null;
    });

  return marketOverviewRefreshPromise;
}

async function fetchMarketOverview() {
  const [
    quotes,
    derivedYahooQuotes,
    semiLeaderQuotes,
    fredQuotes,
    ddr5Spot,
  ] = await Promise.all([
    Promise.all(MARKET_SOURCES.map((source) => optionalMarketQuote(fetchYahooQuote(source), source))),
    Promise.all(
      DERIVED_YAHOO_SOURCES.map((source) => optionalMarketQuote(fetchYahooQuote(source), source)),
    ),
    Promise.all(
      SEMI_LEADER_SOURCES.map((source) => optionalMarketQuote(fetchYahooQuote(source), source)),
    ),
    Promise.all(
      FRED_SOURCES.map((source) => optionalMarketQuote(fetchFredQuote(source), source, 2500)),
    ),
    optionalMarketQuote(fetchTrendForceDdr5Spot(), {
      decimals: 3,
      id: "ddr5Spot",
      label: "DDR5 16Gb 4800/5600 Spot",
      symbol: "DDR5 16Gb (2Gx8) 4800/5600",
      valuePrefix: "$",
    }),
  ]);
  const derivedById = Object.fromEntries(
    derivedYahooQuotes.map((quote) => [quote.id, quote]),
  );
  const syntheticQuotes = [
    optionalBuiltMarketQuote(
      () =>
        buildRelativeStrengthQuote({
          id: "nasdaqBreadth",
          label: "NASDAQ 시장 폭",
          numerator: derivedById.qqqe,
          denominator: derivedById.qqq,
          summary: "QQQE/QQQ 28일 상대강도",
        }),
      { id: "nasdaqBreadth", label: "NASDAQ 시장 폭", symbol: "QQQE/QQQ" },
    ),
    optionalBuiltMarketQuote(
      () =>
        buildRelativeStrengthQuote({
          id: "sp500Breadth",
          label: "S&P 500 시장 폭",
          numerator: derivedById.rsp,
          denominator: derivedById.spy,
          summary: "RSP/SPY 28일 상대강도",
        }),
      { id: "sp500Breadth", label: "S&P 500 시장 폭", symbol: "RSP/SPY" },
    ),
    optionalBuiltMarketQuote(
      () =>
        buildRelativeStrengthQuote({
          id: "semiLeadership",
          label: "반도체/QQQ 상대강도",
          numerator: derivedById.smh,
          denominator: derivedById.qqq,
          summary: "SMH/QQQ 28일 상대강도",
        }),
      { id: "semiLeadership", label: "반도체/QQQ 상대강도", symbol: "SMH/QQQ" },
    ),
    optionalBuiltMarketQuote(
      () =>
        buildMovingAverageBreadthQuote({
          id: "semiBreadth",
          label: "반도체 리더 폭",
          period: 50,
          quotes: semiLeaderQuotes,
          summary: "주요 반도체 7종목 50일선 상회 비율",
        }),
      { id: "semiBreadth", label: "반도체 리더 폭", symbol: "7 semi leaders > MA50" },
    ),
  ];
  return {
    cached: false,
    generatedAt: new Date().toISOString(),
    quotes: Object.fromEntries(
      [
        ...quotes,
        ...syntheticQuotes,
        derivedById.vix3m,
        ...fredQuotes,
        ddr5Spot,
      ].map((quote) => [quote.id, quote]),
    ),
    sources: {
      quote: "Yahoo Finance chart endpoint",
      breadth: "Yahoo Finance ETF and semiconductor leader basket",
      trendForce: "TrendForce DRAM spot price table",
      fred: "FRED CSV series",
    },
  };
}

async function optionalMarketQuote(promise, fallbackSource, timeoutMs = 5500) {
  try {
    return await withTimeout(promise, timeoutMs, fallbackSource.label || fallbackSource.id);
  } catch (error) {
    return unavailableMarketQuote(fallbackSource, error);
  }
}

function optionalBuiltMarketQuote(factory, fallbackSource) {
  try {
    return factory();
  } catch (error) {
    return unavailableMarketQuote(fallbackSource, error);
  }
}

function unavailableMarketQuote(source, error) {
  return {
    change: 0,
    changeClass: "",
    changePercent: 0,
    changeText: "갱신 지연",
    changeUnit: source.changeUnit || "",
    decimals: Number.isFinite(source.decimals) ? source.decimals : 2,
    history: [],
    id: source.id,
    label: source.label,
    marketTime: "",
    price: null,
    sourceError: error?.message || String(error || "unavailable"),
    sparklineText: "갱신 지연",
    symbol: source.symbol || source.id,
    valuePrefix: source.valuePrefix || "",
    valueSuffix: source.valueSuffix || "",
    valueText: "지연",
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} ${timeoutMs}ms timeout`));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchTrendForceDdr5Spot() {
  const html = await fetchText(TREND_FORCE_SOURCES.ddr5Spot, "text/html,*/*");
  const updateMatch = html.match(/Last Update\s+([^<]+?)\s*<\/p>/i);
  const rowMatch = html.match(
    /DDR5 16Gb \(2Gx8\) 4800\/5600[\s\S]*?<td class="lcd-num-l">([^<]+)<\/td>[\s\S]*?<td class="lcd-num-l">([^<]+)<\/td>[\s\S]*?<td class="lcd-num-l">([^<]+)<\/td>[\s\S]*?<td class="lcd-num-l">([^<]+)<\/td>[\s\S]*?<td class="lcd-num-l">([^<]+)<\/td>[\s\S]*?<td class="percent-cell">[\s\S]*?([+-]?\d+(?:\.\d+)?)\s*%/i,
  );

  if (!rowMatch) {
    throw new Error("TrendForce DDR5 spot row unavailable");
  }

  const dailyHigh = Number.parseFloat(rowMatch[1]);
  const dailyLow = Number.parseFloat(rowMatch[2]);
  const sessionHigh = Number.parseFloat(rowMatch[3]);
  const sessionLow = Number.parseFloat(rowMatch[4]);
  const price = Number.parseFloat(rowMatch[5]);
  const changePercent = Number.parseFloat(rowMatch[6]);

  if (!Number.isFinite(price)) {
    throw new Error("TrendForce DDR5 spot price unavailable");
  }

  return {
    change: Number.isFinite(changePercent) ? changePercent : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    changeText: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
    currency: "USD",
    dailyHigh,
    dailyLow,
    analysisHistory: [],
    decimals: 3,
    history: [],
    id: "ddr5Spot",
    label: "DDR5 16Gb 4800/5600 Spot",
    marketTime: updateMatch?.[1]?.trim() || "",
    price,
    sessionHigh,
    sessionLow,
    symbol: "DDR5 16Gb (2Gx8) 4800/5600",
    valuePrefix: "$",
  };
}

async function getMarketSentiment() {
  const now = Date.now();
  if (cachedSentiment && now - cachedSentimentAt < SENTIMENT_CACHE_MS) {
    return { ...cachedSentiment, cached: true };
  }

  const [fearGreedCsv, vixCsv] = await Promise.all([
    fetchText(SENTIMENT_SOURCES.fearGreed),
    fetchText(SENTIMENT_SOURCES.vix),
  ]);

  cachedSentiment = {
    cached: false,
    fearGreed: parseFearGreed(fearGreedCsv),
    generatedAt: new Date().toISOString(),
    sources: {
      fearGreed: "GitHub CSV mirror of CNN Fear & Greed data",
      vix: "Cboe VIX daily historical CSV",
    },
    vix: parseVix(vixCsv),
  };
  cachedSentimentAt = now;

  return cachedSentiment;
}

async function getPortfolioMetrics() {
  const now = Date.now();
  if (cachedPortfolio && now - cachedPortfolioAt < PORTFOLIO_CACHE_MS) {
    return { ...cachedPortfolio, cached: true };
  }

  if (cachedPortfolio) {
    refreshPortfolioMetrics().catch((error) => {
      console.warn("Portfolio metrics background refresh failed", error);
    });
    return {
      ...cachedPortfolio,
      cached: true,
      refreshing: Boolean(portfolioRefreshPromise),
      stale: true,
    };
  }

  return refreshPortfolioMetrics();
}

function refreshPortfolioMetrics() {
  if (portfolioRefreshPromise) return portfolioRefreshPromise;

  portfolioRefreshPromise = fetchPortfolioMetrics()
    .then((payload) => {
      cachedPortfolio = payload;
      cachedPortfolioAt = Date.now();
      return cachedPortfolio;
    })
    .finally(() => {
      portfolioRefreshPromise = null;
    });

  return portfolioRefreshPromise;
}

async function fetchPortfolioMetrics() {
  const holdings = await Promise.all(
    PORTFOLIO_HOLDINGS.map(async (holding) => {
      const [history, flow] = await Promise.all([
        fetchNaverDailyHistory(holding.code),
        fetchNaverInvestorFlow(holding.code).catch((error) => ({
          error: error.message,
          rows: [],
          score: null,
        })),
      ]);
      const metrics = buildPortfolioHoldingMetrics(history);
      return {
        ...holding,
        ...metrics,
        flow,
      };
    }),
  );

  return {
    cached: false,
    generatedAt: new Date().toISOString(),
    holdings,
    sources: {
      flow: "Naver Finance foreign/institution net trading table",
      price: "Naver Finance daily OHLCV chart",
    },
    totalAmount: PORTFOLIO_HOLDINGS.reduce(
      (sum, holding) => sum + holding.amount,
      0,
    ),
  };
}

async function getStockRecommendations({
  asyncRefresh = false,
  forceRefresh = false,
} = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedStockRecommendations &&
    now - cachedStockRecommendationsAt < STOCK_RECOMMENDATION_CACHE_MS
  ) {
    return { ...cachedStockRecommendations, cached: true };
  }

  const month = currentKoreaMonth();
  const markets = "KOSPI,KOSDAQ";
  const resultPath = stockRecommendationResultPath(month, markets);

  if (!forceRefresh) {
    const filePayload = await readStockRecommendationFile(resultPath).catch(() => null);
    if (filePayload) {
      const logicOutdated = !isDomesticStockRecommendationCurrent(filePayload);
      cachedStockRecommendations = await normalizeDomesticStockRecommendationPayload(
        filePayload,
        {
          cached: false,
          ...(logicOutdated
            ? { condition: stockRecommendationCondition(1_000_000_000_000) }
            : {}),
          logicOutdated,
          refreshed: false,
          saved: true,
          stale: logicOutdated,
        },
      );
      cachedStockRecommendationsAt = now;
      return cachedStockRecommendations;
    }
    return emptyStockRecommendationPayload({
      condition: stockRecommendationCondition(1_000_000_000_000),
      marketMonth: month,
      universe: "Saved Korea recommendation screen is not available yet",
    });
  }

  const currentPayload = await readCurrentStockRecommendationPayload({
    condition: stockRecommendationCondition(1_000_000_000_000),
    marketMonth: month,
    resultPath,
    universe: "Saved Korea recommendation screen is not available yet",
  });
  if (isRecommendationRefreshCoolingDown(currentPayload)) {
    return withRecommendationRefreshCooldown(currentPayload, { refreshBlocked: true });
  }

  const refreshPromise = startStockRecommendationRefresh(month, markets, resultPath);

  if (asyncRefresh) {
    refreshPromise.catch(() => null);
    return {
      ...currentPayload,
      refreshStarted: true,
      refreshing: true,
    };
  }

  cachedStockRecommendations = await stockRecommendationRefreshPromise;
  cachedStockRecommendationsAt = Date.now();
  return cachedStockRecommendations;
}

async function getUsStockRecommendations({
  asyncRefresh = false,
  forceRefresh = false,
} = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedUsStockRecommendations &&
    now - cachedUsStockRecommendationsAt < STOCK_RECOMMENDATION_CACHE_MS
  ) {
    return { ...cachedUsStockRecommendations, cached: true };
  }

  const month = currentKoreaMonth();
  const resultPath = usStockRecommendationResultPath(month);

  if (!forceRefresh) {
    const filePayload = await readStockRecommendationFile(resultPath).catch(() => null);
    if (filePayload) {
      const logicOutdated = !isUsStockRecommendationCurrent(filePayload);
      cachedUsStockRecommendations = await normalizeUsStockRecommendationPayload(
        filePayload,
        {
          cached: false,
          ...(logicOutdated
            ? {
                condition: stockRecommendationCondition(10_000_000_000_000, {
                  relativeBenchmark: "QQQ",
                }),
              }
            : {}),
          logicOutdated,
          refreshed: false,
          saved: true,
          stale: logicOutdated,
        },
      );
      cachedUsStockRecommendationsAt = now;
      return cachedUsStockRecommendations;
    }
    return emptyStockRecommendationPayload({
      condition: stockRecommendationCondition(10_000_000_000_000, {
        relativeBenchmark: "QQQ",
      }),
      marketMonth: month,
      universe: "Saved U.S. recommendation screen is not available yet",
    });
  }

  const currentPayload = await readCurrentStockRecommendationPayload({
    condition: stockRecommendationCondition(10_000_000_000_000, {
      relativeBenchmark: "QQQ",
    }),
    marketMonth: month,
    resultPath,
    universe: "Saved U.S. recommendation screen is not available yet",
  });
  if (isRecommendationRefreshCoolingDown(currentPayload)) {
    return withRecommendationRefreshCooldown(currentPayload, { refreshBlocked: true });
  }

  const refreshPromise = startUsStockRecommendationRefresh(month, resultPath);

  if (asyncRefresh) {
    refreshPromise.catch(() => null);
    return {
      ...currentPayload,
      refreshStarted: true,
      refreshing: true,
    };
  }

  cachedUsStockRecommendations = await usStockRecommendationRefreshPromise;
  cachedUsStockRecommendationsAt = Date.now();
  return cachedUsStockRecommendations;
}

function startStockRecommendationRefresh(month, markets, resultPath) {
  if (stockRecommendationRefreshPromise) return stockRecommendationRefreshPromise;
  resetRecommendationRefreshProgress("domestic", {
    detail: "KOSPI/KOSDAQ 전체 종목을 최근 21거래일 기준으로 확인합니다.",
    message: "갱신 작업 준비 중",
  });
  stockRecommendationRefreshPromise = refreshStockRecommendations(month, markets)
    .then((payload) => {
      cachedStockRecommendations = payload;
      cachedStockRecommendationsAt = Date.now();
      updateRecommendationRefreshProgress("domestic", {
        detail: `${payload.matchCount || 0}개 후보를 저장했습니다.`,
        message: "갱신 완료",
        percent: 100,
        state: "succeeded",
      });
      return payload;
    })
    .catch(async (error) => {
      const fallback = await readStockRecommendationFile(resultPath).catch(() => null);
      updateRecommendationRefreshProgress("domestic", {
        detail: fallback
          ? `갱신에 실패해 저장본을 표시합니다. ${error.message}`
          : error.message,
        message: fallback ? "갱신 실패 · 저장본 표시" : "갱신 실패",
        percent: 100,
        state: "failed",
      });
      if (fallback) {
        const logicOutdated = !isDomesticStockRecommendationCurrent(fallback);
        cachedStockRecommendations = await normalizeDomesticStockRecommendationPayload(
          fallback,
          {
            cached: false,
            ...(logicOutdated
              ? { condition: stockRecommendationCondition(1_000_000_000_000) }
              : {}),
            logicOutdated,
            refreshError: error.message,
            refreshed: false,
            stale: true,
          },
        );
        cachedStockRecommendationsAt = Date.now();
        return cachedStockRecommendations;
      }
      throw error;
    })
    .finally(() => {
      stockRecommendationRefreshPromise = null;
    });
  return stockRecommendationRefreshPromise;
}

function startUsStockRecommendationRefresh(month, resultPath) {
  if (usStockRecommendationRefreshPromise) return usStockRecommendationRefreshPromise;
  resetRecommendationRefreshProgress("us", {
    detail: "미국 상장 보통주/ADR 후보를 최근 21거래일 기준으로 확인합니다.",
    message: "갱신 작업 준비 중",
  });
  usStockRecommendationRefreshPromise = refreshUsStockRecommendations(month)
    .then((payload) => {
      cachedUsStockRecommendations = payload;
      cachedUsStockRecommendationsAt = Date.now();
      updateRecommendationRefreshProgress("us", {
        detail: `${payload.matchCount || 0}개 후보를 저장했습니다.`,
        message: "갱신 완료",
        percent: 100,
        state: "succeeded",
      });
      return payload;
    })
    .catch(async (error) => {
      const fallback = await readStockRecommendationFile(resultPath).catch(() => null);
      updateRecommendationRefreshProgress("us", {
        detail: fallback
          ? `갱신에 실패해 저장본을 표시합니다. ${error.message}`
          : error.message,
        message: fallback ? "갱신 실패 · 저장본 표시" : "갱신 실패",
        percent: 100,
        state: "failed",
      });
      if (fallback) {
        const logicOutdated = !isUsStockRecommendationCurrent(fallback);
        cachedUsStockRecommendations = await normalizeUsStockRecommendationPayload(fallback, {
          cached: false,
          ...(logicOutdated
            ? {
                condition: stockRecommendationCondition(10_000_000_000_000, {
                  relativeBenchmark: "QQQ",
                }),
              }
            : {}),
          logicOutdated,
          refreshError: error.message,
          refreshed: false,
          stale: true,
        });
        cachedUsStockRecommendationsAt = Date.now();
        return cachedUsStockRecommendations;
      }
      throw error;
    })
    .finally(() => {
      usStockRecommendationRefreshPromise = null;
    });
  return usStockRecommendationRefreshPromise;
}

async function readCurrentStockRecommendationPayload({
  condition,
  marketMonth,
  resultPath,
  universe,
}) {
  const filePayload = await readStockRecommendationFile(resultPath).catch(() => null);
  if (filePayload) {
    const isDomesticResult = resultPath.includes("kr_monthly_breakout_");
    const isUsResult = resultPath.includes("us_monthly_breakout_");
    const normalize = isDomesticResult
      ? normalizeDomesticStockRecommendationPayload
      : normalizeUsStockRecommendationPayload;
    const logicOutdated =
      (isDomesticResult && !isDomesticStockRecommendationCurrent(filePayload)) ||
      (isUsResult && !isUsStockRecommendationCurrent(filePayload));
    return normalize(filePayload, {
      cached: false,
      ...(logicOutdated
        ? {
            condition: stockRecommendationCondition(
              isDomesticResult ? 1_000_000_000_000 : 10_000_000_000_000,
              isUsResult ? { relativeBenchmark: "QQQ" } : {},
            ),
          }
        : {}),
      logicOutdated,
      refreshed: false,
      saved: true,
      stale: logicOutdated,
    });
  }
  return emptyStockRecommendationPayload({
    condition,
    marketMonth,
    universe,
  });
}

function isRecommendationRefreshCoolingDown(payload) {
  const availableAt = recommendationRefreshAvailableAt(payload);
  return Boolean(availableAt && Date.now() < availableAt.getTime());
}

function withRecommendationRefreshCooldown(payload, extra = {}) {
  const availableAt = recommendationRefreshAvailableAt(payload);
  if (!availableAt) return { ...payload, ...extra };
  const remainingMs = Math.max(0, availableAt.getTime() - Date.now());
  return {
    ...payload,
    refreshAvailableAt: availableAt.toISOString(),
    refreshCooldownSeconds: Math.ceil(remainingMs / 1000),
    ...extra,
  };
}

function recommendationRefreshAvailableAt(payload) {
  if (!payload?.generatedAt || payload.logicOutdated) return null;
  const generatedAt = new Date(payload.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) return null;
  return new Date(generatedAt + STOCK_RECOMMENDATION_REFRESH_COOLDOWN_MS);
}

async function refreshStockRecommendations(month, markets) {
  const scriptPath = path.join(ROOT, "scripts", "screen_kr_monthly_breakout.mjs");
  await runRecommendationScript("domestic", [scriptPath, month, "5", "1000000000000", markets], {
    env: {
      ...process.env,
      SCREEN_CONCURRENCY: process.env.SCREEN_CONCURRENCY || "8",
    },
    timeout: 180000,
  });
  updateRecommendationRefreshProgress("domestic", {
    detail: "스크리닝 결과 파일을 읽어 화면 데이터로 정리합니다.",
    message: "결과 저장 중",
    percent: 96,
  });
  return normalizeDomesticStockRecommendationPayload(
    await readStockRecommendationFile(stockRecommendationResultPath(month, markets)),
    { cached: false, refreshed: true },
  );
}

async function refreshUsStockRecommendations(month) {
  const scriptPath = path.join(ROOT, "scripts", "screen_us_monthly_breakout.mjs");
  await runRecommendationScript("us", [scriptPath, month, "5", "10000000000000"], {
    env: {
      ...process.env,
      SCREEN_CONCURRENCY:
        process.env.US_SCREEN_CONCURRENCY || process.env.SCREEN_CONCURRENCY || "8",
    },
    timeout: 900000,
  });
  updateRecommendationRefreshProgress("us", {
    detail: "스크리닝 결과 파일을 읽어 화면 데이터로 정리합니다.",
    message: "결과 저장 중",
    percent: 96,
  });
  return normalizeUsStockRecommendationPayload(
    await readStockRecommendationFile(usStockRecommendationResultPath(month)),
    { cached: false, refreshed: true },
  );
}

function runRecommendationScript(market, args, { env, timeout }) {
  return new Promise((resolve, reject) => {
    updateRecommendationRefreshProgress(market, {
      detail: "데이터 소스에 접속하고 대상 종목 목록을 가져옵니다.",
      message: "스크리너 시작 중",
      percent: RECOMMENDATION_SCRIPT_START_PERCENT,
      state: "running",
    });

    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderrText = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref?.();
    }, timeout);
    timer.unref?.();

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrText = `${stderrText}${text}`.slice(-12000);
      updateRecommendationCheckedProgress(market, text);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const reason = timedOut
        ? `${Math.round(timeout / 1000)}초 안에 갱신이 끝나지 않았습니다.`
        : `스크리너 종료 코드 ${code ?? signal}`;
      reject(new Error([reason, stderrText.trim()].filter(Boolean).join(" · ")));
    });
  });
}

function createRecommendationRefreshProgress(market) {
  return {
    completed: 0,
    detail: "갱신 버튼을 누르면 진행률이 표시됩니다.",
    market,
    message: "갱신 대기",
    percent: 0,
    startedAt: "",
    state: "idle",
    total: 0,
    updatedAt: new Date().toISOString(),
  };
}

function resetRecommendationRefreshProgress(market, { detail, message }) {
  recommendationRefreshProgress[market] = {
    ...createRecommendationRefreshProgress(market),
    detail,
    message,
    percent: 3,
    startedAt: new Date().toISOString(),
    state: "running",
  };
}

function updateRecommendationRefreshProgress(market, patch) {
  const current =
    recommendationRefreshProgress[market] || createRecommendationRefreshProgress(market);
  recommendationRefreshProgress[market] = {
    ...current,
    ...patch,
    market,
    updatedAt: new Date().toISOString(),
  };
}

function updateRecommendationCheckedProgress(market, text) {
  const marketCapMatches = [...text.matchAll(/marketcap\s+(\d+)\/(\d+)/gi)];
  const latestMarketCap = marketCapMatches.at(-1);
  if (latestMarketCap) {
    const completed = Number(latestMarketCap[1]);
    const total = Number(latestMarketCap[2]);
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      const checkedRatio = Math.min(Math.max(completed / total, 0), 1);
      const percent =
        RECOMMENDATION_SCRIPT_START_PERCENT +
        Math.round(checkedRatio * 8);
      updateRecommendationRefreshProgress(market, {
        completed,
        detail: `${completed.toLocaleString("ko-KR")} / ${total.toLocaleString(
          "ko-KR",
        )}개 종목 시총 조건 확인`,
        message: "시총 조건 확인 중",
        percent: Math.min(percent, RECOMMENDATION_SCRIPT_START_PERCENT + 8),
        state: "running",
        total,
      });
    }
  }

  const universeMatches = [
    ...text.matchAll(/prefiltered\s+(\d+)\/(\d+)\s+by market cap/gi),
  ];
  const latestUniverse = universeMatches.at(-1);
  if (latestUniverse) {
    const total = Number(latestUniverse[1]);
    const rawTotal = Number(latestUniverse[2]);
    if (Number.isFinite(total) && Number.isFinite(rawTotal) && total > 0) {
      updateRecommendationRefreshProgress(market, {
        completed: 0,
        detail: `${rawTotal.toLocaleString("ko-KR")}개 중 시총 조건 통과 ${total.toLocaleString(
          "ko-KR",
        )}개로 먼저 줄였습니다.`,
        message: "대상 종목 압축 완료",
        percent: RECOMMENDATION_SCRIPT_START_PERCENT,
        state: "running",
        total,
      });
    }
  }

  const matches = [...text.matchAll(/checked\s+(\d+)\/(\d+)/gi)];
  const latest = matches.at(-1);
  if (!latest) return;

  const completed = Number(latest[1]);
  const total = Number(latest[2]);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return;

  const checkedRatio = Math.min(Math.max(completed / total, 0), 1);
  const percent =
    RECOMMENDATION_SCRIPT_START_PERCENT +
    Math.round(
      checkedRatio *
        (RECOMMENDATION_SCRIPT_DONE_PERCENT - RECOMMENDATION_SCRIPT_START_PERCENT),
    );
  updateRecommendationRefreshProgress(market, {
    completed,
    detail: `${completed.toLocaleString("ko-KR")} / ${total.toLocaleString(
      "ko-KR",
    )}개 종목 확인`,
    message: "후보 계산 중",
    percent: Math.min(percent, RECOMMENDATION_SCRIPT_DONE_PERCENT),
    state: "running",
    total,
  });
}

function getRecommendationRefreshProgress(market) {
  const progress =
    recommendationRefreshProgress[market] || createRecommendationRefreshProgress(market);
  const elapsedSeconds = progress.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(progress.startedAt).getTime()) / 1000))
    : 0;
  return {
    ...progress,
    elapsedSeconds,
  };
}

async function readStockRecommendationFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizeStockRecommendationPayload(payload, flags = {}) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    ...payload,
    ...flags,
    results,
    topResults: results.slice(0, 12),
  };
}

async function normalizeUsStockRecommendationPayload(payload, flags = {}) {
  const normalized = normalizeStockRecommendationPayload(payload, flags);
  const enrichedResults = await Promise.all(
    normalized.results.map((item) => enrichUsRecommendationItem(item)),
  );
  return {
    ...normalized,
    results: enrichedResults,
    topResults: enrichedResults.slice(0, 12),
  };
}

function isDomesticStockRecommendationCurrent(payload) {
  return payload?.screenVersion === DOMESTIC_STOCK_RECOMMENDATION_VERSION;
}

function isUsStockRecommendationCurrent(payload) {
  return payload?.screenVersion === US_STOCK_RECOMMENDATION_VERSION;
}

async function normalizeDomesticStockRecommendationPayload(payload, flags = {}) {
  const normalized = normalizeStockRecommendationPayload(payload, flags);
  const enrichedResults = await Promise.all(
    normalized.results.map((item) => enrichDomesticRecommendationItem(item)),
  );
  const invalidatedResults = enrichedResults.filter(
    (item) => item.recommendationInvalidated,
  );
  const activeResults = enrichedResults.filter(
    (item) => !item.recommendationInvalidated,
  );
  return {
    ...normalized,
    activeMatchCount: activeResults.length,
    invalidatedCount: invalidatedResults.length,
    invalidatedResults,
    matchCount: activeResults.length,
    rawMatchCount: Number(normalized.matchCount ?? normalized.results.length),
    results: activeResults,
    topResults: activeResults.slice(0, 12),
  };
}

async function enrichUsRecommendationItem(item) {
  const symbol = String(item?.symbol || item?.rawSymbol || "").trim().toUpperCase();
  if (!symbol) return item;
  try {
    const fundamentals = await fetchNasdaqUsFundamentals(symbol, item);
    return {
      ...item,
      ...fundamentals,
    };
  } catch (error) {
    return {
      ...item,
      fundamentalStatusError: error.message,
    };
  }
}

async function fetchNasdaqUsFundamentals(symbol, item = {}) {
  const encodedSymbol = encodeURIComponent(symbol);
  const [summary, financials, forecast] = await Promise.all([
    fetchNasdaqJson(
      `https://api.nasdaq.com/api/quote/${encodedSymbol}/summary?assetclass=stocks`,
    ),
    fetchNasdaqJson(
      `https://api.nasdaq.com/api/company/${encodedSymbol}/financials?frequency=1`,
    ),
    fetchNasdaqJson(
      `https://api.nasdaq.com/api/analyst/${encodedSymbol}/earnings-forecast`,
    ),
  ]);
  const summaryData = summary?.data?.summaryData || {};
  const currentPrice =
    parseNasdaqNumber(summaryData.PreviousClose?.value) ||
    optionalNumber(item.liveClose) ||
    optionalNumber(item.lastClose);
  const incomeStatement = financials?.data?.incomeStatementTable || {};
  const latestAnnualKey = "value2";
  const previousAnnualKey = "value3";
  const annualRevenue = nasdaqFinancialValue(
    incomeStatement,
    "Total Revenue",
    latestAnnualKey,
  );
  const previousAnnualRevenue = nasdaqFinancialValue(
    incomeStatement,
    "Total Revenue",
    previousAnnualKey,
  );
  const annualOperatingProfit = nasdaqFinancialValue(
    incomeStatement,
    "Operating Income",
    latestAnnualKey,
  );
  const previousAnnualOperatingProfit = nasdaqFinancialValue(
    incomeStatement,
    "Operating Income",
    previousAnnualKey,
  );
  const annualNetIncome = nasdaqFinancialValue(
    incomeStatement,
    "Net Income",
    latestAnnualKey,
  );
  const previousAnnualNetIncome = nasdaqFinancialValue(
    incomeStatement,
    "Net Income",
    previousAnnualKey,
  );
  const yearlyForecastRows = forecast?.data?.yearlyForecast?.rows || [];
  const forwardEps = parseNasdaqNumber(
    yearlyForecastRows[0]?.consensusEPSForecast,
  );
  const nextForwardEps = parseNasdaqNumber(
    yearlyForecastRows[1]?.consensusEPSForecast,
  );
  const forwardPer =
    Number.isFinite(currentPrice) &&
    Number.isFinite(forwardEps) &&
    forwardEps > 0
      ? currentPrice / forwardEps
      : NaN;
  const revenueGrowth = percentChangeWithSignedBase(
    annualRevenue,
    previousAnnualRevenue,
  );
  const operatingProfitGrowth = percentChangeWithSignedBase(
    annualOperatingProfit,
    previousAnnualOperatingProfit,
  );
  const netIncomeGrowth = percentChangeWithSignedBase(
    annualNetIncome,
    previousAnnualNetIncome,
  );
  const operatingMargin =
    Number.isFinite(annualRevenue) &&
    annualRevenue !== 0 &&
    Number.isFinite(annualOperatingProfit)
      ? (annualOperatingProfit / annualRevenue) * 100
      : NaN;
  const epsGrowth = percentChangeWithSignedBase(nextForwardEps, forwardEps);
  const quality = evaluateUsFundamentalQuality({
    forwardPer,
    netIncomeGrowth,
    operatingProfitGrowth,
    revenueGrowth,
  });

  return {
    annualNetIncome,
    annualNetIncomeGrowth: roundFinite(netIncomeGrowth, 2),
    annualOperatingProfit,
    annualOperatingProfitGrowth: roundFinite(operatingProfitGrowth, 2),
    annualRevenue,
    annualRevenueGrowth: roundFinite(revenueGrowth, 2),
    estimatedEps: roundFinite(forwardEps, 4),
    estimatedEpsGrowth: roundFinite(epsGrowth, 2),
    forwardPer: roundFinite(forwardPer, 2),
    fundamentalSource: "Nasdaq financials and analyst forecast",
    latestAnnualLabel: incomeStatement.headers?.[latestAnnualKey] || "",
    nextAnnualConsensusLabel: yearlyForecastRows[0]?.fiscalEnd || "",
    quarterOperatingMargin: roundFinite(operatingMargin, 2),
    quarterOperatingProfitGrowthYoy: roundFinite(
      Number.isFinite(operatingProfitGrowth) ? operatingProfitGrowth : netIncomeGrowth,
      2,
    ),
    quarterRevenueGrowthYoy: roundFinite(revenueGrowth, 2),
    ...quality,
  };
}

function evaluateUsFundamentalQuality({
  forwardPer,
  netIncomeGrowth,
  operatingProfitGrowth,
  revenueGrowth,
}) {
  const profitGrowth = Number.isFinite(operatingProfitGrowth)
    ? operatingProfitGrowth
    : netIncomeGrowth;
  const hasData = [revenueGrowth, profitGrowth, forwardPer].some(Number.isFinite);
  if (!hasData) {
    return {
      fundamentalLabel: "실적 확인 전",
      fundamentalReasons: ["미국 실적/밸류 데이터 부족"],
      fundamentalScore: null,
      fundamentalStatus: "missing",
      fundamentalSummary: "미국 실적과 포워드 PER 데이터가 부족해 가격 신호 중심으로 봐야 해.",
    };
  }

  const reasons = [];
  let score = 45;
  if (Number.isFinite(revenueGrowth)) {
    if (revenueGrowth >= 30) score += 22;
    else if (revenueGrowth >= 15) score += 16;
    else if (revenueGrowth >= 5) score += 9;
    else if (revenueGrowth < 0) score -= 12;
    reasons.push(`매출 ${formatSigned(revenueGrowth, 1)}%`);
  }
  if (Number.isFinite(profitGrowth)) {
    if (profitGrowth >= 40) score += 24;
    else if (profitGrowth >= 20) score += 18;
    else if (profitGrowth >= 0) score += 8;
    else score -= 18;
    reasons.push(`이익 ${formatSigned(profitGrowth, 1)}%`);
  }
  if (Number.isFinite(forwardPer)) {
    if (forwardPer <= 25) score += 12;
    else if (forwardPer <= 45) score += 7;
    else if (forwardPer >= 100) score -= 14;
    else if (forwardPer >= 70) score -= 8;
    reasons.push(`포워드PER ${formatNumber(forwardPer, 1)}배`);
  }

  const clampedScore = Math.round(Math.max(0, Math.min(100, score)));
  const hasForwardPer = Number.isFinite(forwardPer);
  const status =
    clampedScore >= DOMESTIC_FUNDAMENTAL_SUPPORT_SCORE
      ? "supportive"
      : clampedScore < DOMESTIC_FUNDAMENTAL_CAUTION_SCORE
        ? "caution"
        : "neutral";
  const fundamentalLabel =
    status === "supportive"
      ? "실적 지지"
      : status === "caution"
        ? "실적 점검"
        : "실적 중립";
  const summaryCore = reasons.join(", ");
  const fundamentalSummary =
    status === "supportive"
      ? `${summaryCore}로 ${
          hasForwardPer ? "실적과 포워드 PER이" : "실적 흐름이"
        } 가격 신호를 받쳐줘.`
      : status === "caution"
        ? `${summaryCore}라 실적/밸류 확인 전까지는 관찰이 좋아.`
        : `${summaryCore}로 실적 근거는 중립이야.`;

  return {
    fundamentalLabel,
    fundamentalReasons: reasons,
    fundamentalScore: clampedScore,
    fundamentalStatus: status,
    fundamentalSummary,
  };
}

async function fetchNasdaqJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: NASDAQ_API_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Nasdaq request failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function nasdaqFinancialValue(table, title, key) {
  const row = (table?.rows || []).find((entry) => entry.value1 === title);
  return parseNasdaqNumber(row?.[key]);
}

function parseNasdaqNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let text = String(value ?? "").trim();
  if (!text || text === "N/A" || text === "-") return NaN;
  const isNegative = /^\(.*\)$/.test(text);
  text = text
    .replace(/[,$%]/g, "")
    .replace(/[()]/g, "")
    .trim();
  const suffix = text.match(/([KMBT])$/i)?.[1]?.toUpperCase();
  if (suffix) text = text.slice(0, -1);
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000, T: 1_000_000_000_000 }[
    suffix
  ] || 1;
  const number = Number(text);
  if (!Number.isFinite(number)) return NaN;
  return (isNegative ? -number : number) * multiplier;
}

async function enrichDomesticRecommendationItem(item) {
  if (!item?.code) return item;
  const [priceResult, fundamentalResult] = await Promise.allSettled([
    fetchNaverRecentPriceRows(item.code),
    fetchNaverDomesticFundamentals(item.code),
  ]);
  let enrichedItem = {
    ...item,
    ...(fundamentalResult.status === "fulfilled"
      ? fundamentalResult.value
      : { fundamentalStatusError: fundamentalResult.reason?.message || "재무 데이터 확인 실패" }),
  };

  try {
    if (priceResult.status !== "fulfilled") {
      throw priceResult.reason || new Error("가격 데이터 확인 실패");
    }
    const rows = priceResult.value;
    const latest = rows.at(-1);
    if (!latest) return applyDomesticFundamentalQuality(enrichedItem);

    const lastClose = Number(item.lastClose);
    const returnFromSignal = percentChange(latest.close, lastClose);
    const previousLiveRow = rows
      .slice(0, -1)
      .reverse()
      .find((row) => row.date < latest.date && Number.isFinite(row.close));
    const livePreviousClose = Number(previousLiveRow?.close);
    const returnFromPreviousClose = percentChange(latest.close, livePreviousClose);
    const ma10 = movingAverage(rows.map((row) => row.close), 10);
    const referenceStartDate =
      item.rollingWindowStartDate || item.lastDate || String(item.lastDate || "").slice(0, 7);
    const referenceRows = rows.filter((row) => row.date >= referenceStartDate);
    const liveHighReference = Math.max(
      Number(item.monthHigh),
      ...referenceRows.map((row) => row.high || row.close).filter(Number.isFinite),
    );
    const liveMonthHighDrawdown = percentChange(latest.close, liveHighReference);
    const invalidationReasons = [
      returnFromSignal <= RECOMMENDATION_STOP_LOSS_PERCENT
        ? `추천가 대비 ${formatSigned(returnFromSignal, 1)}%`
        : "",
      Number.isFinite(ma10) && latest.close < ma10
        ? `10일선 하회(${formatSigned(percentChange(latest.close, ma10), 1)}%)`
        : "",
      liveMonthHighDrawdown <= RECOMMENDATION_MAX_MONTH_HIGH_DRAWDOWN
        ? `월중 고점 대비 ${formatSigned(liveMonthHighDrawdown, 1)}%`
        : "",
    ].filter(Boolean);

    enrichedItem = {
      ...enrichedItem,
      liveClose: latest.close,
      liveDate: latest.date,
      liveMonthHigh: Number.isFinite(liveHighReference) ? liveHighReference : null,
      liveMonthHighDrawdown: roundFinite(liveMonthHighDrawdown, 2),
      livePreviousClose: Number.isFinite(livePreviousClose) ? livePreviousClose : null,
      liveReturnFromPreviousClose: roundFinite(returnFromPreviousClose, 2),
      liveReturnFromSignal: roundFinite(returnFromSignal, 2),
      liveTenDayAverage: roundFinite(ma10, 2),
      recommendationInvalidated: invalidationReasons.length > 0,
      recommendationInvalidationReasons: invalidationReasons,
    };
    return applyDomesticFundamentalQuality(enrichedItem);
  } catch (error) {
    return applyDomesticFundamentalQuality({
      ...enrichedItem,
      recommendationInvalidated: false,
      recommendationStatusError: error.message,
    });
  }
}

async function fetchNaverDomesticFundamentals(code) {
  const [integration, quarter, annual] = await Promise.all([
    fetchNaverStockIntegration(code),
    fetchNaverFinanceInfo(code, "quarter"),
    fetchNaverFinanceInfo(code, "annual"),
  ]);
  const totalInfo = naverTotalInfoMap(integration);
  const valuation = {
    consensusDate: integration.consensusInfo?.createDate || "",
    consensusRecommendation: parseOptionalKoreanNumber(
      integration.consensusInfo?.recommMean,
    ),
    consensusTargetPrice: parseOptionalKoreanNumber(
      integration.consensusInfo?.priceTargetMean,
    ),
    estimatedEps: parseOptionalKoreanNumber(totalInfo.cnsEps?.value),
    eps: parseOptionalKoreanNumber(totalInfo.eps?.value),
    forwardPer: parseOptionalKoreanNumber(totalInfo.cnsPer?.value),
    foreignOwnershipRate: parseOptionalKoreanNumber(totalInfo.foreignRate?.value),
    pbr: parseOptionalKoreanNumber(totalInfo.pbr?.value),
    trailingPer: parseOptionalKoreanNumber(totalInfo.per?.value),
  };
  const finance = {
    ...parseNaverQuarterFinance(quarter),
    ...parseNaverAnnualFinance(annual),
  };
  const flows = parseNaverInvestorFlowSummary(integration.dealTrendInfos);
  const estimatedEpsGrowth = percentChangeWithSignedBase(
    valuation.estimatedEps,
    valuation.eps,
  );

  return {
    ...valuation,
    ...finance,
    ...flows,
    estimatedEpsGrowth: roundFinite(estimatedEpsGrowth, 2),
    fundamentalSource: "Naver Finance mobile",
  };
}

async function fetchNaverStockIntegration(code) {
  const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(
    code,
  )}/integration`;
  return JSON.parse(await fetchText(url, "application/json,text/plain,*/*"));
}

async function fetchNaverFinanceInfo(code, periodType) {
  const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(
    code,
  )}/finance/${encodeURIComponent(periodType)}`;
  return JSON.parse(await fetchText(url, "application/json,text/plain,*/*"));
}

function naverTotalInfoMap(payload) {
  return Object.fromEntries(
    (payload?.totalInfos || []).map((entry) => [entry.code, entry]),
  );
}

function parseNaverQuarterFinance(payload) {
  const financeInfo = payload?.financeInfo;
  const titles = financeInfo?.trTitleList || [];
  const actualTitles = titles.filter((title) => title.isConsensus !== "Y");
  const latest = actualTitles.at(-1);
  if (!latest) return {};
  const previous = actualTitles.at(-2);
  const yoy = actualTitles.find(
    (title) => title.key === String(Number(latest.key) - 100),
  );
  const revenue = naverFinanceValue(financeInfo, "매출액", latest.key);
  const revenuePrevious = previous
    ? naverFinanceValue(financeInfo, "매출액", previous.key)
    : null;
  const revenueYoyBase = yoy
    ? naverFinanceValue(financeInfo, "매출액", yoy.key)
    : null;
  const operatingProfit = naverFinanceValue(financeInfo, "영업이익", latest.key);
  const operatingProfitPrevious = previous
    ? naverFinanceValue(financeInfo, "영업이익", previous.key)
    : null;
  const operatingProfitYoyBase = yoy
    ? naverFinanceValue(financeInfo, "영업이익", yoy.key)
    : null;
  const operatingMargin = naverFinanceValue(financeInfo, "영업이익률", latest.key);
  const operatingMarginPrevious = previous
    ? naverFinanceValue(financeInfo, "영업이익률", previous.key)
    : null;
  const nextConsensus = titles.find((title) => title.isConsensus === "Y");
  const nextRevenue = nextConsensus
    ? naverFinanceValue(financeInfo, "매출액", nextConsensus.key)
    : null;
  const nextOperatingProfit = nextConsensus
    ? naverFinanceValue(financeInfo, "영업이익", nextConsensus.key)
    : null;

  return {
    latestQuarterLabel: latest.title || "",
    nextQuarterConsensusLabel: nextConsensus?.title || "",
    nextQuarterOperatingProfit: nextOperatingProfit,
    nextQuarterOperatingProfitGrowthQoq: roundFinite(
      percentChangeWithSignedBase(nextOperatingProfit, operatingProfit),
      2,
    ),
    nextQuarterRevenue: nextRevenue,
    nextQuarterRevenueGrowthQoq: roundFinite(
      percentChangeWithSignedBase(nextRevenue, revenue),
      2,
    ),
    quarterOperatingMargin: operatingMargin,
    quarterOperatingMarginChangeQoq: roundFinite(
      Number.isFinite(operatingMargin) && Number.isFinite(operatingMarginPrevious)
        ? operatingMargin - operatingMarginPrevious
        : NaN,
      2,
    ),
    quarterOperatingProfit: operatingProfit,
    quarterOperatingProfitGrowthQoq: roundFinite(
      percentChangeWithSignedBase(operatingProfit, operatingProfitPrevious),
      2,
    ),
    quarterOperatingProfitGrowthYoy: roundFinite(
      percentChangeWithSignedBase(operatingProfit, operatingProfitYoyBase),
      2,
    ),
    quarterRevenue: revenue,
    quarterRevenueGrowthQoq: roundFinite(
      percentChangeWithSignedBase(revenue, revenuePrevious),
      2,
    ),
    quarterRevenueGrowthYoy: roundFinite(
      percentChangeWithSignedBase(revenue, revenueYoyBase),
      2,
    ),
  };
}

function parseNaverAnnualFinance(payload) {
  const financeInfo = payload?.financeInfo;
  const titles = financeInfo?.trTitleList || [];
  const actualTitles = titles.filter((title) => title.isConsensus !== "Y");
  const latest = actualTitles.at(-1);
  const previous = actualTitles.at(-2);
  const nextConsensus = titles.find((title) => title.isConsensus === "Y");
  if (!latest) return {};
  const revenue = naverFinanceValue(financeInfo, "매출액", latest.key);
  const revenuePrevious = previous
    ? naverFinanceValue(financeInfo, "매출액", previous.key)
    : null;
  const operatingProfit = naverFinanceValue(financeInfo, "영업이익", latest.key);
  const operatingProfitPrevious = previous
    ? naverFinanceValue(financeInfo, "영업이익", previous.key)
    : null;
  const nextRevenue = nextConsensus
    ? naverFinanceValue(financeInfo, "매출액", nextConsensus.key)
    : null;
  const nextOperatingProfit = nextConsensus
    ? naverFinanceValue(financeInfo, "영업이익", nextConsensus.key)
    : null;

  return {
    annualOperatingProfit: operatingProfit,
    annualOperatingProfitGrowth: roundFinite(
      percentChangeWithSignedBase(operatingProfit, operatingProfitPrevious),
      2,
    ),
    annualRevenue: revenue,
    annualRevenueGrowth: roundFinite(
      percentChangeWithSignedBase(revenue, revenuePrevious),
      2,
    ),
    latestAnnualLabel: latest.title || "",
    nextAnnualConsensusLabel: nextConsensus?.title || "",
    nextAnnualOperatingProfit: nextOperatingProfit,
    nextAnnualOperatingProfitGrowth: roundFinite(
      percentChangeWithSignedBase(nextOperatingProfit, operatingProfit),
      2,
    ),
    nextAnnualRevenue: nextRevenue,
    nextAnnualRevenueGrowth: roundFinite(
      percentChangeWithSignedBase(nextRevenue, revenue),
      2,
    ),
  };
}

function naverFinanceValue(financeInfo, title, key) {
  const row = (financeInfo?.rowList || []).find((entry) => entry.title === title);
  return parseOptionalKoreanNumber(row?.columns?.[key]?.value);
}

function parseNaverInvestorFlowSummary(rows = []) {
  const recentRows = rows.slice(0, 3);
  const foreignNet3Days = sum(
    recentRows.map((row) => parseOptionalKoreanNumber(row.foreignerPureBuyQuant)),
  );
  const institutionNet3Days = sum(
    recentRows.map((row) => parseOptionalKoreanNumber(row.organPureBuyQuant)),
  );
  return {
    foreignInstitutionNet3Days: foreignNet3Days + institutionNet3Days,
    foreignNet3Days,
    institutionNet3Days,
  };
}

function applyDomesticFundamentalQuality(item) {
  const quality = evaluateDomesticFundamentalQuality(item);
  const originalStage =
    item.technicalRecommendationStage || item.recommendationStage || "confirmed";
  const shouldDowngrade =
    originalStage === "confirmed" &&
    (quality.fundamentalStatus === "caution" || quality.severeValuationRisk);
  return {
    ...item,
    ...quality,
    qualityAdjusted: shouldDowngrade,
    recommendationStage: shouldDowngrade ? "observe" : originalStage,
    signal: shouldDowngrade ? "실적 확인 관찰 후보" : item.signal,
    technicalRecommendationStage: originalStage,
  };
}

function evaluateDomesticFundamentalQuality(item) {
  const revenueGrowth = optionalNumber(item.quarterRevenueGrowthYoy);
  const profitGrowth = optionalNumber(item.quarterOperatingProfitGrowthYoy);
  const profitGrowthQoq = optionalNumber(item.quarterOperatingProfitGrowthQoq);
  const marginChange = optionalNumber(item.quarterOperatingMarginChangeQoq);
  const forwardPer = optionalNumber(item.forwardPer);
  const trailingPer = optionalNumber(item.trailingPer);
  const epsGrowth = optionalNumber(item.estimatedEpsGrowth);
  const nextProfitGrowth = optionalNumber(item.nextAnnualOperatingProfitGrowth);
  const hasData = [
    revenueGrowth,
    profitGrowth,
    forwardPer,
    trailingPer,
    nextProfitGrowth,
  ].some(Number.isFinite);

  if (!hasData) {
    return {
      fundamentalLabel: "실적 확인 전",
      fundamentalReasons: ["실적/밸류 데이터 부족"],
      fundamentalScore: null,
      fundamentalStatus: "missing",
      fundamentalSummary: "실적과 밸류 데이터가 부족해 가격 신호만으로는 관찰이 좋아.",
      severeValuationRisk: false,
    };
  }

  const reasons = [];
  let score = 45;

  if (Number.isFinite(revenueGrowth)) {
    if (revenueGrowth >= 15) score += 18;
    else if (revenueGrowth >= 5) score += 12;
    else if (revenueGrowth >= 0) score += 5;
    else score -= 10;
    reasons.push(`매출 ${formatSigned(revenueGrowth, 1)}%`);
  }

  if (Number.isFinite(profitGrowth)) {
    if (profitGrowth >= 30) score += 24;
    else if (profitGrowth >= 10) score += 16;
    else if (profitGrowth >= 0) score += 7;
    else score -= 20;
    reasons.push(`영업이익 ${formatSigned(profitGrowth, 1)}%`);
  }

  if (Number.isFinite(profitGrowthQoq)) {
    if (profitGrowthQoq >= 15) score += 6;
    else if (profitGrowthQoq < -20) score -= 6;
  }

  if (Number.isFinite(marginChange)) {
    if (marginChange > 0) score += 4;
    else if (marginChange < -1) score -= 4;
  }

  if (Number.isFinite(nextProfitGrowth)) {
    if (nextProfitGrowth >= 30) score += 8;
    else if (nextProfitGrowth >= 10) score += 5;
    else if (nextProfitGrowth < 0) score -= 6;
  }

  if (Number.isFinite(epsGrowth)) {
    if (epsGrowth >= 30) score += 8;
    else if (epsGrowth >= 10) score += 4;
    else if (epsGrowth < 0) score -= 6;
  }

  const valuationPer = Number.isFinite(forwardPer) ? forwardPer : trailingPer;
  if (Number.isFinite(valuationPer)) {
    if (valuationPer <= 25) score += 12;
    else if (valuationPer <= 45) score += 6;
    else if (valuationPer >= 90) score -= 14;
    else if (valuationPer >= 70) score -= 8;
    reasons.push(
      `${Number.isFinite(forwardPer) ? "추정PER" : "PER"} ${formatNumber(
        valuationPer,
        1,
      )}배`,
    );
  }

  const strongGrowth =
    (Number.isFinite(profitGrowth) && profitGrowth >= 30) ||
    (Number.isFinite(epsGrowth) && epsGrowth >= 30) ||
    (Number.isFinite(nextProfitGrowth) && nextProfitGrowth >= 30);
  const severeValuationRisk =
    Number.isFinite(valuationPer) &&
    valuationPer >= 90 &&
    !strongGrowth &&
    !(Number.isFinite(revenueGrowth) && revenueGrowth >= 15);

  if (severeValuationRisk) score -= 12;

  const clampedScore = Math.round(Math.max(0, Math.min(100, score)));
  const status =
    clampedScore >= DOMESTIC_FUNDAMENTAL_SUPPORT_SCORE
      ? "supportive"
      : clampedScore < DOMESTIC_FUNDAMENTAL_CAUTION_SCORE || severeValuationRisk
        ? "caution"
        : "neutral";
  const fundamentalLabel =
    status === "supportive"
      ? "실적 지지"
      : status === "caution"
        ? "실적 점검"
        : "실적 중립";

  return {
    fundamentalLabel,
    fundamentalReasons: reasons,
    fundamentalScore: clampedScore,
    fundamentalStatus: status,
    fundamentalSummary: domesticFundamentalSummary({
      epsGrowth,
      forwardPer,
      profitGrowth,
      revenueGrowth,
      severeValuationRisk,
      status,
      trailingPer,
    }),
    severeValuationRisk,
  };
}

function domesticFundamentalSummary({
  epsGrowth,
  forwardPer,
  profitGrowth,
  revenueGrowth,
  severeValuationRisk,
  status,
  trailingPer,
}) {
  const parts = [];
  if (Number.isFinite(revenueGrowth)) {
    parts.push(`최근 분기 매출 ${formatSigned(revenueGrowth, 1)}%`);
  }
  if (Number.isFinite(profitGrowth)) {
    parts.push(`영업이익 ${formatSigned(profitGrowth, 1)}%`);
  }
  const valuationPer = Number.isFinite(forwardPer) ? forwardPer : trailingPer;
  const valuationLabel = Number.isFinite(forwardPer) ? "추정PER" : "PER";
  if (Number.isFinite(valuationPer)) {
    parts.push(`${valuationLabel} ${formatNumber(valuationPer, 1)}배`);
  }
  if (status === "supportive") {
    const suffix =
      Number.isFinite(valuationPer) && valuationPer >= 70
        ? "실적은 받쳐주지만 밸류 부담은 같이 점검해야 해."
        : "실적 흐름이 가격 신호를 받쳐줘.";
    return `${parts.join(", ")}로 ${suffix}`;
  }
  if (status === "caution") {
    return `${parts.join(", ")}라 실적/밸류 확인 전까지는 추천보다 관찰이 좋아.`;
  }
  if (severeValuationRisk) {
    return `${parts.join(", ")}라 고PER 부담이 커. 실적 재확인이 필요해.`;
  }
  if (Number.isFinite(epsGrowth) && epsGrowth > 0) {
    parts.push(`추정EPS ${formatSigned(epsGrowth, 1)}%`);
  }
  return `${parts.join(", ")}로 실적 근거는 중립이야.`;
}

async function fetchNaverRecentPriceRows(code) {
  const encodedCode = encodeURIComponent(code);
  const url = `https://m.stock.naver.com/api/stock/${encodedCode}/price`;
  const [rows, basic] = await Promise.all([
    JSON.parse(await fetchText(url, "application/json,text/plain,*/*")),
    fetchNaverStockBasic(code).catch(() => null),
  ]);
  if (!Array.isArray(rows)) return [];
  const preopenDate =
    basic?.marketStatus === "PREOPEN"
      ? String(basic.localTradedAt || "").slice(0, 10)
      : "";
  return rows
    .map((row) => ({
      close: parseKoreanNumber(row.closePrice),
      date: String(row.localTradedAt || "").slice(0, 10),
      high: parseKoreanNumber(row.highPrice),
      low: parseKoreanNumber(row.lowPrice),
      open: parseKoreanNumber(row.openPrice),
      volume: Number(row.accumulatedTradingVolume) || 0,
    }))
    .filter((row) => !preopenDate || row.date !== preopenDate)
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchNaverStockBasic(code) {
  const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`;
  return JSON.parse(await fetchText(url, "application/json,text/plain,*/*"));
}

function emptyStockRecommendationPayload({ condition, marketMonth, universe }) {
  return normalizeStockRecommendationPayload({
    generatedAt: "",
    comparisonMonthCount: 5,
    condition,
    marketMonth,
    matchCount: 0,
    results: [],
    saved: false,
    universe,
    universeCount: 0,
  });
}

function stockRecommendationCondition(
  minimumMarketCapKrw,
  { relativeBenchmark = "own market benchmark" } = {},
) {
  const hasMarketCap =
    Number.isFinite(Number(minimumMarketCapKrw)) && Number(minimumMarketCapKrw) > 0;
  return {
    breakout: "latest close reaches recent 21-trading-day closing high",
    dailyMfi: ">= 80",
    earlyWatch:
      "21-day volume >= 1.2x, 5-day average volume >= 1.8x, MFI >= 85, and 21-day return >= 30% or 21-day high breakout",
    observation:
      "21-day return >= 50%, relative return >= 30%p, MFI >= 70, near 21-day high, 21-day volume >= 1.0x, and 5-day volume >= 0.9x",
    invalidation:
      "exclude active picks if latest price is <= -8% from signal, below 10-day average, or <= -20% from recent 21-trading-day high",
    fundamentalValidation:
      "enrich picks with revenue growth, profit growth, and forward PER when available; Korean confirmed picks can be downgraded when support is weak",
    minimumHistoryDays: 127,
    ...(hasMarketCap ? { minimumMarketCapKrw } : {}),
    monthHighDrawdown: `>= ${RECOMMENDATION_MAX_MONTH_HIGH_DRAWDOWN}% from recent 21-trading-day high`,
    monthlyReturn: ">= 15% over recent 21 trading days",
    recentVolumeRatio: ">= 1.8x vs previous 105-trading-day daily average",
    relativeReturn: `>= 8% vs ${relativeBenchmark}`,
    setupScore: ">= 70",
    tenDayTrend: "close >= 10-day average for confirmed candidates",
    volumeRatio: ">= 1.8x vs previous 5 rolling 21-trading-day averages",
  };
}

function stockRecommendationResultPath(month, markets) {
  const marketSuffix = markets
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join("_")
    .toLowerCase();
  return path.join(
    ROOT,
    "screen_results",
    `kr_monthly_breakout_${month}_${marketSuffix}.json`,
  );
}

function usStockRecommendationResultPath(month) {
  return path.join(ROOT, "screen_results", `us_monthly_breakout_${month}.json`);
}

function currentKoreaMonth() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

async function fetchYahooQuote(source) {
  const symbol = encodeURIComponent(source.symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`;
  const json = JSON.parse(await fetchText(url, "application/json,text/plain,*/*"));
  const result = json.chart?.result?.[0];
  const meta = result?.meta;

  if (!result || !meta) {
    throw new Error(`Yahoo quote unavailable: ${source.symbol}`);
  }

  const scale = Number.isFinite(source.scale) ? source.scale : 1;
  const fullHistory = buildYahooHistory(result, meta, scale);
  let history = fullHistory.slice(-TREND_POINTS);
  let analysisHistory = fullHistory.slice(-ANALYSIS_POINTS);
  let price = Number.isFinite(meta.regularMarketPrice)
    ? meta.regularMarketPrice * scale
    : history.at(-1)?.value;
  let previous = getPreviousClose(result, history);
  let marketTime = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : history.at(-1)?.date || "";

  if (source.stooqSymbol) {
    const live = await fetchStooqLiveQuote(source.stooqSymbol).catch(() => null);
    if (live && Number.isFinite(live.close)) {
      price = live.close * scale;
      previous = Number.isFinite(live.open) && live.open > 0 ? live.open * scale : previous;
      marketTime = live.marketTime || marketTime;
      if (live.date) {
        const currentPoint = { date: live.date, value: price };
        const latest = fullHistory.at(-1);
        if (latest?.date === live.date) latest.value = price;
        else fullHistory.push(currentPoint);
        history = fullHistory.slice(-TREND_POINTS);
        analysisHistory = fullHistory.slice(-ANALYSIS_POINTS);
      }
    }
  }

  if (!Number.isFinite(price)) {
    throw new Error(`Yahoo quote price unavailable: ${source.symbol}`);
  }

  const change = Number.isFinite(previous) ? price - previous : 0;
  const changePercent =
    Number.isFinite(previous) && previous !== 0 ? (change / previous) * 100 : 0;

  return {
    change,
    changePercent,
    changeUnit: source.changeUnit || "",
    analysisHistory,
    currency: meta.currency || "",
    decimals: source.decimals,
    history,
    id: source.id,
    label: source.label,
    marketTime,
    previous,
    price,
    symbol: source.symbol,
    valueSuffix: source.valueSuffix || "",
  };
}

async function fetchStooqLiveQuote(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const text = await fetchText(url, "text/csv,text/plain,*/*");
  const rows = parseCsv(text);
  const row = rows[0] || {};
  const close = Number.parseFloat(row.Close);
  if (!Number.isFinite(close)) return null;
  const date = row.Date || "";
  const time = row.Time || "";
  return {
    close,
    date,
    high: Number.parseFloat(row.High),
    low: Number.parseFloat(row.Low),
    marketTime: date && time ? `${date}T${time}Z` : date,
    open: Number.parseFloat(row.Open),
    symbol: row.Symbol || symbol,
  };
}

function buildRelativeStrengthQuote({
  denominator,
  id,
  label,
  numerator,
  summary,
}) {
  const ratioSeries = buildRatioSeries(
    numerator?.analysisHistory,
    denominator?.analysisHistory,
  );
  const history = ratioSeries.slice(-TREND_POINTS);
  const analysisHistory = ratioSeries.slice(-ANALYSIS_POINTS);
  const trend = trendPercentFromValueRows(history);
  const dailySpread =
    Number(numerator?.changePercent) - Number(denominator?.changePercent);

  if (!Number.isFinite(trend)) {
    throw new Error(`${label} relative strength unavailable`);
  }

  return {
    analysisHistory,
    change: Number.isFinite(dailySpread) ? dailySpread : 0,
    changePercent: Number.isFinite(dailySpread) ? dailySpread : 0,
    changeText: `1일 ${formatSigned(dailySpread, 2)}p`,
    changeUnit: "p",
    decimals: 1,
    history,
    id,
    label,
    marketTime: latestMarketTime([numerator, denominator]),
    price: trend,
    summary,
    symbol: `${numerator?.symbol || ""}/${denominator?.symbol || ""}`,
    valueSuffix: "p",
  };
}

function buildMovingAverageBreadthQuote({ id, label, period, quotes, summary }) {
  const series = buildMovingAverageBreadthSeries(quotes, period);
  const history = series.slice(-TREND_POINTS);
  const analysisHistory = series.slice(-ANALYSIS_POINTS);
  const latest = history.at(-1);
  const previous = history.at(-2);

  if (!latest) {
    throw new Error(`${label} breadth unavailable`);
  }

  const change = previous ? latest.value - previous.value : 0;
  return {
    analysisHistory,
    change,
    changePercent: change,
    changeText: `1일 ${formatSigned(change, 1)}p`,
    changeUnit: "p",
    decimals: 1,
    history,
    id,
    label,
    marketTime: latestMarketTime(quotes),
    price: latest.value,
    summary,
    symbol: `${quotes.length} semi leaders > MA${period}`,
    valueSuffix: "%",
  };
}

function buildRatioSeries(numeratorRows = [], denominatorRows = []) {
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

function buildMovingAverageBreadthSeries(quotes, period) {
  const breadthByDate = new Map();
  for (const quote of quotes) {
    const rows = quote.analysisHistory || [];
    for (let index = period - 1; index < rows.length; index += 1) {
      const date = rows[index].date;
      const price = Number(rows[index].value);
      const ma = movingAverage(
        rows.slice(index - period + 1, index + 1).map((row) => Number(row.value)),
        period,
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

function latestMarketTime(quotes) {
  return quotes
    .map((quote) => quote?.marketTime)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

async function fetchFredQuote(source) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${source.seriesId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(url, {
    headers: {
      Accept: "text/csv,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`FRED series unavailable: ${source.seriesId}`);
  }

  const rows = parseCsv(await response.text())
    .map((row) => ({
      date: row.observation_date,
      value: Number.parseFloat(row[source.seriesId]),
    }))
    .filter((row) => row.date && Number.isFinite(row.value));
  const series = rows.slice(-TREND_POINTS);
  const analysisHistory = rows.slice(-ANALYSIS_POINTS);
  const latest = rows.at(-1);
  const previous = rows.at(-2);

  if (!latest) {
    throw new Error(`FRED series unavailable: ${source.seriesId}`);
  }

  const change = previous ? latest.value - previous.value : 0;
  return {
    change,
    changePercent:
      previous && previous.value !== 0 ? (change / previous.value) * 100 : 0,
    changeUnit: source.changeUnit || "",
    analysisHistory,
    decimals: source.decimals,
    history: series,
    id: source.id,
    label: source.label,
    marketTime: `${latest.date}T00:00:00Z`,
    previous: previous?.value ?? null,
    price: latest.value,
    symbol: source.seriesId,
    valueSuffix: source.valueSuffix || "",
  };
}

async function fetchNaverDailyHistory(code) {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(
    code,
  )}&timeframe=day&count=520&requestType=0`;
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
        volume: finiteNumber(volume),
      };
    })
    .filter(
      (row) =>
        row.date &&
        Number.isFinite(row.close) &&
        Number.isFinite(row.volume) &&
        row.close > 0,
    );

  if (!rows.length) {
    throw new Error(`Naver chart unavailable: ${code}`);
  }
  return rows;
}

async function fetchNaverInvestorFlow(code) {
  const url = `https://finance.naver.com/item/frgn.naver?code=${encodeURIComponent(code)}`;
  const html = new TextDecoder("euc-kr").decode(
    await fetchBinary(url, "text/html,*/*"),
  );
  const tableStart = html.indexOf("외국인ㆍ기관");
  if (tableStart < 0) {
    throw new Error(`Naver investor flow unavailable: ${code}`);
  }
  const table = html.slice(tableStart, tableStart + 50000);
  const rows = [...table.matchAll(/<tr[^>]*onMouseOver[\s\S]*?<\/tr>/gi)]
    .map((match) => {
      const cells = [...match[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (cell) => cleanHtml(cell[1]),
      );
      if (cells.length < 9) return null;
      const close = parseKoreanNumber(cells[1]);
      const volume = parseKoreanNumber(cells[4]);
      const institutionNet = parseKoreanNumber(cells[5]);
      const foreignNet = parseKoreanNumber(cells[6]);
      return {
        close,
        date: cells[0].replace(/\./g, "-"),
        foreignNet,
        holdingRate: Number.parseFloat(cells[8].replace(/%/g, "")),
        institutionNet,
        netShares: institutionNet + foreignNet,
        tradedValue: close * volume,
        volume,
      };
    })
    .filter(
      (row) =>
        row &&
        row.date &&
        Number.isFinite(row.close) &&
        Number.isFinite(row.volume) &&
        Number.isFinite(row.netShares),
    );

  if (!rows.length) {
    throw new Error(`Naver investor flow rows unavailable: ${code}`);
  }

  const netValue5 = sum(rows.slice(0, 5).map((row) => row.netShares * row.close));
  const tradedValue5 = sum(rows.slice(0, 5).map((row) => row.tradedValue));
  const netValue20 = sum(rows.slice(0, 20).map((row) => row.netShares * row.close));
  const tradedValue20 = sum(rows.slice(0, 20).map((row) => row.tradedValue));
  const ratio5 = tradedValue5 ? netValue5 / tradedValue5 : NaN;
  const ratio20 = tradedValue20 ? netValue20 / tradedValue20 : NaN;

  return {
    latestDate: rows[0]?.date || "",
    netValue5,
    netValue20,
    ratio5,
    ratio20,
    score: scoreFlowRatio(ratio5, ratio20),
  };
}

function buildPortfolioHoldingMetrics(rows) {
  const closes = rows.map((row) => row.close);
  const latest = rows.at(-1);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const high52 = Math.max(...closes.slice(-252).filter(Number.isFinite));
  const highProximity =
    latest && Number.isFinite(high52) && high52 > 0
      ? (latest.close / high52) * 100
      : null;
  return {
    analysisHistory: rows.slice(-ANALYSIS_POINTS).map((row) => ({
      date: row.date,
      value: row.close,
    })),
    history: rows.slice(-TREND_POINTS).map((row) => ({
      date: row.date,
      value: row.close,
    })),
    high52: Number.isFinite(high52) ? high52 : null,
    highProximity,
    latestClose: latest?.close ?? null,
    latestDate: latest?.date || "",
    ma50,
    ma200,
    pointCount: rows.length,
    trend28: trendPercentFromRows(rows.slice(-TREND_POINTS)),
  };
}


function buildYahooHistory(result, meta, scale = 1) {
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const history = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      value: Number(closes[index]) * scale,
    }))
    .filter((point) => point.date && Number.isFinite(point.value) && point.value > 0);

  if (Number.isFinite(meta.regularMarketPrice) && meta.regularMarketTime) {
    const marketDate = new Date(meta.regularMarketTime * 1000)
      .toISOString()
      .slice(0, 10);
    const latest = history.at(-1);
    if (latest?.date === marketDate) {
      latest.value = meta.regularMarketPrice * scale;
    } else {
      history.push({ date: marketDate, value: meta.regularMarketPrice * scale });
    }
  }

  return history;
}

function getPreviousClose(result, history) {
  if (history.length >= 2) {
    return history.at(-2).value;
  }

  const meta = result.meta || {};
  if (Number.isFinite(meta.chartPreviousClose)) {
    return meta.chartPreviousClose;
  }
  if (Number.isFinite(meta.previousClose)) {
    return meta.previousClose;
  }
  return NaN;
}

function parseFearGreed(csv) {
  const rows = parseCsv(csv)
    .map((row) => ({
      date: row.Date,
      rating: row.Rating || "",
      value: Number.parseFloat(row["Fear Greed"]),
    }))
    .filter((row) => row.date && Number.isFinite(row.value));
  const series = rows.slice(-TREND_POINTS);
  const analysisSeries = rows.slice(-ANALYSIS_POINTS);
  const latest = series.at(-1);
  const previous = series.at(-2);

  if (!latest) {
    throw new Error("Fear & Greed CSV did not include usable rows");
  }

  return {
    change: previous ? latest.value - previous.value : 0,
    date: latest.date,
    rating: latest.rating || getFearGreedRating(latest.value),
    score: latest.value,
    analysisSeries,
    series,
  };
}

function parseVix(csv) {
  const rows = parseCsv(csv)
    .map((row) => ({
      date: toIsoDate(row.DATE),
      value: Number.parseFloat(row.CLOSE),
    }))
    .filter((row) => row.date && Number.isFinite(row.value));
  const series = rows.slice(-TREND_POINTS);
  const analysisSeries = rows.slice(-ANALYSIS_POINTS);
  const latest = series.at(-1);
  const previous = series.at(-2);

  if (!latest) {
    throw new Error("VIX CSV did not include usable rows");
  }

  return {
    change: previous ? latest.value - previous.value : 0,
    close: latest.value,
    date: latest.date,
    analysisSeries,
    series,
  };
}

function fetchText(url, accept = "text/csv,text/plain,*/*") {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: accept,
          "User-Agent": "Mozilla/5.0",
        },
        timeout: 20000,
      },
      (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Request failed: ${response.statusCode} ${url}`));
          response.resume();
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      },
    );

    request.on("timeout", () => request.destroy(new Error(`Timeout: ${url}`)));
    request.on("error", reject);
  });
}

function fetchBinary(url, accept = "application/octet-stream,*/*") {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: accept,
          "User-Agent": "Mozilla/5.0",
        },
        timeout: 20000,
      },
      (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Request failed: ${response.statusCode} ${url}`));
          response.resume();
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );

    request.on("timeout", () => request.destroy(new Error(`Timeout: ${url}`)));
    request.on("error", reject);
  });
}

async function serveStatic(pathname, response) {
  const safePath =
    pathname === "/"
      ? "/index.html"
      : pathname === "/traffic" || pathname === "/traffic/"
        ? "/traffic.html"
        : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const file = await readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": getContentType(filePath),
  });
  response.end(file);
}

function trackTraffic(request, response, url) {
  if (!shouldTrackTraffic(request, url)) return;

  const startedAt = Date.now();
  const eventBase = {
    at: new Date(startedAt).toISOString(),
    ip: maskedTrafficIp(rawTrafficIp(request)),
    kind: trafficKind(url.pathname),
    method: request.method || "GET",
    path: normalizeTrafficPath(url.pathname),
    visitorId: anonymizedVisitorId(request),
  };

  response.on("finish", () => {
    trafficEvents.push({
      ...eventBase,
      durationMs: Date.now() - startedAt,
      status: response.statusCode,
    });
    pruneTrafficEvents();
  });
}

function shouldTrackTraffic(request, url) {
  if ((request.method || "GET") !== "GET") return false;
  if (url.pathname === "/api/traffic") return false;
  if (url.pathname === "/traffic" || url.pathname === "/traffic/") return false;
  if (url.pathname === "/traffic.js") return false;
  if (url.pathname === "/traffic.html") return false;
  if (url.pathname === "/favicon.ico") return false;
  if (/\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname)) {
    return false;
  }
  return true;
}

function normalizeTrafficPath(pathname) {
  if (pathname === "/index.html") return "/";
  if (pathname === "/traffic.html" || pathname === "/traffic/") return "/traffic";
  return pathname || "/";
}

function trafficKind(pathname) {
  if (pathname.startsWith("/api/")) return "api";
  return "page";
}

function anonymizedVisitorId(request) {
  const ip = rawTrafficIp(request);
  const userAgent = String(request.headers["user-agent"] || "");
  return crypto
    .createHash("sha256")
    .update(`${TRAFFIC_VISITOR_SALT}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 16);
}

function rawTrafficIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwardedFor || request.socket.remoteAddress || "";
}

function maskedTrafficIp(ip) {
  const value = String(ip || "").replace(/^::ffff:/, "");
  if (!value) return "-";
  if (value === "::1" || value === "127.0.0.1") return "local";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.replace(/\.\d{1,3}$/, ".xxx");
  }
  if (value.includes(":")) {
    const parts = value.split(":").filter(Boolean);
    return parts.length ? `${parts.slice(0, 4).join(":")}:…` : "IPv6";
  }
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function pruneTrafficEvents() {
  const cutoff = Date.now() - TRAFFIC_RETENTION_MS;
  while (
    trafficEvents.length > TRAFFIC_EVENT_LIMIT ||
    (trafficEvents.length && Date.parse(trafficEvents[0].at) < cutoff)
  ) {
    trafficEvents.shift();
  }
}

function getTrafficSummary() {
  const now = Date.now();
  const windows = [
    { id: "1h", label: "최근 1시간", ms: 60 * 60 * 1000 },
    { id: "24h", label: "최근 24시간", ms: 24 * 60 * 60 * 1000 },
    { id: "30d", label: "최근 30일", ms: 30 * 24 * 60 * 60 * 1000 },
  ];
  const pageEvents = trafficEvents.filter((event) => event.kind === "page");
  return {
    generatedAt: new Date(now).toISOString(),
    kpi: buildTrafficKpis(pageEvents, now),
    retentionDays: 31,
    startedAt: trafficStartedAt,
    recent: trafficEvents
      .slice(-30)
      .reverse()
      .map(({ at, durationMs, ip, kind, method, path: eventPath, status }) => ({
        at,
        durationMs,
        ip,
        kind,
        method,
        path: eventPath,
        status,
      })),
    windows: windows.map((window) => ({
      id: window.id,
      label: window.label,
      ...summarizeTrafficWindow(
        trafficEvents.filter((event) => Date.parse(event.at) >= now - window.ms),
      ),
    })),
  };
}

function buildTrafficKpis(pageEvents, now) {
  const todayKey = trafficDayKey(now);
  const monthKey = trafficMonthKey(now);
  const dailyEvents = pageEvents.filter((event) => trafficDayKey(Date.parse(event.at)) === todayKey);
  const monthlyEvents = pageEvents.filter(
    (event) => trafficMonthKey(Date.parse(event.at)) === monthKey,
  );
  const thirtyDayEvents = pageEvents.filter(
    (event) => Date.parse(event.at) >= now - 30 * 24 * 60 * 60 * 1000,
  );
  return {
    dau: uniqueTrafficVisitors(dailyEvents),
    mau: uniqueTrafficVisitors(monthlyEvents),
    pv30d: thirtyDayEvents.length,
    pvToday: dailyEvents.length,
    pvThisMonth: monthlyEvents.length,
  };
}

function uniqueTrafficVisitors(events) {
  return new Set(events.map((event) => event.visitorId)).size;
}

function trafficDayKey(timestamp) {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function trafficMonthKey(timestamp) {
  return trafficDayKey(timestamp).slice(0, 7);
}

function summarizeTrafficWindow(events) {
  const visitors = new Set(events.map((event) => event.visitorId));
  const pageViews = events.filter((event) => event.kind === "page").length;
  const apiRequests = events.filter((event) => event.kind === "api").length;
  const errorRequests = events.filter((event) => Number(event.status) >= 400).length;
  return {
    apiRequests,
    avgDurationMs: roundFinite(average(events.map((event) => event.durationMs)), 0),
    errorRequests,
    pageViews,
    topPaths: topTrafficPaths(events),
    totalRequests: events.length,
    uniqueVisitors: visitors.size,
  };
}

function topTrafficPaths(events) {
  const pathCounts = new Map();
  for (const event of events) {
    const current = pathCounts.get(event.path) || { path: event.path, requests: 0 };
    current.requests += 1;
    pathCounts.set(event.path, current);
  }
  return [...pathCounts.values()]
    .sort((a, b) => b.requests - a.requests || a.path.localeCompare(b.path))
    .slice(0, 8);
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function getContentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function parseCsv(csv) {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
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
    if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values.map((item) => item.trim());
}

function decodeHtmlEntity(value) {
  return normalizeText(value)
    .replace(/&amp;#0?39;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHtml(value) {
  return decodeHtmlEntity(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function parseKoreanNumber(value) {
  const text = String(value || "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/[％%]/g, "");
  if (!text || text === "-") return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function parseOptionalKoreanNumber(value) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/[％%배원]/g, "");
  if (!text || text === "-" || /^N\/?A$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function average(values) {
  const cleanValues = values.map(Number).filter(Number.isFinite);
  if (!cleanValues.length) return NaN;
  return sum(cleanValues) / cleanValues.length;
}

function movingAverage(values, period) {
  if (values.length < period) return null;
  const recent = values.slice(-period).filter(Number.isFinite);
  if (recent.length < period) return null;
  return sum(recent) / period;
}

function percentChange(current, previous) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(previousValue) ||
    previousValue === 0
  ) {
    return NaN;
  }
  return ((currentValue - previousValue) / previousValue) * 100;
}

function percentChangeWithSignedBase(current, previous) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(previousValue) ||
    previousValue === 0
  ) {
    return NaN;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function roundFinite(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function trendPercentFromValueRows(rows) {
  const first = Number(rows[0]?.value);
  const last = Number(rows.at(-1)?.value);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return null;
  }
  return ((last - first) / first) * 100;
}

function trendPercentFromRows(rows) {
  const first = rows[0]?.close;
  const last = rows.at(-1)?.close;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return null;
  }
  return ((last - first) / first) * 100;
}

function formatSigned(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number >= 0 ? "+" : ""}${number.toFixed(decimals)}`;
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(decimals);
}

function scoreFlowRatio(ratio5, ratio20) {
  if (!Number.isFinite(ratio5) && !Number.isFinite(ratio20)) return null;

  let score = 0;
  if (Number.isFinite(ratio5)) {
    if (ratio5 >= 0.04) score += 0.7;
    else if (ratio5 >= 0.015) score += 0.35;
    else if (ratio5 <= -0.04) score -= 0.7;
    else if (ratio5 <= -0.015) score -= 0.35;
  }
  if (Number.isFinite(ratio20)) {
    if (ratio20 >= 0.025) score += 0.25;
    else if (ratio20 <= -0.025) score -= 0.25;
  }
  return Math.max(-1, Math.min(1, score));
}

function getFearGreedRating(score) {
  if (score < 25) return "extreme fear";
  if (score < 45) return "fear";
  if (score < 55) return "neutral";
  if (score < 75) return "greed";
  return "extreme greed";
}

function toIsoDate(usDate) {
  const [month, day, year] = usDate.split("/");
  if (!month || !day || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
