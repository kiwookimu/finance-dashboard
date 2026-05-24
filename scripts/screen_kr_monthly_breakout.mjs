const MARKET_MONTH = process.argv[2] || "2026-05";
const COMPARISON_MONTH_COUNT = Number(
  process.env.COMPARE_MONTHS || process.argv[3] || 5,
);
const MIN_MARKET_CAP_KRW = Number(
  process.env.MIN_MARKET_CAP_KRW || process.argv[4] || 1_000_000_000_000,
);
const ALLOWED_MARKETS = new Set(
  (process.env.SCREEN_MARKETS || process.argv[5] || "KOSPI,KOSDAQ")
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean),
);
const CONCURRENCY = Number(process.env.SCREEN_CONCURRENCY || 8);
const LIMIT = Number(process.env.SCREEN_LIMIT || 0);
const MIN_HISTORY_MONTHS = Number(process.env.MIN_HISTORY_MONTHS || 4);
const MIN_SETUP_SCORE = Number(process.env.MIN_SETUP_SCORE || 70);
const MIN_VOLUME_RATIO = Number(process.env.MIN_VOLUME_RATIO || 1.8);
const MIN_MONTHLY_RETURN = Number(process.env.MIN_MONTHLY_RETURN || 15);
const MIN_RELATIVE_RETURN = Number(process.env.MIN_RELATIVE_RETURN || 8);
const MIN_MFI = Number(process.env.MIN_MFI || 70);
const KRX_CORP_LIST =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const BENCHMARKS = {
  KOSDAQ: { label: "KOSDAQ", symbol: "^KQ11" },
  KOSPI: { label: "KOSPI", symbol: "^KS11" },
};

const benchmarkMonths = Object.fromEntries(
  await Promise.all(
    Object.entries(BENCHMARKS).map(async ([marketType, source]) => [
      marketType,
      monthlyBars(await fetchYahooDaily(source.symbol, historyStartDate(), historyEndDate())),
    ]),
  ),
);
const universe = (await fetchKrxUniverse())
  .filter((stock) => ALLOWED_MARKETS.has(stock.marketType))
  .slice(0, LIMIT || undefined);
const results = [];
const failures = [];
let completed = 0;

