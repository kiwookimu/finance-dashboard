const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const { promisify } = require("node:util");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const MARKET_CACHE_MS = 60 * 1000;
const SENTIMENT_CACHE_MS = 15 * 60 * 1000;
const PORTFOLIO_CACHE_MS = 5 * 60 * 1000;
const STOCK_RECOMMENDATION_CACHE_MS = 30 * 60 * 1000;
const TREND_POINTS = 28;
const ANALYSIS_POINTS = 260;
const execFileAsync = promisify(execFile);

const MARKET_SOURCES = [
  { id: "kospi", label: "KOSPI", symbol: "^KS11", decimals: 2 },
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
  serverDdr5Contract: "https://www.trendforce.com/research/download/RP260430SD",
  dxi: "https://www.dramexchange.com/Market/Market_Activity/1000",
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
  { amount: 5003575, benchmark: "nasdaq", code: "418670", id: "tigerAiCyber", name: "TIGER 글로벌AI사이버보안", tags: ["aiPower", "cyber", "global"] },
  { amount: 5006750, benchmark: "nasdaq", code: "0183J0", id: "tigerUsSpaceTech", name: "TIGER 미국우주테크", tags: ["space", "us"] },
  { amount: 5012995, benchmark: "nasdaq", code: "0173Y0", id: "kodexAiOpticalNetwork", name: "KODEX 미국AI광통신네트워크", tags: ["aiPower", "network", "us"] },
  { amount: 5035970, benchmark: "nasdaq", code: "0023A0", id: "solUsQuantumTop10", name: "SOL 미국양자컴퓨팅TOP10", tags: ["quantum", "us"] },
  { amount: 0, benchmark: "nasdaq", code: "491010", id: "tigerGlobalAiPowerInfra", name: "TIGER 글로벌AI전력인프라액티브", tags: ["aiPower", "global"] },
  { amount: 0, benchmark: "kospi", code: "367760", id: "riseNetworkInfra", name: "RISE 네트워크인프라", tags: ["network", "korea"] },
];

