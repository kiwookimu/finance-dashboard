import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildStockRecommendationCondition,
  criteriaMarketCap,
  criteriaMinimumHistoryDays,
  criteriaNumber,
  criteriaString,
  loadRecommendationCriteria,
  recommendationCriteriaHash,
} = require("../lib/recommendationCriteria");
const {
  completedSessionCutoffDate,
  exactDateIndex,
  latestDateInMonthAtOrBefore,
  localDateTimeParts,
  rowsAtOrBefore,
} = require("../lib/marketDataPolicy");
const {
  MIROFISH_MARKET_SYMBOLS,
  applyMirofishSetupScore,
  buildMirofishSimulationFromHistories,
  loadMirofishAgentPerformance,
  mirofishAgentScores,
  scoreRecommendationWithMirofish,
} = require("../lib/mirofishScreener");
const RECOMMENDATION_CRITERIA = loadRecommendationCriteria();
const CRITERIA_HASH = recommendationCriteriaHash(RECOMMENDATION_CRITERIA);
const MARKET_MONTH = process.argv[2] || "2025-09";
const SCREEN_NOW = process.env.SCREEN_NOW ? new Date(process.env.SCREEN_NOW) : new Date();
const COMPLETED_SESSION_CUTOFF = completedSessionCutoffDate({
  completionHour: 17,
  now: SCREEN_NOW,
  timeZone: "America/New_York",
});
const SCREEN_VERSION = criteriaString(
  RECOMMENDATION_CRITERIA,
  "screenVersion.us",
  "us-rolling-21-v7",
);
const COMPARISON_MONTH_COUNT = Number(
  process.env.COMPARE_MONTHS ||
    process.argv[3] ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "comparisonMonthCount", 5),
);
const MIN_MARKET_CAP_KRW = Number(
  process.env.MIN_MARKET_CAP_KRW ||
    process.argv[4] ||
    criteriaMarketCap(RECOMMENDATION_CRITERIA, "us", 10_000_000_000_000),
);
const CONCURRENCY = Number(process.env.SCREEN_CONCURRENCY || 8);
const LIMIT = Number(process.env.SCREEN_LIMIT || 0);
const SYMBOL_FILTER = new Set(
  (process.env.SCREEN_SYMBOLS || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean),
);
const ROLLING_WINDOW_DAYS = Number(
  process.env.ROLLING_WINDOW_DAYS ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "rollingWindowDays", 21),
);
const RECENT_VOLUME_DAYS = Number(
  process.env.RECENT_VOLUME_DAYS ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "recentVolumeDays", 5),
);
const MIN_HISTORY_DAYS = Number(
  process.env.MIN_HISTORY_DAYS ||
    (ROLLING_WINDOW_DAYS === criteriaNumber(RECOMMENDATION_CRITERIA, "rollingWindowDays", 21) &&
    COMPARISON_MONTH_COUNT === criteriaNumber(RECOMMENDATION_CRITERIA, "comparisonMonthCount", 5)
      ? criteriaMinimumHistoryDays(RECOMMENDATION_CRITERIA)
      : ROLLING_WINDOW_DAYS * (COMPARISON_MONTH_COUNT + 1) + 1),
);
const MIN_SETUP_SCORE = Number(
  process.env.MIN_SETUP_SCORE || criteriaNumber(RECOMMENDATION_CRITERIA, "setupScore", 70),
);
const MIN_CONFIRMED_SETUP_SCORE = Number(
  process.env.MIN_CONFIRMED_SETUP_SCORE ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "confirmedSetupScore", 75),
);
const MIN_VOLUME_RATIO = Number(
  process.env.MIN_VOLUME_RATIO || criteriaNumber(RECOMMENDATION_CRITERIA, "volumeRatio", 1.8),
);
const MIN_RECENT_VOLUME_RATIO = Number(
  process.env.MIN_RECENT_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "recentVolumeRatio", 1.8),
);
const MIN_WATCH_VOLUME_RATIO = Number(
  process.env.MIN_WATCH_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "watchVolumeRatio", 1.2),
);
const MIN_ROLLING_RETURN = Number(
  process.env.MIN_ROLLING_RETURN ||
    process.env.MIN_MONTHLY_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "rollingReturn", 15),
);
const MAX_CONFIRMED_ROLLING_RETURN = Number(
  process.env.MAX_CONFIRMED_ROLLING_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "maxConfirmedRollingReturn", 80),
);
const MIN_HIGH_CONFIDENCE_VOLUME_RATIO = Number(
  process.env.MIN_HIGH_CONFIDENCE_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "highConfidenceVolumeRatio", 2.2),
);
const MIN_HIGH_CONFIDENCE_RELATIVE_RETURN = Number(
  process.env.MIN_HIGH_CONFIDENCE_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "highConfidenceRelativeReturn", 40),
);
const MAX_HIGH_CONFIDENCE_DRAWDOWN = Number(
  process.env.MAX_HIGH_CONFIDENCE_DRAWDOWN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "highConfidenceMaxHighDrawdown", 3),
);
const MIN_WATCH_RETURN = Number(
  process.env.MIN_WATCH_RETURN || criteriaNumber(RECOMMENDATION_CRITERIA, "watchReturn", 60),
);
const MIN_RELATIVE_RETURN = Number(
  process.env.MIN_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "relativeReturn", 8),
);
const MIN_MFI = Number(process.env.MIN_MFI || criteriaNumber(RECOMMENDATION_CRITERIA, "mfi", 80));
const MIN_WATCH_MFI = Number(
  process.env.MIN_WATCH_MFI || criteriaNumber(RECOMMENDATION_CRITERIA, "watchMfi", 75),
);
const MIN_OBSERVATION_VOLUME_RATIO = Number(
  process.env.MIN_OBSERVATION_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "observationVolumeRatio", 1.2),
);
const MIN_OBSERVATION_RECENT_VOLUME_RATIO = Number(
  process.env.MIN_OBSERVATION_RECENT_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "observationRecentVolumeRatio", 1.5),
);
const MIN_OBSERVATION_RETURN = Number(
  process.env.MIN_OBSERVATION_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "observationReturn", 60),
);
const MIN_OBSERVATION_RELATIVE_RETURN = Number(
  process.env.MIN_OBSERVATION_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "observationRelativeReturn", 40),
);
const MIN_OBSERVATION_MFI = Number(
  process.env.MIN_OBSERVATION_MFI ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "observationMfi", 75),
);
const MAX_OBSERVATION_HIGH_DRAWDOWN = Number(
  process.env.MAX_OBSERVATION_HIGH_DRAWDOWN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "observationMaxHighDrawdown", 5),
);
const MOVING_AVERAGE_DAYS = Number(
  process.env.MOVING_AVERAGE_DAYS ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "movingAverageDays", 10),
);
const MAX_ROLLING_HIGH_DRAWDOWN = Number(
  process.env.MAX_ROLLING_HIGH_DRAWDOWN ||
    process.env.MAX_MONTH_HIGH_DRAWDOWN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "maxRollingHighDrawdown", 20),
);
const MAX_CONFIRMED_HIGH_DRAWDOWN = Number(
  process.env.MAX_CONFIRMED_HIGH_DRAWDOWN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "maxConfirmedHighDrawdown", 10),
);
const MAX_CONFIRMED_MFI = Number(
  process.env.MAX_CONFIRMED_MFI ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "maxConfirmedMfi", 90),
);
const MFI_REVERSAL_MAX_HIGH_DRAWDOWN = Number(
  process.env.MFI_REVERSAL_MAX_HIGH_DRAWDOWN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "mfiReversalMaxHighDrawdown", 5),
);
const MFI_REVERSAL_RECENT_VOLUME_RATIO = Number(
  process.env.MFI_REVERSAL_RECENT_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "mfiReversalRecentVolumeRatio", 3),
);
const MFI_REVERSAL_WORST_DAILY_RETURN = Number(
  process.env.MFI_REVERSAL_WORST_DAILY_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "mfiReversalWorstDailyReturn", 3),
);
const OVERHEAT_MFI = Number(
  process.env.OVERHEAT_MFI || criteriaNumber(RECOMMENDATION_CRITERIA, "overheatMfi", 92),
);
const OVERHEAT_RETURN = Number(
  process.env.OVERHEAT_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "overheatReturn", 70),
);
const EXTREME_RETURN = Number(
  process.env.EXTREME_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "extremeReturn", 100),
);
const EXTREME_VOLUME_RATIO = Number(
  process.env.EXTREME_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "extremeVolumeRatio", 12),
);
const EVENT_LOCK_VOLUME_RATIO = Number(
  process.env.EVENT_LOCK_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "eventLockVolumeRatio", 5),
);
const EVENT_LOCK_RECENT_VOLUME_RATIO = Number(
  process.env.EVENT_LOCK_RECENT_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "eventLockRecentVolumeRatio", 3),
);
const EVENT_LOCK_MAX_HIGH_DRAWDOWN = Number(
  process.env.EVENT_LOCK_MAX_HIGH_DRAWDOWN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "eventLockMaxHighDrawdown", 1),
);
const EVENT_LOCK_MAX_ROLLING_RETURN = Number(
  process.env.EVENT_LOCK_MAX_ROLLING_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "eventLockMaxRollingReturn", 35),
);
const EVENT_LOCK_MAX_RECENT_WORST_DAILY_RETURN = Number(
  process.env.EVENT_LOCK_MAX_RECENT_WORST_DAILY_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "eventLockMaxRecentWorstDailyReturn", 3),
);
const WEAK_MARKET_RETURN = Number(
  process.env.WEAK_MARKET_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketReturn.us", -5),
);
const WEAK_MARKET_OVERRIDE_RELATIVE_RETURN = Number(
  process.env.WEAK_MARKET_OVERRIDE_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketOverrideRelativeReturn", 25),
);
const WEAK_MARKET_OVERRIDE_RETURN = Number(
  process.env.WEAK_MARKET_OVERRIDE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketOverrideReturn", 30),
);
const BENCHMARK_SYMBOL = process.env.BENCHMARK_SYMBOL || "QQQ";
const MARKET_CAP_PREFILTER = process.env.MARKET_CAP_PREFILTER !== "0";
const NASDAQ_LISTED =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_LISTED =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const NASDAQ_SCREENER =
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true";
const NASDAQ_API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "User-Agent": "Mozilla/5.0",
};

