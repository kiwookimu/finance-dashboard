const MARKET_MONTH = process.argv[2] || "2025-09";
const COMPARISON_MONTH_COUNT = Number(
  process.env.COMPARE_MONTHS || process.argv[3] || 5,
);
const MIN_MARKET_CAP_KRW = Number(
  process.env.MIN_MARKET_CAP_KRW || process.argv[4] || 1_000_000_000_000,
);
const CONCURRENCY = Number(process.env.SCREEN_CONCURRENCY || 4);
const LIMIT = Number(process.env.SCREEN_LIMIT || 0);
const SYMBOL_FILTER = new Set(
  (process.env.SCREEN_SYMBOLS || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean),
);
const MIN_HISTORY_MONTHS = Number(process.env.MIN_HISTORY_MONTHS || 4);
const MIN_SETUP_SCORE = Number(process.env.MIN_SETUP_SCORE || 70);
const MIN_VOLUME_RATIO = Number(process.env.MIN_VOLUME_RATIO || 1.8);
const MIN_MONTHLY_RETURN = Number(process.env.MIN_MONTHLY_RETURN || 15);
const MIN_RELATIVE_RETURN = Number(process.env.MIN_RELATIVE_RETURN || 8);
const MIN_MFI = Number(process.env.MIN_MFI || 70);
const BENCHMARK_SYMBOL = process.env.BENCHMARK_SYMBOL || "QQQ";
const NASDAQ_LISTED =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_LISTED =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const NASDAQ_API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
  "User-Agent": "Mozilla/5.0",
};

const usdKrw = await fetchUsdKrw();
const minimumMarketCapUsd = MIN_MARKET_CAP_KRW / usdKrw;
const benchmarkRows = await fetchYahooDaily(
  BENCHMARK_SYMBOL,
  historyStartDate(),
  historyEndDate(),
);
const benchmarkMonths = monthlyBars(benchmarkRows);
const allUniverse = await fetchUsUniverse();
const universe = filteredUniverse(allUniverse).slice(0, LIMIT || undefined);
const results = [];
const failures = [];
let completed = 0;

await runPool(universe, CONCURRENCY, async (stock) => {
  try {
    const rows = await fetchNasdaqDaily(stock);
    const screening = screenStock(stock, rows, benchmarkMonths);
    if (!screening) return;

    const marketCapUsd = await fetchNasdaqMarketCapUsd(stock);
    if (marketCapUsd < minimumMarketCapUsd) return;
    results.push({
      ...screening,
      marketCapKrw: Math.round(marketCapUsd * usdKrw),
      marketCapUsd: Math.round(marketCapUsd),
    });
  } catch (error) {
    failures.push({ ...stock, error: error.message });
  } finally {
    completed += 1;
    if (completed % 100 === 0 || completed === universe.length) {
      console.error(`checked ${completed}/${universe.length}`);
    }
  }
});

results.sort(
  (a, b) =>
    b.setupScore - a.setupScore ||
    b.relativeReturn - a.relativeReturn ||
    b.volumeRatio - a.volumeRatio,
);

const payload = {
  generatedAt: new Date().toISOString(),
  benchmark: BENCHMARK_SYMBOL,
  comparisonMonthCount: COMPARISON_MONTH_COUNT,
  condition: {
    breakout: "target month close exceeds previous comparison-month closing high",
    dailyMfi: `>= ${MIN_MFI}`,
    minimumHistoryMonths: MIN_HISTORY_MONTHS,
    minimumMarketCapKrw: MIN_MARKET_CAP_KRW,
    minimumMarketCapUsd: Math.round(minimumMarketCapUsd),
    monthlyReturn: `>= ${MIN_MONTHLY_RETURN}% vs previous month close`,
    relativeReturn: `>= ${MIN_RELATIVE_RETURN}% vs ${BENCHMARK_SYMBOL}`,
    setupScore: `>= ${MIN_SETUP_SCORE}`,
    volumeRatio: `>= ${MIN_VOLUME_RATIO}x vs previous ${COMPARISON_MONTH_COUNT}-month average`,
  },
  exchangeRate: {
    pair: "USD/KRW",
    value: round(usdKrw, 4),
  },
  marketMonth: MARKET_MONTH,
  note:
    "Forward returns are included only for historical review and are not used in the screen.",
  universe:
    SYMBOL_FILTER.size > 0
      ? `Manual symbols: ${[...SYMBOL_FILTER].join(", ")}`
      : "Nasdaq Trader listed U.S. common stocks and ADRs; ETFs, units, warrants, rights, preferreds, funds, SPAC/acquisition vehicles, and test issues excluded",
  universeCount: universe.length,
  matchCount: results.length,
  failureCount: failures.length,
  results,
};