await runPool(universe, CONCURRENCY, async (stock) => {
  try {
    const rows = await fetchNaverDaily(stock);
    const screening = screenStock(stock, rows, benchmarkMonths[stock.marketType]);
    if (!screening) return;

    const marketCapKrw = await fetchNaverMarketCapKrw(stock);
    if (marketCapKrw < MIN_MARKET_CAP_KRW) return;
    results.push({ ...screening, marketCapKrw });
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
  benchmarkByMarket: Object.fromEntries(
    Object.entries(BENCHMARKS).map(([marketType, source]) => [
      marketType,
      source.label,
    ]),
  ),
  comparisonMonthCount: COMPARISON_MONTH_COUNT,
  condition: {
    breakout: "target month close exceeds previous comparison-month closing high",
    dailyMfi: `>= ${MIN_MFI}`,
    marketFilter: [...ALLOWED_MARKETS],
    minimumHistoryMonths: MIN_HISTORY_MONTHS,
    minimumMarketCapKrw: MIN_MARKET_CAP_KRW,
    monthlyReturn: `>= ${MIN_MONTHLY_RETURN}% vs previous month close`,
    relativeReturn: `>= ${MIN_RELATIVE_RETURN}% vs own market benchmark`,
    setupScore: `>= ${MIN_SETUP_SCORE}`,
    volumeRatio: `>= ${MIN_VOLUME_RATIO}x vs previous ${COMPARISON_MONTH_COUNT}-month average`,
  },
  marketMonth: MARKET_MONTH,
  note:
    "Forward returns are included only for historical review and are not used in the screen.",
  universe: "KRX listed corporations from KIND; KOSPI/KOSDAQ stocks only",
  universeCount: universe.length,
  matchCount: results.length,
  failureCount: failures.length,
  results,
};

const marketSuffix = [...ALLOWED_MARKETS].sort().join("_").toLowerCase();
const outStem = `screen_results/kr_monthly_breakout_${MARKET_MONTH}_${marketSuffix}`;
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
    benchmark: BENCHMARKS[stock.marketType]?.label || stock.marketType,
    benchmarkReturn: round(benchmarkReturn, 2),
    breakout,
    code: stock.code,
    firstToLastReturn: round(firstToLastReturn, 2),
    lastClose: current.close,
    lastDate: current.lastDate,
    market: stock.market,
    marketType: stock.marketType,
    mfi: round(mfi, 2),
    monthlyReturn: round(targetReturn, 2),
    name: stock.name,
    next1mReturn: round(forwardReturn(monthMap, MARKET_MONTH, 1), 2),
    next3mReturn: round(forwardReturn(monthMap, MARKET_MONTH, 3), 2),
    next6mReturn: round(forwardReturn(monthMap, MARKET_MONTH, 6), 2),
    previousAverageVolume: Math.round(previousAverageVolume),
    previousCloseHigh,
    previousMonthClose: previousMonth.close,
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

async function fetchKrxUniverse() {
  const response = await fetch(KRX_CORP_LIST, {
    headers: {
      Accept: "application/vnd.ms-excel,text/html,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    throw new Error(`KRX universe unavailable: ${response.status}`);
  }

  const html = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].slice(1);
  return rows
    .map((row) => {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (cell) => cleanHtml(cell[1]),
      );
      const [name, market, code] = cells;
      if (!name || !code) return null;
      const marketType = market.includes("코스닥")
        ? "KOSDAQ"
        : market.includes("유가")
          ? "KOSPI"
          : "";
      const suffix =
        marketType === "KOSDAQ" ? "KQ" : marketType === "KOSPI" ? "KS" : "";
      if (!suffix) return null;
      if (!/^\d{6}$/.test(code)) return null;
      return {
        code,
        market,
        marketType,
        name,
        symbol: `${code}.${suffix}`,
      };
    })
    .filter(Boolean);
}

async function fetchNaverDaily(stock) {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${stock.code}&timeframe=day&count=430&requestType=0`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Naver chart unavailable: ${response.status}`);
  }

  const xml = await response.text();
  const items = [...xml.matchAll(/<item data="([^"]+)"/g)].map((match) => {
    const [date, open, high, low, close, volume] = match[1].split("|");
    return {
      close: finiteNumber(close),
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      high: finiteNumber(high),
      low: finiteNumber(low),
      open: finiteNumber(open),
      volume: finiteNumber(volume),
    };
  });
  if (!items.length) throw new Error("empty chart");
  return items.filter(validDailyRow);
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

async function fetchNaverMarketCapKrw(stock) {
  const url = `https://m.stock.naver.com/api/stock/${stock.code}/integration`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Naver market cap unavailable: ${response.status}`);
  }

  const json = await response.json();
  const item = (json.totalInfos || []).find((info) => info.code === "marketValue");
  const marketCapKrw = parseKoreanMarketCap(item?.value);
  if (!Number.isFinite(marketCapKrw) || marketCapKrw <= 0) {
    throw new Error("empty market cap");
  }
  return marketCapKrw;
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

function toCsv(rows) {
  const headers = [
    "code",
    "name",
    "market",
    "marketType",
    "symbol",
    "benchmark",
    "signal",
    "setupScore",
    "lastDate",
    "lastClose",
    "monthlyReturn",
    "benchmarkReturn",
    "relativeReturn",
    "firstToLastReturn",
    "targetMonthVolume",
    "previousAverageVolume",
    "previousCloseHigh",
    "previousMonthClose",
    "volumeRatio",
    "mfi",
    "breakout",
    "aboveTrailing3Average",
    "next1mReturn",
    "next3mReturn",
    "next6mReturn",
    "marketCapKrw",
  ];
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header] ?? "")).join(","),
    ),
  ].join("\n");
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

function cleanHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKoreanMarketCap(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const joMatch = text.match(/([\d,]+(?:\.\d+)?)\s*조/);
  const eokMatch = text.match(/([\d,]+(?:\.\d+)?)\s*억/);
  const jo = joMatch ? Number(joMatch[1].replace(/,/g, "")) : 0;
  const eok = eokMatch ? Number(eokMatch[1].replace(/,/g, "")) : 0;
  if (!jo && !eok) return NaN;
  return Math.round(jo * 1_000_000_000_000 + eok * 100_000_000);
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

function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function csvEscape(value) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