const usdKrw = await fetchUsdKrw();
const minimumMarketCapUsd = MIN_MARKET_CAP_KRW / usdKrw;
const benchmarkRows = rowsAtOrBefore(
  await fetchYahooDaily(
    BENCHMARK_SYMBOL,
    historyStartDate(),
    historyEndDate(),
  ),
  COMPLETED_SESSION_CUTOFF,
);
const mirofishMarketHistories = await fetchMirofishMarketHistories(
  BENCHMARK_SYMBOL === "QQQ" ? { qqq: benchmarkRows } : {},
);
const mirofishAgentPerformance =
  process.env.MIROFISH_AGENT_PERFORMANCE === "0"
    ? null
    : loadMirofishAgentPerformance();
const mirofishSimulationByDate = new Map();
const EFFECTIVE_MARKET_MONTH = effectiveMarketMonth(MARKET_MONTH, benchmarkRows);
const BENCHMARK_AS_OF = latestDateInMonthAtOrBefore(
  benchmarkRows,
  EFFECTIVE_MARKET_MONTH,
  COMPLETED_SESSION_CUTOFF,
);
const IS_COMPLETE_BAR =
  Boolean(BENCHMARK_AS_OF) && BENCHMARK_AS_OF <= COMPLETED_SESSION_CUTOFF;