let cachedMarketOverview = null;
let cachedMarketAt = 0;
let cachedSentiment = null;
let cachedSentimentAt = 0;
let cachedPortfolio = null;
let cachedPortfolioAt = 0;
let cachedStockRecommendations = null;
let cachedStockRecommendationsAt = 0;
let stockRecommendationRefreshPromise = null;
let cachedUsStockRecommendations = null;
let cachedUsStockRecommendationsAt = 0;
let usStockRecommendationRefreshPromise = null;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/health") {
      sendJson(response, { ok: true, service: "finance-dashboard" });
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
          forceRefresh: url.searchParams.get("refresh") === "1",
        }),
      );
      return;
    }

    if (url.pathname === "/api/us-stock-recommendations") {
      sendJson(
        response,
        await getUsStockRecommendations({
          forceRefresh: url.searchParams.get("refresh") === "1",
        }),
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

  const [
    quotes,
    derivedYahooQuotes,
    semiLeaderQuotes,
    fredQuotes,
    ddr5Spot,
    serverDdr5Contract,
    dxi,
  ] = await Promise.all([
    Promise.all(MARKET_SOURCES.map(fetchYahooQuote)),
    Promise.all(DERIVED_YAHOO_SOURCES.map(fetchYahooQuote)),
    Promise.all(SEMI_LEADER_SOURCES.map(fetchYahooQuote)),
    Promise.all(FRED_SOURCES.map(fetchFredQuote)),
    fetchTrendForceDdr5Spot(),
    fetchTrendForceServerDdr5Contract(),
    fetchDramExchangeDxi(),
  ]);
  const derivedById = Object.fromEntries(
    derivedYahooQuotes.map((quote) => [quote.id, quote]),
  );
  const syntheticQuotes = [
    buildRelativeStrengthQuote({
      id: "nasdaqBreadth",
      label: "NASDAQ 시장 폭",
      numerator: derivedById.qqqe,
      denominator: derivedById.qqq,
      summary: "QQQE/QQQ 28일 상대강도",
    }),
    buildRelativeStrengthQuote({
      id: "sp500Breadth",
      label: "S&P 500 시장 폭",
      numerator: derivedById.rsp,
      denominator: derivedById.spy,
      summary: "RSP/SPY 28일 상대강도",
    }),
    buildRelativeStrengthQuote({
      id: "semiLeadership",
      label: "반도체/QQQ 상대강도",
      numerator: derivedById.smh,
      denominator: derivedById.qqq,
      summary: "SMH/QQQ 28일 상대강도",
    }),
    buildMovingAverageBreadthQuote({
      id: "semiBreadth",
      label: "반도체 리더 폭",
      period: 50,
      quotes: semiLeaderQuotes,
      summary: "주요 반도체 7종목 50일선 상회 비율",
    }),
  ];
  cachedMarketOverview = {
    cached: false,
    generatedAt: new Date().toISOString(),
    quotes: Object.fromEntries(
      [
        ...quotes,
        ...syntheticQuotes,
        derivedById.vix3m,
        ...fredQuotes,
        ddr5Spot,
        serverDdr5Contract,
        dxi,
      ].map((quote) => [quote.id, quote]),
    ),
    sources: {
      quote: "Yahoo Finance chart endpoint",
      breadth: "Yahoo Finance ETF and semiconductor leader basket",
      trendForce: "TrendForce DRAM spot price table",
      trendForceServerDimm: "TrendForce Server DIMM Contract Price report summary",
      dxi: "DRAMeXchange Market Activity DXI timestamp",
      fred: "FRED CSV series",
    },
  };
  cachedMarketAt = now;

  return cachedMarketOverview;
}

async function fetchDramExchangeDxi() {
  const html = await fetchText(TREND_FORCE_SOURCES.dxi, "text/html,*/*");
  const rawTimestamp =
    html.match(/id="ctl00_ContentPlaceHolder1_DXI1_idxs_date"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
    "";
  const marketTimeText = normalizeText(
    decodeHtmlEntity(rawTimestamp.replace(/<[^>]+>/g, " ")),
  );

  if (!marketTimeText) {
    throw new Error("DRAMeXchange DXI timestamp unavailable");
  }

  return {
    change: 0,
    changeClass: "",
    changePercent: 0,
    changeText: `${marketTimeText} 기준`,
    analysisHistory: [],
    decimals: 0,
    history: [],
    id: "dxi",
    label: "DXI Index",
    marketTime: parseDramExchangeDxiTime(marketTimeText),
    price: null,
    reportUrl: "https://www.dramexchange.com/Market/DXI",
    sparklineText: "DXI 비공개",
    symbol: "DRAMeXchange Index",
    valueText: "로그인 필요",
  };
}

async function fetchTrendForceServerDdr5Contract() {
  const html = await fetchText(TREND_FORCE_SOURCES.serverDdr5Contract, "text/html,*/*");
  const title = decodeHtmlEntity(
    html.match(/<h1 class="report-overview-title">([^<]+)<\/h1>/i)?.[1] ||
      html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
      "Server DIMM Price",
  ).replace(/\s+\|\s+TrendForce$/i, "");
  const lastModified = normalizeText(
    html.match(/Last Modified<\/p>\s*<p[^>]*>([^<]+)<\/p>/i)?.[1] ||
      html.match(/"datePublished":\s*"([^"]+)"/i)?.[1] ||
      "",
  );
  const summary = decodeHtmlEntity(
    html.match(/<meta name="description" content="([^"]+)"/i)?.[1] ||
      html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1] ||
      "",
  );
  const isPrivate = html.includes('"isAccessibleForFree": "False"');

  if (!summary) {
    throw new Error("TrendForce server DDR5 contract summary unavailable");
  }

  return {
    change: 0,
    changeClass: "positive",
    changePercent: 0,
    changeText: `${extractReportMonth(title)} · 상승 지속`,
    analysisHistory: [],
    decimals: 0,
    history: [],
    id: "serverDdr5Contract",
    label: "Server DDR5 Contract Price",
    marketTime: lastModified ? `${lastModified.slice(0, 10)}T00:00:00+08:00` : "",
    price: null,
    reportTitle: title,
    reportUrl: TREND_FORCE_SOURCES.serverDdr5Contract,
    sparklineText: isPrivate ? "가격 비공개" : "현재값만 공개",
    summary,
    symbol: "Server DIMM Contract Price",
    valueText: isPrivate ? "멤버십 비공개" : "공개 요약",
  };
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

  cachedPortfolio = {
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
  cachedPortfolioAt = now;
  return cachedPortfolio;
}

