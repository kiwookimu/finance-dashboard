const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { readFile } = require("node:fs/promises");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const MARKET_CACHE_MS = 60 * 1000;
const SENTIMENT_CACHE_MS = 15 * 60 * 1000;
const TREND_POINTS = 28;

const MARKET_SOURCES = [
  { id: "kospi", label: "KOSPI", symbol: "^KS11", decimals: 2 },
  { id: "sp500", label: "S&P 500", symbol: "^GSPC", decimals: 2 },
  { id: "nasdaq", label: "NASDAQ", symbol: "^IXIC", decimals: 2 },
  { id: "sox", label: "SOX", symbol: "^SOX", decimals: 2 },
  { id: "usdKrw", label: "USD/KRW", symbol: "KRW=X", decimals: 1 },
  { id: "wti", label: "WTI", symbol: "CL=F", decimals: 2 },
  {
    id: "us10y",
    label: "미국 10년물 금리",
    symbol: "^TNX",
    decimals: 2,
    valueSuffix: "%",
    changeUnit: "p",
  },
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

let cachedMarketOverview = null;
let cachedMarketAt = 0;
let cachedSentiment = null;
let cachedSentimentAt = 0;

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

  const [quotes, ddr5Spot, serverDdr5Contract, dxi] = await Promise.all([
    Promise.all(MARKET_SOURCES.map(fetchYahooQuote)),
    fetchTrendForceDdr5Spot(),
    fetchTrendForceServerDdr5Contract(),
    fetchDramExchangeDxi(),
  ]);
  cachedMarketOverview = {
    cached: false,
    generatedAt: new Date().toISOString(),
    quotes: Object.fromEntries(
      [...quotes, ddr5Spot, serverDdr5Contract, dxi].map((quote) => [
        quote.id,
        quote,
      ]),
    ),
    sources: {
      quote: "Yahoo Finance chart endpoint",
      trendForce: "TrendForce DRAM spot price table",
      trendForceServerDimm: "TrendForce Server DIMM Contract Price report summary",
      dxi: "DRAMeXchange Market Activity DXI timestamp",
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

async function fetchYahooQuote(source) {
  const symbol = encodeURIComponent(source.symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`;
  const json = JSON.parse(await fetchText(url, "application/json,text/plain,*/*"));
  const result = json.chart?.result?.[0];
  const meta = result?.meta;

  if (!result || !meta) {
    throw new Error(`Yahoo quote unavailable: ${source.symbol}`);
  }

  const scale = Number.isFinite(source.scale) ? source.scale : 1;
  const history = buildYahooHistory(result, meta, scale);
  const price = Number.isFinite(meta.regularMarketPrice)
    ? meta.regularMarketPrice * scale
    : history.at(-1)?.value;
  const previous = getPreviousClose(result, history);

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
    currency: meta.currency || "",
    decimals: source.decimals,
    history,
    id: source.id,
    label: source.label,
    marketTime: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : history.at(-1)?.date || "",
    previous,
    price,
    symbol: source.symbol,
    valueSuffix: source.valueSuffix || "",
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

  return history.slice(-TREND_POINTS);
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
  const latest = series.at(-1);
  const previous = series.at(-2);

  if (!latest) {
    throw new Error("VIX CSV did not include usable rows");
  }

  return {
    change: previous ? latest.value - previous.value : 0,
    close: latest.value,
    date: latest.date,
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
          "User-Agent": "FinanceDashboard/1.0",
        },
        timeout: 10000,
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