if (EFFECTIVE_MARKET_MONTH !== MARKET_MONTH) {
  console.error(
    `using ${EFFECTIVE_MARKET_MONTH} because ${MARKET_MONTH} has no ${BENCHMARK_SYMBOL} trading data yet`,
  );
}
const universeInfo = await fetchUsUniverse({ minimumMarketCapUsd });
const universe = filteredUniverse(universeInfo.universe, universeInfo.allBySymbol).slice(
  0,
  LIMIT || undefined,
);
if (universeInfo.usedMarketCapPrefilter) {
  console.error(
    `prefiltered ${universeInfo.universe.length}/${universeInfo.rawCount} by market cap`,
  );
}
if (universe.length !== universeInfo.universe.length) {
  console.error(`universe ${universe.length}/${universeInfo.universe.length} after limit`);
}
const results = [];
const failures = [];
let completed = 0;

await runPool(universe, CONCURRENCY, async (stock) => {
  try {
    const rows = await fetchNasdaqDaily(stock);
    const screening = screenStock(stock, rows, benchmarkRows, BENCHMARK_AS_OF);
    if (!screening) return;

    const marketCapUsd = Number.isFinite(stock.marketCapUsd)
      ? stock.marketCapUsd
      : await fetchNasdaqMarketCapUsd(stock);
    if (marketCapUsd < minimumMarketCapUsd) return;
    results.push({
      ...screening,
      country: stock.country,
      industry: stock.industry,
      marketCapKrw: Math.round(marketCapUsd * usdKrw),
      marketCapUsd: Math.round(marketCapUsd),
      sector: stock.sector,
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
    (b.confidenceRank || 0) - (a.confidenceRank || 0) ||
    (b.mirofishAdjustedScore ?? b.setupScore) - (a.mirofishAdjustedScore ?? a.setupScore) ||
    b.setupScore - a.setupScore ||
    b.relativeReturn - a.relativeReturn ||
    b.volumeRatio - a.volumeRatio,
);

const payload = {
  generatedAt: new Date().toISOString(),
  benchmark: BENCHMARK_SYMBOL,
  benchmarkAsOf: BENCHMARK_AS_OF,
  comparisonMonthCount: COMPARISON_MONTH_COUNT,
  completionPolicy: {
    cutoffDate: COMPLETED_SESSION_CUTOFF,
    marketCloseBuffer: "17:00 America/New_York",
    requiresBenchmarkDateMatch: true,
  },
  condition: buildStockRecommendationCondition(
    RECOMMENDATION_CRITERIA,
    MIN_MARKET_CAP_KRW,
    {
      minimumMarketCapUsd,
      relativeBenchmark: BENCHMARK_SYMBOL,
    },
  ),
  exchangeRate: {
    pair: "USD/KRW",
    value: round(usdKrw, 4),
  },
  marketMonth: EFFECTIVE_MARKET_MONTH,
  criteriaHash: CRITERIA_HASH,
  dataAsOf: BENCHMARK_AS_OF,
  isCompleteBar: IS_COMPLETE_BAR,
  note:
    "Forward returns are included only for historical review and are not used in the screen.",
  ...(EFFECTIVE_MARKET_MONTH !== MARKET_MONTH
    ? { requestedMonth: MARKET_MONTH }
    : {}),
  screenVersion: SCREEN_VERSION,
  mirofish: {
    enabled: true,
    adjustment: "setupScore is adjusted by market/theme fit before final sorting",
    agentPerformance: mirofishAgentPerformance,
    availableMarketSeries: Object.keys(mirofishMarketHistories),
  },
  universe:
    SYMBOL_FILTER.size > 0
      ? `Manual symbols: ${[...SYMBOL_FILTER].join(", ")}`
      : "Nasdaq Trader listed U.S. common stocks and ADRs; ETFs, units, warrants, rights, preferreds, funds, SPAC/acquisition vehicles, and test issues excluded",
  universeAsOf: localDateTimeParts(SCREEN_NOW, "America/New_York").date,
  rawUniverseCount: universeInfo.rawCount,
  prefilter: {
    marketCapCoverageCount: universeInfo.marketCapCoverageCount,
    minimumMarketCapUsd: Math.round(minimumMarketCapUsd),
    usedMarketCapPrefilter: universeInfo.usedMarketCapPrefilter,
  },
  universeCount: universe.length,
  matchCount: results.length,
  failureCount: failures.length,
  results,
};

const outStem = `screen_results/us_monthly_breakout_${MARKET_MONTH}`;
await writeFile(`${outStem}.json`, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(`${outStem}.csv`, toCsv(results));

console.log(JSON.stringify(payload, null, 2));

function screenStock(stock, rows, benchmarkRows, benchmarkAsOf) {
  const sortedRows = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!benchmarkAsOf || !benchmarkAsOf.startsWith(EFFECTIVE_MARKET_MONTH)) return null;
  const targetIndex = exactDateIndex(sortedRows, benchmarkAsOf);
  if (targetIndex < 0) return null;
  if (targetIndex + 1 < MIN_HISTORY_DAYS) return null;

  const current = sortedRows[targetIndex];
  const previousTradingDay = sortedRows[targetIndex - 1];
  const rowsUntilTarget = sortedRows.slice(0, targetIndex + 1);
  const volumeStats = rollingVolumeStats(
    sortedRows,
    targetIndex,
    ROLLING_WINDOW_DAYS,
    COMPARISON_MONTH_COUNT,
  );
  if (!volumeStats) return null;

  const recentVolumeRatio = recentAverageVolumeRatio(
    sortedRows,
    targetIndex,
    RECENT_VOLUME_DAYS,
    ROLLING_WINDOW_DAYS * COMPARISON_MONTH_COUNT,
  );
  if (!Number.isFinite(recentVolumeRatio)) return null;

  const returnBase = sortedRows[targetIndex - ROLLING_WINDOW_DAYS];
  if (!returnBase) return null;
  const targetReturn = percentChange(current.close, returnBase.close);
  const benchmarkReturn = benchmarkRollingReturn(
    benchmarkRows,
    current.date,
    ROLLING_WINDOW_DAYS,
  );
  const relativeReturn = Number.isFinite(benchmarkReturn)
    ? targetReturn - benchmarkReturn
    : NaN;
  const recentWindow = sortedRows.slice(
    targetIndex - ROLLING_WINDOW_DAYS + 1,
    targetIndex + 1,
  );
  const previousCloseHigh = Math.max(
    ...sortedRows
      .slice(targetIndex - ROLLING_WINDOW_DAYS, targetIndex)
      .map((row) => row.close),
  );
  const rollingHigh = Math.max(...recentWindow.map((row) => row.high));
  const monthHighDrawdown = percentChange(current.close, rollingHigh);
  const recentWorstDailyReturn = worstRecentDailyReturn(rowsUntilTarget, 5);
  const breakout = current.close >= previousCloseHigh;
  const mfi = calculateMfi(rowsUntilTarget, 14);
  const tenDayAverage = movingAverage(
    rowsUntilTarget.map((row) => row.close),
    MOVING_AVERAGE_DAYS,
  );
  const aboveTenDayAverage =
    Number.isFinite(tenDayAverage) && current.close >= tenDayAverage;
  const observationCandidate =
    volumeStats.volumeRatio >= MIN_WATCH_VOLUME_RATIO &&
    recentVolumeRatio >= MIN_OBSERVATION_RECENT_VOLUME_RATIO &&
    mfi >= MIN_WATCH_MFI &&
    targetReturn >= MIN_WATCH_RETURN &&
    relativeReturn >= MIN_OBSERVATION_RELATIVE_RETURN &&
    monthHighDrawdown >= -MAX_OBSERVATION_HIGH_DRAWDOWN &&
    aboveTenDayAverage;
  const earlyObservationCandidate =
    volumeStats.volumeRatio >= MIN_OBSERVATION_VOLUME_RATIO &&
    recentVolumeRatio >= MIN_OBSERVATION_RECENT_VOLUME_RATIO &&
    targetReturn >= MIN_OBSERVATION_RETURN &&
    relativeReturn >= MIN_OBSERVATION_RELATIVE_RETURN &&
    mfi >= MIN_OBSERVATION_MFI &&
    monthHighDrawdown >= -MAX_OBSERVATION_HIGH_DRAWDOWN &&
    aboveTenDayAverage &&
    (breakout || monthHighDrawdown >= -5);
  const confirmedCandidate =
    volumeStats.volumeRatio >= MIN_VOLUME_RATIO &&
    recentVolumeRatio >= MIN_RECENT_VOLUME_RATIO &&
    targetReturn >= MIN_ROLLING_RETURN &&
    relativeReturn >= MIN_RELATIVE_RETURN &&
    monthHighDrawdown >= -MAX_ROLLING_HIGH_DRAWDOWN &&
    mfi >= MIN_MFI &&
    aboveTenDayAverage;
  const setupScore = rollingBreakoutScore({
    aboveTenDayAverage,
    breakout,
    mfi,
    recentVolumeRatio,
    relativeReturn,
    targetReturn,
    volumeRatio: volumeStats.volumeRatio,
  });
  const mirofishSimulation = mirofishSimulationForDate(current.date);
  const mirofishFit = scoreRecommendationWithMirofish(
    {
      ...stock,
      industry: stock.industry,
      name: stock.name,
      sector: stock.sector,
    },
    { baseMarket: "us", simulation: mirofishSimulation },
  );
  const mirofishAdjustedScore = applyMirofishSetupScore(setupScore, mirofishFit);
  const overheatRisk = recommendationOverheatRisk({
    mfi,
    monthHighDrawdown,
    recentWorstDailyReturn,
    targetReturn,
    volumeRatio: volumeStats.volumeRatio,
  });
  const mfiReversalRisk = recommendationMfiReversalRisk({
    mfi,
    monthHighDrawdown,
    recentVolumeRatio,
    recentWorstDailyReturn,
  });
  const eventPriceLockRisk = recommendationEventPriceLockRisk({
    monthHighDrawdown,
    recentVolumeRatio,
    recentWorstDailyReturn,
    targetReturn,
    volumeRatio: volumeStats.volumeRatio,
  });
  const speculativeBiotechRisk = usSpeculativeBiotechRisk(stock);
  const weakMarketRegime = recommendationWeakMarketRegime({
    benchmarkReturn,
    breakout,
    relativeReturn,
    targetReturn,
  });
  const technicalCautionReasons = [
    overheatRisk ? "과열 신호" : "",
    mfiReversalRisk ? "MFI 과열 후 되밀림" : "",
    eventPriceLockRisk ? "이벤트성 가격 고정 의심" : "",
    speculativeBiotechRisk ? "바이오 실적 확인 필요" : "",
    targetReturn > MAX_CONFIRMED_ROLLING_RETURN ? "단기 과열 상승" : "",
    monthHighDrawdown <= -MAX_CONFIRMED_HIGH_DRAWDOWN ? "고점 이탈" : "",
    weakMarketRegime ? "시장 약세" : "",
    mirofishAdjustedScore < MIN_CONFIRMED_SETUP_SCORE ? "확신 점수 부족" : "",
    mirofishFit?.score <= -0.25 ? `MiroFish ${mirofishFit.label}` : "",
  ].filter(Boolean);
  const cautionObservation =
    overheatRisk ||
    mfiReversalRisk ||
    eventPriceLockRisk ||
    speculativeBiotechRisk ||
    targetReturn > MAX_CONFIRMED_ROLLING_RETURN;

  if (
    mirofishAdjustedScore < MIN_SETUP_SCORE ||
    (!confirmedCandidate && !observationCandidate && !earlyObservationCandidate)
  ) {
    return null;
  }

  const confirmationReady =
    confirmedCandidate &&
    targetReturn <= MAX_CONFIRMED_ROLLING_RETURN &&
    mirofishAdjustedScore >= MIN_CONFIRMED_SETUP_SCORE &&
    monthHighDrawdown > -MAX_CONFIRMED_HIGH_DRAWDOWN &&
    !mfiReversalRisk &&
    !eventPriceLockRisk &&
    !speculativeBiotechRisk &&
    !overheatRisk &&
    !weakMarketRegime &&
    (!mirofishFit || mirofishFit.score > -0.35);
  const highConfidenceCandidate =
    confirmationReady &&
    ((volumeStats.volumeRatio >= MIN_HIGH_CONFIDENCE_VOLUME_RATIO &&
      relativeReturn >= MIN_HIGH_CONFIDENCE_RELATIVE_RETURN) ||
      monthHighDrawdown >= -MAX_HIGH_CONFIDENCE_DRAWDOWN);
  const recommendationStage = confirmationReady
    ? "confirmed"
    : confirmedCandidate || observationCandidate
      ? "watch"
      : "observe";
  const riskStage = cautionObservation ? "caution" : "normal";
  const riskStageLabel = cautionObservation ? "주의 관찰" : "";
  const signal =
    riskStage === "caution"
      ? "주의 관찰 후보"
      : recommendationStage === "confirmed"
      ? highConfidenceCandidate
        ? "고확신 1개월 상승 후보"
        : setupScore >= 85
        ? "강한 1개월 상승 후보"
        : "1개월 상승 후보"
      : recommendationStage === "watch"
        ? "강한 관찰 후보"
        : "관찰 후보";

  return {
    aboveTenDayAverage,
    aboveTrailing3Average: aboveTenDayAverage,
    benchmarkReturn: round(benchmarkReturn, 2),
    benchmarkAsOf,
    breakout,
    confidenceRank: highConfidenceCandidate ? 2 : confirmationReady ? 1 : 0,
    confidenceTier: highConfidenceCandidate ? "high" : confirmationReady ? "standard" : "",
    exchange: stock.exchange,
    firstToLastReturn: round(percentChange(current.close, recentWindow[0]?.close), 2),
    dayReturn: round(percentChange(current.close, previousTradingDay?.close), 2),
    lastClose: round(current.close, 4),
    lastDate: current.date,
    isCompleteBar: current.date === benchmarkAsOf && current.date <= COMPLETED_SESSION_CUTOFF,
    mfi: round(mfi, 2),
    mfiReversalRisk,
    mirofishAdjustedScore,
    mirofishBonus: mirofishFit?.bonus ?? 0,
    mirofishConfidence: mirofishFit?.confidence ?? null,
    mirofishConsensusStrength: mirofishFit?.consensusStrength ?? null,
    mirofishDisagreement: mirofishFit?.disagreement ?? null,
    mirofishDrivers: mirofishFit?.drivers || [],
    mirofishAgentScores: mirofishAgentScores(mirofishSimulation),
    mirofishLabel: mirofishFit?.label || "",
    mirofishMarketScore: mirofishSimulation?.score ?? null,
    mirofishScore: round(Number(mirofishFit?.score), 4),
    mirofishTone: mirofishFit?.tone || "",
    monthHigh: round(rollingHigh, 4),
    monthHighDrawdown: round(monthHighDrawdown, 2),
    monthlyReturn: round(targetReturn, 2),
    name: stock.name,
    next1mReturn: round(forwardTradingDayReturn(sortedRows, targetIndex, 21), 2),
    next3mReturn: round(forwardTradingDayReturn(sortedRows, targetIndex, 63), 2),
    next6mReturn: round(forwardTradingDayReturn(sortedRows, targetIndex, 126), 2),
    previousAverageVolume: Math.round(volumeStats.previousAverageVolume),
    previousCloseHigh: round(previousCloseHigh, 4),
    previousDayClose: round(previousTradingDay?.close, 4),
    previousMonthClose: round(returnBase.close, 4),
    rawSymbol: stock.rawSymbol,
    recentVolumeDays: RECENT_VOLUME_DAYS,
    recentVolumeRatio: round(recentVolumeRatio, 2),
    recentWorstDailyReturn: round(recentWorstDailyReturn, 2),
    recommendationStage,
    eventPriceLockRisk,
    riskStage,
    riskStageLabel,
    relativeReturn: round(relativeReturn, 2),
    rollingReturn: round(targetReturn, 2),
    rollingWindowDays: ROLLING_WINDOW_DAYS,
    rollingWindowStartDate: recentWindow[0]?.date || "",
    setupScore,
    signal,
    symbol: stock.symbol,
    targetMonthVolume: Math.round(volumeStats.recentVolume),
    speculativeBiotechRisk,
    technicalCautionReasons,
    technicalRecommendationStage: confirmedCandidate ? "confirmed" : recommendationStage,
    weakMarketRegime,
    volumeRatio: round(volumeStats.volumeRatio, 2),
  };
}

function recommendationOverheatRisk({
  mfi,
  monthHighDrawdown,
  recentWorstDailyReturn,
  targetReturn,
  volumeRatio,
}) {
  if (targetReturn >= EXTREME_RETURN) return true;
  if (mfi >= OVERHEAT_MFI && targetReturn >= OVERHEAT_RETURN && monthHighDrawdown > -3) {
    return true;
  }
  return (
    volumeRatio >= EXTREME_VOLUME_RATIO &&
    mfi >= OVERHEAT_MFI &&
    recentWorstDailyReturn <= -8
  );
}

function recommendationMfiReversalRisk({
  mfi,
  monthHighDrawdown,
  recentVolumeRatio,
  recentWorstDailyReturn,
}) {
  return (
    mfi >= MAX_CONFIRMED_MFI &&
    monthHighDrawdown <= -MFI_REVERSAL_MAX_HIGH_DRAWDOWN &&
    recentVolumeRatio >= MFI_REVERSAL_RECENT_VOLUME_RATIO &&
    recentWorstDailyReturn <= -MFI_REVERSAL_WORST_DAILY_RETURN
  );
}

function recommendationEventPriceLockRisk({
  monthHighDrawdown,
  recentVolumeRatio,
  recentWorstDailyReturn,
  targetReturn,
  volumeRatio,
}) {
  return (
    volumeRatio >= EVENT_LOCK_VOLUME_RATIO &&
    recentVolumeRatio >= EVENT_LOCK_RECENT_VOLUME_RATIO &&
    monthHighDrawdown >= -EVENT_LOCK_MAX_HIGH_DRAWDOWN &&
    targetReturn <= EVENT_LOCK_MAX_ROLLING_RETURN &&
    recentWorstDailyReturn >= -EVENT_LOCK_MAX_RECENT_WORST_DAILY_RETURN
  );
}

function usSpeculativeBiotechRisk(stock) {
  const source = [stock.name, stock.industry, stock.sector].filter(Boolean).join(" ").toLowerCase();
  return /biotech|biotechnology|biopharma|therapeutics|clinical|oncology|pharmaceutical preparations/.test(
    source,
  );
}

function recommendationWeakMarketRegime({
  benchmarkReturn,
  breakout,
  relativeReturn,
  targetReturn,
}) {
  if (!Number.isFinite(benchmarkReturn) || benchmarkReturn > WEAK_MARKET_RETURN) {
    return false;
  }
  return !(
    breakout &&
    relativeReturn >= WEAK_MARKET_OVERRIDE_RELATIVE_RETURN &&
    targetReturn >= WEAK_MARKET_OVERRIDE_RETURN
  );
}

function rollingBreakoutScore({
  aboveTenDayAverage,
  breakout,
  mfi,
  recentVolumeRatio,
  relativeReturn,
  targetReturn,
  volumeRatio,
}) {
  let score = 0;
  score += Math.min(22, (volumeRatio / MIN_VOLUME_RATIO) * 22);
  score += Math.min(16, (recentVolumeRatio / MIN_RECENT_VOLUME_RATIO) * 16);
  score += Math.min(18, (targetReturn / MIN_ROLLING_RETURN) * 18);
  score += Math.min(12, (relativeReturn / MIN_RELATIVE_RETURN) * 12);
  score += breakout ? 12 : 0;
  score += aboveTenDayAverage ? 8 : 0;
  score += Math.min(12, (mfi / MIN_MFI) * 12);
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

function latestIndexInMonth(rows, month) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].date.startsWith(month)) return index;
  }
  return -1;
}

function effectiveMarketMonth(requestedMonth, benchmarkRows) {
  if (benchmarkRows.some((row) => row.date?.startsWith(requestedMonth))) {
    return requestedMonth;
  }

  const firstDayOfNextMonth = `${shiftMonth(requestedMonth, 1)}-01`;
  const latestAvailableRow = benchmarkRows
    .filter((row) => row.date && row.date < firstDayOfNextMonth)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return latestAvailableRow?.date?.slice(0, 7) || requestedMonth;
}

function latestIndexAtOrBefore(rows, date) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].date <= date) return index;
  }
  return -1;
}

