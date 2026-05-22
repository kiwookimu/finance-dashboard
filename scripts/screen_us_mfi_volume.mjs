const MARKET_MONTH = process.argv[2] || "2026-04";
const COMPARISON_MONTH_COUNT = Number(
  process.env.COMPARE_MONTHS || process.argv[3] || 5,
);
const PREVIOUS_MONTHS = previousMonths(MARKET_MONTH, COMPARISON_MONTH_COUNT);
const REQUIRE_PRICE_UP_VS_PREVIOUS_MONTH = (
  process.env.PRICE_UP_VS_PREV_MONTH ||
  process.argv[4] ||
  "true"
).toLowerCase() === "true";
const MIN_MARKET_CAP_KRW = Number(
  process.env.MIN_MARKET_CAP_KRW || process.argv[5] || 1_000_000_000_000,
);
const CONCURRENCY = Number(process.env.SCREEN_CONCURRENCY || 4);
const LIMIT = Number(process.env.SCREEN_LIMIT || 0);
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
const universe = (await fetchUsUniverse()).slice(0, LIMIT || undefined);
const results = [];
const failures = [];
let completed = 0;

await runPool(universe, CONCURRENCY, async (stock) => {
  try {
    const data = await fetchNasdaqDaily(stock);
    const screening = screenStock(stock, data);
    if (screening) {
      const marketCapUsd = await fetchNasdaqMarketCapUsd(stock);
      if (marketCapUsd >= minimumMarketCapUsd) {
        results.push({
          ...screening,
          marketCapKrw: Math.round(marketCapUsd * usdKrw),
          marketCapUsd: Math.round(marketCapUsd),
        });
      }
    }
  } catch (error) {
    failures.push({ ...stock, error: error.message });
  } finally {
    completed += 1;
    if (completed % 100 === 0 || completed === universe.length) {
      console.error(`checked ${completed}/${universe.length}`);
    }
  }
});

results.sort((a, b) => b.volumeRatio - a.volumeRatio || b.mfi - a.mfi);

const payload = {
  generatedAt: new Date().toISOString(),
  comparisonMonthCount: COMPARISON_MONTH_COUNT,
  marketMonth: MARKET_MONTH,
  previousMonths: PREVIOUS_MONTHS,
  condition: {
    mfi: "> 90",
    monthlyVolumeRatio: `>= 2x vs previous ${COMPARISON_MONTH_COUNT}-month average`,
    priceUpVsPreviousMonth: REQUIRE_PRICE_UP_VS_PREVIOUS_MONTH,
    minimumMarketCapKrw: MIN_MARKET_CAP_KRW,
    minimumMarketCapUsd: Math.round(minimumMarketCapUsd),
  },
  exchangeRate: {
    pair: "USD/KRW",
    value: round(usdKrw, 4),
  },
  universe:
    "Nasdaq Trader listed U.S. common stocks and ADRs; ETFs, units, warrants, rights, preferreds, funds, SPAC/acquisition vehicles, and test issues excluded",
  universeCount: universe.length,
  matchCount: results.length,
  failureCount: failures.length,
  results,
};

const outStem = `screen_results/us_mfi_volume_${MARKET_MONTH}`;
await writeFile(`${outStem}.json`, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(`${outStem}.csv`, toCsv(results));

console.log(JSON.stringify(payload, null, 2));

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

async function fetchNasdaqDaily(stock) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
    stock.symbol,
  )}/historical?assetclass=stocks&fromdate=${historyStartDate()}&todate=${monthEndDate(
    MARKET_MONTH,
  )}&limit=9999`;
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
    .filter(
      (row) =>
        row.date &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close) &&
        Number.isFinite(row.volume) &&
        row.high > 0 &&
        row.low > 0 &&
        row.close > 0,
    )
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

function screenStock(stock, rows) {
  const currentRows = rows.filter((row) => row.date.startsWith(MARKET_MONTH));
  const priorMonthRows = PREVIOUS_MONTHS.map((month) =>
    rows.filter((row) => row.date.startsWith(month)),
  );
  if (!currentRows.length || priorMonthRows.some((items) => !items.length)) {
    return null;
  }

  const marketVolume = sum(currentRows.map((row) => row.volume));
  const previousVolumes = priorMonthRows.map((items) =>
    sum(items.map((row) => row.volume)),
  );
  const previousAverageVolume = average(previousVolumes);
  if (!previousAverageVolume) return null;

  const volumeRatio = marketVolume / previousAverageVolume;
  const lastMarketDate = currentRows.at(-1).date;
  const mfi = calculateMfi(rows.filter((row) => row.date <= lastMarketDate), 14);
  if (!(currentRows.at(-1).close > 0)) return null;

  if (volumeRatio < 2 || !(mfi > 90)) return null;

  const firstClose = currentRows[0].close;
  const lastClose = currentRows.at(-1).close;
  const previousMonthRows = priorMonthRows.at(-1);
  const previousMonthClose = previousMonthRows.at(-1).close;
  const previousMonthReturn =
    previousMonthClose && Number.isFinite(previousMonthClose)
      ? ((lastClose - previousMonthClose) / previousMonthClose) * 100
      : null;
  if (REQUIRE_PRICE_UP_VS_PREVIOUS_MONTH && !(previousMonthReturn > 0)) {
    return null;
  }
  const monthlyReturn =
    firstClose && Number.isFinite(firstClose)
      ? ((lastClose - firstClose) / firstClose) * 100
      : null;

  return {
    exchange: stock.exchange,
    lastClose: round(lastClose, 4),
    lastDate: lastMarketDate,
    mfi: round(mfi, 2),
    monthlyReturn: round(monthlyReturn, 2),
    name: stock.name,
    previousAverageVolume: Math.round(previousAverageVolume),
    previousMonthClose: round(previousMonthClose, 4),
    previousMonthReturn: round(previousMonthReturn, 2),
    rawSymbol: stock.rawSymbol,
    symbol: stock.symbol,
    targetMonthVolume: Math.round(marketVolume),
    volumeRatio: round(volumeRatio, 2),
  };
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

function normalizeNasdaqSymbol(symbol) {
  return String(symbol || "")
    .trim();
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

function typicalPrice(row) {
  return (row.high + row.low + row.close) / 3;
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
  const { writeFile: writeFileNode } = await import("node:fs/promises");
  await writeFileNode(filePath, contents);
}

function toCsv(rows) {
  const headers = [
    "symbol",
    "rawSymbol",
    "name",
    "exchange",
    "lastDate",
    "lastClose",
    "targetMonthVolume",
    "previousAverageVolume",
    "previousMonthClose",
    "previousMonthReturn",
    "volumeRatio",
    "mfi",
    "monthlyReturn",
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

function previousMonths(month, count) {
  const [year, monthIndex] = month.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex - 2 - index, 1));
    return date.toISOString().slice(0, 7);
  }).reverse();
}

function historyStartDate() {
  return `${PREVIOUS_MONTHS[0]}-01`;
}

function monthEndDate(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex, 0));
  return date.toISOString().slice(0, 10);
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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function average(values) {
  return values.length ? sum(values) / values.length : 0;
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