async function getStockRecommendations({ forceRefresh = false } = {}) {
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
      cachedStockRecommendations = normalizeStockRecommendationPayload(filePayload, {
        cached: false,
        refreshed: false,
        saved: true,
      });
      cachedStockRecommendationsAt = now;
      return cachedStockRecommendations;
    }
    return emptyStockRecommendationPayload({
      condition: stockRecommendationCondition(1_000_000_000_000),
      marketMonth: month,
      universe: "Saved Korea recommendation screen is not available yet",
    });
  }

  if (!stockRecommendationRefreshPromise) {
    stockRecommendationRefreshPromise = refreshStockRecommendations(month, markets)
      .catch(async (error) => {
        const fallback = await readStockRecommendationFile(resultPath).catch(() => null);
        if (fallback) {
          return normalizeStockRecommendationPayload(fallback, {
            cached: false,
            refreshError: error.message,
            refreshed: false,
            stale: true,
          });
        }
        throw error;
      })
      .finally(() => {
        stockRecommendationRefreshPromise = null;
      });
  }

  cachedStockRecommendations = await stockRecommendationRefreshPromise;
  cachedStockRecommendationsAt = Date.now();
  return cachedStockRecommendations;
}

async function getUsStockRecommendations({ forceRefresh = false } = {}) {
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
      cachedUsStockRecommendations = normalizeStockRecommendationPayload(
        filePayload,
        {
          cached: false,
          refreshed: false,
          saved: true,
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

  if (!usStockRecommendationRefreshPromise) {
    usStockRecommendationRefreshPromise = refreshUsStockRecommendations(month)
      .catch(async (error) => {
        const fallback = await readStockRecommendationFile(resultPath).catch(() => null);
        if (fallback) {
          return normalizeStockRecommendationPayload(fallback, {
            cached: false,
            refreshError: error.message,
            refreshed: false,
            stale: true,
          });
        }
        throw error;
      })
      .finally(() => {
        usStockRecommendationRefreshPromise = null;
      });
  }

  cachedUsStockRecommendations = await usStockRecommendationRefreshPromise;
  cachedUsStockRecommendationsAt = Date.now();
  return cachedUsStockRecommendations;
}

async function refreshStockRecommendations(month, markets) {
  const scriptPath = path.join(ROOT, "scripts", "screen_kr_monthly_breakout.mjs");
  await execFileAsync(
    process.execPath,
    [scriptPath, month, "5", "1000000000000", markets],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SCREEN_CONCURRENCY: process.env.SCREEN_CONCURRENCY || "8",
      },
      maxBuffer: 20 * 1024 * 1024,
      timeout: 180000,
    },
  );
  return normalizeStockRecommendationPayload(
    await readStockRecommendationFile(stockRecommendationResultPath(month, markets)),
    { cached: false, refreshed: true },
  );
}

async function refreshUsStockRecommendations(month) {
  const scriptPath = path.join(ROOT, "scripts", "screen_us_monthly_breakout.mjs");
  await execFileAsync(
    process.execPath,
    [scriptPath, month, "5", "10000000000000"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SCREEN_CONCURRENCY: process.env.SCREEN_CONCURRENCY || "4",
      },
      maxBuffer: 20 * 1024 * 1024,
      timeout: 900000,
    },
  );
  return normalizeStockRecommendationPayload(
    await readStockRecommendationFile(usStockRecommendationResultPath(month)),
    { cached: false, refreshed: true },
  );
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
  return {
    breakout: "target month close exceeds previous comparison-month closing high",
    dailyMfi: ">= 70",
    minimumHistoryMonths: 4,
    minimumMarketCapKrw,
    monthlyReturn: ">= 15% vs previous month close",
    relativeReturn: `>= 8% vs ${relativeBenchmark}`,
    setupScore: ">= 70",
    volumeRatio: ">= 1.8x vs previous 5-month average",
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
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const file = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": getContentType(filePath),
  });
  response.end(file);
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

function extractReportMonth(title) {
  const match = title.match(/\b([A-Z][a-z]{2}\.?\s+\d{4})\b/);
  return match ? match[1].replace(".", "") : "월간 리포트";
}

function parseDramExchangeDxiTime(value) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const match = value.match(/([A-Z][a-z]{2})\.?(\d{1,2}),\s*(\d{1,2}):(\d{2})/);
  if (!match) return "";

  const month = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  }[match[1]];

  if (!Number.isInteger(month)) return "";

  const date = new Date(
    Date.UTC(
      year,
      month,
      Number(match[2]),
      Number(match[3]) - 8,
      Number(match[4]),
    ),
  );
  return date.toISOString();
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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function movingAverage(values, period) {
  if (values.length < period) return null;
  const recent = values.slice(-period).filter(Number.isFinite);
  if (recent.length < period) return null;
  return sum(recent) / period;
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