function rollingVolumeStats(rows, targetIndex, windowDays, comparisonCount) {
  const recentStart = targetIndex - windowDays + 1;
  const previousStart = recentStart - windowDays * comparisonCount;
  if (previousStart < 0) return null;

  const recentRows = rows.slice(recentStart, targetIndex + 1);
  const previousRows = rows.slice(previousStart, recentStart);
  if (
    recentRows.length < windowDays ||
    previousRows.length < windowDays * comparisonCount
  ) {
    return null;
  }

  const recentVolume = sum(recentRows.map((row) => row.volume));
  const previousVolumes = Array.from({ length: comparisonCount }, (_, index) => {
    const start = index * windowDays;
    const groupRows = previousRows.slice(start, start + windowDays);
    return sum(groupRows.map((row) => row.volume));
  });
  const previousAverageVolume = average(previousVolumes);
  if (!Number.isFinite(previousAverageVolume) || previousAverageVolume <= 0) {
    return null;
  }

  return {
    previousAverageVolume,
    recentVolume,
    volumeRatio: recentVolume / previousAverageVolume,
  };
}

function recentAverageVolumeRatio(rows, targetIndex, recentDays, previousDays) {
  const recentStart = targetIndex - recentDays + 1;
  const previousStart = recentStart - previousDays;
  if (previousStart < 0) return NaN;

  const recentRows = rows.slice(recentStart, targetIndex + 1);
  const previousRows = rows.slice(previousStart, recentStart);
  if (recentRows.length < recentDays || previousRows.length < previousDays) {
    return NaN;
  }

  const recentAverage = average(recentRows.map((row) => row.volume));
  const previousAverage = average(previousRows.map((row) => row.volume));
  if (!Number.isFinite(previousAverage) || previousAverage <= 0) return NaN;
  return recentAverage / previousAverage;
}