const outStem = `screen_results/us_monthly_breakout_${MARKET_MONTH}`;
await writeFile(`${outStem}.json`, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(`${outStem}.csv`, toCsv(results));

console.log(JSON.stringify(payload, null, 2));

function screenStock(stock, rows, benchmarkMonthlyBars) {
  const months = monthlyBars(rows);
  const monthMap = new Map(months.map((month) => [month.month, month]));
  const current = monthMap.get(MARKET_MONTH);
  if (!current) return null;

  const previousMonthKeys = previousMonths(MARKET_MONTH, COMPARISON_MONTH_COUNT);
  const previous = previousMonthKeys
    .map((month) => monthMap.get(month))
    .filter(Boolean);
  if (previous.length < MIN_HISTORY_MONTHS) return null;

  const previousAverageVolume = average(previous.map((month) => month.volume));
  if (!previousAverageVolume) return null;

  const previousMonth = previous.at(-1);
  const previousCloseHigh = Math.max(...previous.map((month) => month.close));
  const targetReturn = percentChange(current.close, previousMonth.close);
  const firstToLastReturn = percentChange(current.close, current.firstClose);
  const volumeRatio = current.volume / previousAverageVolume;
  const breakout = current.close > previousCloseHigh;
  const benchmarkReturn = benchmarkMonthReturn(benchmarkMonthlyBars, MARKET_MONTH);
  const relativeReturn = Number.isFinite(benchmarkReturn)
    ? targetReturn - benchmarkReturn
    : NaN;
  const mfi = calculateMfi(
    rows.filter((row) => row.date <= current.lastDate),
    14,
  );
  const trailing3Average = average(
    [...previous.slice(-2), current].map((month) => month.close),
  );
  const aboveTrailing3Average = current.close > trailing3Average;
  const setupScore = monthlyBreakoutScore({
    aboveTrailing3Average,
    breakout,
    mfi,
    relativeReturn,
    targetReturn,
    volumeRatio,
  });

  if (
    setupScore < MIN_SETUP_SCORE ||
    volumeRatio < MIN_VOLUME_RATIO ||
    targetReturn < MIN_MONTHLY_RETURN ||
    relativeReturn < MIN_RELATIVE_RETURN ||
    !breakout ||
    mfi < MIN_MFI
  ) {
    return null;
  }

  return {
    aboveTrailing3Average,
    benchmarkReturn: round(benchmarkReturn, 2),
    breakout,
    exchange: stock.exchange,
    firstToLastReturn: round(firstToLastReturn, 2),
    lastClose: round(current.close, 4),
    lastDate: current.lastDate,
    mfi: round(mfi, 2),
    monthlyReturn: round(targetReturn, 2),
    name: stock.name,
    next1mReturn: round(forwardReturn(monthMap, MARKET_MONTH, 1), 2),
    next3mReturn: round(forwardReturn(monthMap, MARKET_MONTH, 3), 2),
    next6mReturn: round(forwardReturn(monthMap, MARKET_MONTH, 6), 2),
    previousAverageVolume: Math.round(previousAverageVolume),
    previousCloseHigh: round(previousCloseHigh, 4),
    previousMonthClose: round(previousMonth.close, 4),
    rawSymbol: stock.rawSymbol,
    relativeReturn: round(relativeReturn, 2),
    setupScore,
    signal: setupScore >= 85 ? "강한 월간 상승 후보" : "월간 상승 후보",
    symbol: stock.symbol,
    targetMonthVolume: Math.round(current.volume),
    volumeRatio: round(volumeRatio, 2),
  };
}

function monthlyBreakoutScore({
  aboveTrailing3Average,
  breakout,
  mfi,
  relativeReturn,
  targetReturn,
  volumeRatio,
}) {
  let score = 0;
  score += Math.min(25, (volumeRatio / MIN_VOLUME_RATIO) * 25);
  score += Math.min(20, (targetReturn / MIN_MONTHLY_RETURN) * 20);
  score += Math.min(15, (relativeReturn / MIN_RELATIVE_RETURN) * 15);
  score += breakout ? 20 : 0;
  score += aboveTrailing3Average ? 10 : 0;
  score += Math.min(10, (mfi / MIN_MFI) * 10);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function monthlyBars(rows) {
  const groups = new Map();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(row);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => {
      const sorted = items.sort((a, b) => a.date.localeCompare(b.date));
      return {
        close: sorted.at(-1).close,
        firstClose: sorted[0].close,
        firstDate: sorted[0].date,
        high: Math.max(...sorted.map((row) => row.high)),
        lastDate: sorted.at(-1).date,
        low: Math.min(...sorted.map((row) => row.low)),
        month,
        open: sorted[0].open,
        volume: sum(sorted.map((row) => row.volume)),
      };
    });
}

function benchmarkMonthReturn(months, month) {
  const monthMap = new Map(months.map((item) => [item.month, item]));
  const current = monthMap.get(month);
  const previous = monthMap.get(previousMonths(month, 1)[0]);
  if (!current || !previous) return NaN;
  return percentChange(current.close, previous.close);
}

function forwardReturn(monthMap, month, monthsForward) {
  const current = monthMap.get(month);
  const target = monthMap.get(shiftMonth(month, monthsForward));
  if (!current || !target) return NaN;
  return percentChange(target.close, current.close);
}

async function fetchUsUniverse() {
  const [nasdaqText, otherText] = await Promise.all([
    fetchText(NASDAQ_LISTED),
    fetchText(OTHER_LISTED),
  ]);

  const nasdaq = parsePipeTable(nasdaqText)
    .filter((row) => row.Symbol && row.Symbol !== "File Creation Time")
    .map((row) => ({
      exchange: "NASDAQ",
      name: row["Security Name"],
      symbol: normalizeNasdaqSymbol(row.Symbol),
      rawSymbol: row.Symbol,
      etf: row.ETF,
      testIssue: row["Test Issue"],
    }));

  const other = parsePipeTable(otherText)
    .filter((row) => row["ACT Symbol"] && row["ACT Symbol"] !== "File Creation Time")
    .map((row) => ({
      exchange: exchangeName(row.Exchange),
      name: row["Security Name"],
      symbol: normalizeNasdaqSymbol(row["NASDAQ Symbol"] || row["ACT Symbol"]),
      rawSymbol: row["ACT Symbol"],
      etf: row.ETF,
      testIssue: row["Test Issue"],
    }));

  const seen = new Set();
  return [...nasdaq, ...other]
    .filter((stock) => {
      if (!stock.symbol || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return isCommonEquity(stock);
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function filteredUniverse(universe) {
  if (!SYMBOL_FILTER.size) return universe;
  const bySymbol = new Map(universe.map((stock) => [stock.symbol.toUpperCase(), stock]));
  return [...SYMBOL_FILTER].map((symbol) => {
    return (
      bySymbol.get(symbol) || {
        exchange: "UNKNOWN",
        name: symbol,
        rawSymbol: symbol,
        symbol,
      }
    );
  });
}

async function fetchNasdaqDaily(stock) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
    stock.symbol,
  )}/historical?assetclass=stocks&fromdate=${historyStartDate()}&todate=${historyEndDate()}&limit=9999`;
  const response = await fetch(url, { headers: NASDAQ_API_HEADERS });
  if (!response.ok) {
    throw new Error(`Nasdaq historical unavailable: ${response.status}`);
  }

  const json = await response.json();
  const rows = json.data?.tradesTable?.rows;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("empty Nasdaq historical data");
  }

  return rows
    .map((row) => ({
      close: parseNasdaqNumber(row.close),
      date: toIsoDate(row.date),
      high: parseNasdaqNumber(row.high),
      low: parseNasdaqNumber(row.low),
      open: parseNasdaqNumber(row.open),
      volume: parseNasdaqNumber(row.volume),
    }))
    .filter(validDailyRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchYahooDaily(symbol, startDate, endDate) {
  const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?period1=${period1}&period2=${period2}&interval=1d`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`Yahoo chart unavailable: ${response.status}`);
  const json = await response.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`empty Yahoo chart: ${symbol}`);
  const quote = result.indicators?.quote?.[0] || {};
  return (result.timestamp || [])
    .map((timestamp, index) => ({
      close: finiteNumber(quote.close?.[index]),
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      high: finiteNumber(quote.high?.[index]),
      low: finiteNumber(quote.low?.[index]),
      open: finiteNumber(quote.open?.[index]),
      volume: finiteNumber(quote.volume?.[index]),
    }))
    .filter(validDailyRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchNasdaqMarketCapUsd(stock) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
    stock.symbol,
  )}/summary?assetclass=stocks`;
  const response = await fetch(url, { headers: NASDAQ_API_HEADERS });
  if (!response.ok) {
    throw new Error(`Nasdaq market cap unavailable: ${response.status}`);
  }

  const json = await response.json();
  const marketCap = parseNasdaqNumber(
    json.data?.summaryData?.MarketCap?.value,
  );
  if (!Number.isFinite(marketCap) || marketCap <= 0) {
    throw new Error("empty Nasdaq market cap");
  }
  return marketCap;
}

async function fetchUsdKrw() {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d";
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    throw new Error(`USD/KRW unavailable: ${response.status}`);
  }

  const json = await response.json();
  const result = json.chart?.result?.[0];
  const metaPrice = finiteNumber(result?.meta?.regularMarketPrice);
  if (Number.isFinite(metaPrice) && metaPrice > 0) return metaPrice;

  const closes = result?.indicators?.quote?.[0]?.close || [];
  const latestClose = [...closes].reverse().find((value) => value > 0);
  if (!Number.isFinite(latestClose)) throw new Error("empty USD/KRW quote");
  return latestClose;
}

function calculateMfi(rows, period = 14) {
  if (rows.length <= period) return NaN;
  const flows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previousTypical = typicalPrice(rows[index - 1]);
    const typical = typicalPrice(rows[index]);
    const rawFlow = typical * rows[index].volume;
    flows.push({
      negative: typical < previousTypical ? rawFlow : 0,
      positive: typical > previousTypical ? rawFlow : 0,
    });
  }

  const recent = flows.slice(-period);
  if (recent.length < period) return NaN;
  const positive = sum(recent.map((flow) => flow.positive));
  const negative = sum(recent.map((flow) => flow.negative));
  if (negative === 0 && positive > 0) return 100;
  if (negative === 0) return 50;
  const moneyRatio = positive / negative;
  return 100 - 100 / (1 + moneyRatio);
}

function isCommonEquity(stock) {
  if (stock.etf === "Y" || stock.testIssue === "Y") return false;
  const name = stock.name.toLowerCase();
  if (stock.symbol.includes("^")) return false;
  if (/[+*=]/.test(stock.symbol)) return false;
  const excluded = [
    " warrant",
    " warrants",
    " right",
    " rights",
    " unit",
    " units",
    " preferred",
    " preference",
    " note",
    " notes",
    " bond",
    " debenture",
    " fund",
    " etf",
    " etn",
    " spac",
    " spac ",
    " acquisition corp",
    " acquisition corporation",
    " trust",
    " capital securities",
  ];
  if (excluded.some((phrase) => name.includes(phrase))) return false;
  return (
    name.includes("common stock") ||
    name.includes("ordinary shares") ||
    name.includes("american depositary") ||
    name.includes("ads") ||
    name.includes("adr") ||
    name.includes("class a") ||
    name.includes("class b")
  );
}

function parsePipeTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split("|");
  return lines.map((line) => {
    const values = line.split("|");
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function toCsv(rows) {
  const headers = [
    "symbol",
    "rawSymbol",
    "name",
    "exchange",
    "signal",
    "setupScore",
    "lastDate",
    "lastClose",
    "monthlyReturn",
    "benchmarkReturn",
    "relativeReturn",
    "firstToLastReturn",
    "volumeRatio",
    "mfi",
    "breakout",
    "aboveTrailing3Average",
    "next1mReturn",
    "next3mReturn",
    "next6mReturn",
    "marketCapUsd",
    "marketCapKrw",
  ];
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header] ?? "")).join(","),
    ),
  ].join("\n");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
  return response.text();
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function writeFile(filePath, contents) {
  const { mkdir, writeFile: writeFileNode } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFileNode(filePath, contents);
}

function validDailyRow(row) {
  return (
    row.date &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low) &&
    Number.isFinite(row.close) &&
    Number.isFinite(row.volume) &&
    row.high > 0 &&
    row.low > 0 &&
    row.close > 0
  );
}

function previousMonths(month, count) {
  return Array.from({ length: count }, (_, index) =>
    shiftMonth(month, -count + index),
  );
}

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function historyStartDate() {
  return `${shiftMonth(MARKET_MONTH, -(COMPARISON_MONTH_COUNT + 8))}-01`;
}

function historyEndDate() {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsAfterTarget = `${shiftMonth(MARKET_MONTH, 7)}-01`;
  return today > sixMonthsAfterTarget ? today : sixMonthsAfterTarget;
}

function normalizeNasdaqSymbol(symbol) {
  return String(symbol || "").trim();
}

function exchangeName(code) {
  return (
    {
      A: "NYSE American",
      N: "NYSE",
      P: "NYSE Arca",
      Z: "Cboe BZX",
      V: "IEX",
    }[code] || code
  );
}

function parseNasdaqNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value || "")
    .replace(/[$,%\s,]/g, "")
    .trim();
  if (!text || text.toUpperCase() === "N/A") return NaN;
  return Number(text);
}

function toIsoDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function typicalPrice(row) {
  return (row.high + row.low + row.close) / 3;
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return NaN;
  }
  return ((current - previous) / previous) * 100;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? sum(clean) / clean.length : NaN;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
