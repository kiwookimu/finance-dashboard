const MARKET_MONTH = process.argv[2] || "2026-04";
const COMPARISON_MONTH_COUNT = Number(
  process.env.COMPARE_MONTHS || process.argv[3] || 5,
);
const PREVIOUS_MONTHS = previousMonths(MARKET_MONTH, COMPARISON_MONTH_COUNT);
const REQUIRE_PRICE_UP_VS_PREVIOUS_MONTH = (
  process.env.PRICE_UP_VS_PREV_MONTH ||
  process.argv[5] ||
  "false"
).toLowerCase() === "true";
const MIN_MARKET_CAP_KRW = Number(
  process.env.MIN_MARKET_CAP_KRW || process.argv[6] || 1_000_000_000_000,
);
const ALLOWED_MARKETS = new Set(
  (process.env.SCREEN_MARKETS || process.argv[4] || "KOSPI,KOSDAQ")
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean),
);
const CONCURRENCY = Number(process.env.SCREEN_CONCURRENCY || 8);
const LIMIT = Number(process.env.SCREEN_LIMIT || 0);
const KRX_CORP_LIST =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";

const universe = (await fetchKrxUniverse())
  .filter((stock) => ALLOWED_MARKETS.has(stock.marketType))
  .slice(0, LIMIT || undefined);
const results = [];
const failures = [];
let completed = 0;

await runPool(universe, CONCURRENCY, async (stock) => {
  try {
    const data = await fetchNaverDaily(stock);
    const screening = screenStock(stock, data);
    if (screening) {
      const marketCapKrw = await fetchNaverMarketCapKrw(stock);
      if (marketCapKrw >= MIN_MARKET_CAP_KRW) {
        results.push({ ...screening, marketCapKrw });
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
  marketFilter: [...ALLOWED_MARKETS],
  marketMonth: MARKET_MONTH,
  previousMonths: PREVIOUS_MONTHS,
  condition: {
    mfi: "> 90",
    monthlyVolumeRatio: `>= 2x vs previous ${COMPARISON_MONTH_COUNT}-month average`,
    priceUpVsPreviousMonth: REQUIRE_PRICE_UP_VS_PREVIOUS_MONTH,
    minimumMarketCapKrw: MIN_MARKET_CAP_KRW,
  },
  universeCount: universe.length,
  matchCount: results.length,
  failureCount: failures.length,
  results,
};

const outStem = `screen_results/mfi_volume_${MARKET_MONTH}`;
await writeFile(`${outStem}.json`, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(`${outStem}.csv`, toCsv(results));

console.log(JSON.stringify(payload, null, 2));

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
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${stock.code}&timeframe=day&count=220&requestType=0`;
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
  if (!items.length) {
    throw new Error("empty chart");
  }

  return items.filter(
    (row) =>
      row.date &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close) &&
      Number.isFinite(row.volume) &&
      row.high > 0 &&
      row.low > 0 &&
      row.close > 0,
  );
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
    code: stock.code,
    lastClose,
    lastDate: lastMarketDate,
    market: stock.market,
    marketType: stock.marketType,
    mfi: round(mfi, 2),
    monthlyReturn: round(monthlyReturn, 2),
    name: stock.name,
    previousAverageVolume: Math.round(previousAverageVolume),
    previousMonthClose,
    previousMonthReturn: round(previousMonthReturn, 2),
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
    "code",
    "name",
    "market",
    "marketType",
    "symbol",
    "lastDate",
    "lastClose",
    "targetMonthVolume",
    "previousAverageVolume",
    "previousMonthClose",
    "previousMonthReturn",
    "volumeRatio",
    "mfi",
    "monthlyReturn",
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