function benchmarkRollingReturn(rows, targetDate, windowDays) {
  const targetIndex = exactDateIndex(rows || [], targetDate);
  if (targetIndex < windowDays) return NaN;
  return percentChange(rows[targetIndex].close, rows[targetIndex - windowDays].close);
}

function forwardTradingDayReturn(rows, targetIndex, daysForward) {
  const target = rows[targetIndex + daysForward];
  if (!target) return NaN;
  return percentChange(target.close, rows[targetIndex].close);
}

function worstRecentDailyReturn(rows, days) {
  const recent = rows.slice(-(days + 1));
  if (recent.length < 2) return NaN;
  return Math.min(
    ...recent.slice(1).map((row, index) => percentChange(row.close, recent[index].close)),
  );
}

async function fetchUsUniverse({ minimumMarketCapUsd = 0 } = {}) {
  const [nasdaqText, otherText, screenerRows] = await Promise.all([
    fetchText(NASDAQ_LISTED),
    fetchText(OTHER_LISTED),
    fetchNasdaqScreenerStocks().catch((error) => {
      console.error(`Nasdaq screener metadata unavailable: ${error.message}`);
      return [];
    }),
  ]);

  const screenerBySymbol = new Map(
    screenerRows.map((row) => [String(row.symbol || "").toUpperCase(), row]),
  );

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
  const all = [...nasdaq, ...other]
    .filter((stock) => {
      if (!stock.symbol || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return isCommonEquity(stock);
    })
    .map((stock) => {
      const screener = screenerBySymbol.get(stock.symbol.toUpperCase());
      return {
        ...stock,
        country: screener?.country || "",
        industry: screener?.industry || "",
        marketCapUsd: finiteNumber(screener?.marketCapUsd),
        sector: screener?.sector || "",
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const hasMarketCapPrefilter =
    MARKET_CAP_PREFILTER &&
    !SYMBOL_FILTER.size &&
    minimumMarketCapUsd > 0 &&
    screenerBySymbol.size > 0;
  const universe = hasMarketCapPrefilter
    ? all.filter((stock) => stock.marketCapUsd >= minimumMarketCapUsd)
    : all;

  return {
    allBySymbol: new Map(all.map((stock) => [stock.symbol.toUpperCase(), stock])),
    marketCapCoverageCount: all.filter((stock) => Number.isFinite(stock.marketCapUsd)).length,
    rawCount: all.length,
    universe,
    usedMarketCapPrefilter: hasMarketCapPrefilter,
  };
}

function filteredUniverse(universe, bySymbol = new Map()) {
  if (!SYMBOL_FILTER.size) return universe;
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

async function fetchNasdaqScreenerStocks() {
  const response = await fetch(NASDAQ_SCREENER, { headers: NASDAQ_API_HEADERS });
  if (!response.ok) {
    throw new Error(`Nasdaq screener unavailable: ${response.status}`);
  }

  const json = await response.json();
  const rows = json.data?.rows;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("empty Nasdaq screener data");
  }

  return rows
    .map((row) => ({
      country: row.country || "",
      industry: row.industry || "",
      marketCapUsd: parseNasdaqNumber(row.marketCap),
      name: row.name || "",
      sector: row.sector || "",
      symbol: normalizeNasdaqSymbol(row.symbol),
    }))
    .filter((row) => row.symbol);
}

async function fetchNasdaqDaily(stock) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
    stock.symbol,
  )}/historical?assetclass=stocks&fromdate=${historyStartDate()}&todate=${historyEndDate()}&limit=9999`;
  const response = await fetch(url, { headers: NASDAQ_API_HEADERS });
  if (!response.ok) {
    console.error(
      `Nasdaq historical unavailable for ${stock.symbol}: ${response.status}; falling back to Yahoo`,
    );
    return fetchYahooDaily(stock.symbol, historyStartDate(), historyEndDate());
  }

  const json = await response.json();
  const rows = json.data?.tradesTable?.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return fetchYahooDaily(stock.symbol, historyStartDate(), historyEndDate());
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

async function fetchMirofishMarketHistories(seed = {}) {
  const histories = { ...seed };
  const entries = Object.entries(MIROFISH_MARKET_SYMBOLS).filter(([id]) => !histories[id]);
  const settled = await Promise.allSettled(
    entries.map(async ([id, symbol]) => [
      id,
      await fetchYahooDaily(symbol, historyStartDate(), historyEndDate()),
    ]),
  );
  for (const result of settled) {
    if (result.status === "fulfilled") {
      const [id, rows] = result.value;
      histories[id] = rows;
    } else {
      console.error(`mirofish market series unavailable: ${result.reason.message}`);
    }
  }
  return histories;
}

function mirofishSimulationForDate(date) {
  if (!date) return null;
  if (!mirofishSimulationByDate.has(date)) {
    mirofishSimulationByDate.set(
      date,
      buildMirofishSimulationFromHistories(mirofishMarketHistories, date, {
        agentPerformance: mirofishAgentPerformance,
      }),
    );
  }
  return mirofishSimulationByDate.get(date);
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
    "confidenceTier",
    "confidenceRank",
    "setupScore",
    "mirofishAdjustedScore",
    "mirofishBonus",
    "mirofishConfidence",
    "mirofishConsensusStrength",
    "mirofishDisagreement",
    "mirofishScore",
    "mirofishLabel",
    "mirofishTone",
    "mirofishDrivers",
    "mirofishAgentScores",
    "mirofishMarketScore",
    "lastDate",
    "lastClose",
    "previousDayClose",
    "dayReturn",
    "monthlyReturn",
    "rollingReturn",
    "benchmarkReturn",
    "relativeReturn",
    "firstToLastReturn",
    "targetMonthVolume",
    "previousAverageVolume",
    "recentVolumeRatio",
    "recentVolumeDays",
    "previousCloseHigh",
    "previousMonthClose",
    "volumeRatio",
    "mfi",
    "breakout",
    "aboveTenDayAverage",
    "aboveTrailing3Average",
    "recommendationStage",
    "riskStage",
    "riskStageLabel",
    "rollingWindowDays",
    "rollingWindowStartDate",
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

function movingAverage(values, period) {
  const recent = values.filter(Number.isFinite).slice(-period);
  return recent.length === period ? average(recent) : NaN;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvEscape(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
