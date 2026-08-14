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
const MARKET_MONTH = process.argv[2] || "2026-05";
const SCREEN_NOW = process.env.SCREEN_NOW ? new Date(process.env.SCREEN_NOW) : new Date();
const COMPLETED_SESSION_CUTOFF = completedSessionCutoffDate({
  completionHour: 16,
  now: SCREEN_NOW,
  timeZone: "Asia/Seoul",
});
const SCREEN_VERSION = criteriaString(
  RECOMMENDATION_CRITERIA,
  "screenVersion.domestic",
  "kr-rolling-21-v8",
);
const COMPARISON_MONTH_COUNT = Number(
  process.env.COMPARE_MONTHS ||
    process.argv[3] ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "comparisonMonthCount", 5),
);
const MIN_MARKET_CAP_KRW = Number(
  process.env.MIN_MARKET_CAP_KRW ||
    process.argv[4] ||
    criteriaMarketCap(RECOMMENDATION_CRITERIA, "domestic", 1_000_000_000_000),
);
const ALLOWED_MARKETS = new Set(
  (process.env.SCREEN_MARKETS || process.argv[5] || "KOSPI,KOSDAQ")
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean),
);
const CONCURRENCY = Number(process.env.SCREEN_CONCURRENCY || 8);
const LIMIT = Number(process.env.SCREEN_LIMIT || 0);
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
const MIN_DOMESTIC_CONFIRMED_VOLUME_RATIO = Number(
  process.env.MIN_DOMESTIC_CONFIRMED_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "domesticConfirmedVolumeRatio", 2),
);
const MIN_DOMESTIC_CONFIRMED_RELATIVE_RETURN = Number(
  process.env.MIN_DOMESTIC_CONFIRMED_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "domesticConfirmedRelativeReturn", 30),
);
const MIN_DOMESTIC_CONFIRMED_MFI = Number(
  process.env.MIN_DOMESTIC_CONFIRMED_MFI ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "domesticConfirmedMfi", 88),
);
const MIN_DOMESTIC_KOSPI_CONFIRMED_VOLUME_RATIO = Number(
  process.env.MIN_DOMESTIC_KOSPI_CONFIRMED_VOLUME_RATIO ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "domesticKospiConfirmedVolumeRatio", 2.2),
);
const MIN_DOMESTIC_KOSPI_CONFIRMED_RELATIVE_RETURN = Number(
  process.env.MIN_DOMESTIC_KOSPI_CONFIRMED_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "domesticKospiConfirmedRelativeReturn", 40),
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
const WEAK_MARKET_RETURN = Number(
  process.env.WEAK_MARKET_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketReturn.domestic", 0),
);
const WEAK_MARKET_OVERRIDE_RELATIVE_RETURN = Number(
  process.env.WEAK_MARKET_OVERRIDE_RELATIVE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketOverrideRelativeReturn", 25),
);
const WEAK_MARKET_OVERRIDE_RETURN = Number(
  process.env.WEAK_MARKET_OVERRIDE_RETURN ||
    criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketOverrideReturn", 30),
);
const MARKET_CAP_PREFILTER = process.env.MARKET_CAP_PREFILTER !== "0";
const KRX_CORP_LIST =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const BENCHMARKS = {
  KOSDAQ: { label: "KOSDAQ", symbol: "^KQ11" },
  KOSPI: { label: "KOSPI", symbol: "^KS11" },
};

const benchmarkRowsByMarket = Object.fromEntries(
  await Promise.all(
    Object.entries(BENCHMARKS).map(async ([marketType, source]) => [
      marketType,
      await fetchYahooDaily(source.symbol, historyStartDate(), historyEndDate()),
    ]),
  ),
);
const benchmarkAsOfByMarket = Object.fromEntries(
  Object.entries(benchmarkRowsByMarket).map(([marketType, rows]) => [
    marketType,
    latestDateInMonthAtOrBefore(rows, MARKET_MONTH, COMPLETED_SESSION_CUTOFF),
  ]),
);
const IS_COMPLETE_BAR = Object.keys(BENCHMARKS).every(
  (marketType) =>
    Boolean(benchmarkAsOfByMarket[marketType]) &&
    benchmarkAsOfByMarket[marketType] <= COMPLETED_SESSION_CUTOFF,
);
const mirofishMarketHistories = await fetchMirofishMarketHistories({
  kosdaq: benchmarkRowsByMarket.KOSDAQ,
  kospi: benchmarkRowsByMarket.KOSPI,
});
const mirofishAgentPerformance =
  process.env.MIROFISH_AGENT_PERFORMANCE === "0"
    ? null
    : loadMirofishAgentPerformance();
const mirofishSimulationByDate = new Map();
const rawUniverse = (await fetchKrxUniverse())
  .filter((stock) => ALLOWED_MARKETS.has(stock.marketType))
  .map((stock, universeIndex) => ({ ...stock, universeIndex }));
const prefilterSourceUniverse = rawUniverse.slice(0, LIMIT || undefined);
const universeInfo = MARKET_CAP_PREFILTER
  ? await prefilterKrxUniverseByMarketCap(prefilterSourceUniverse)
  : {
      marketCapFailureCount: 0,
      rawCount: prefilterSourceUniverse.length,
      universe: prefilterSourceUniverse,
      usedMarketCapPrefilter: false,
    };
const universe = universeInfo.universe;
if (universeInfo.usedMarketCapPrefilter) {
  console.error(
    `prefiltered ${universeInfo.universe.length}/${universeInfo.rawCount} by market cap`,
  );
}
if (prefilterSourceUniverse.length !== rawUniverse.length) {
  console.error(`universe ${prefilterSourceUniverse.length}/${rawUniverse.length} after limit`);
}
const results = [];
const failures = [];
let completed = 0;

await runPool(universe, CONCURRENCY, async (stock) => {
  try {
    const rows = await fetchNaverDaily(stock);
    const screening = screenStock(
      stock,
      rows,
      benchmarkRowsByMarket[stock.marketType],
      benchmarkAsOfByMarket[stock.marketType],
    );
    if (!screening) return;

    const marketCapKrw = Number.isFinite(stock.marketCapKrw)
      ? stock.marketCapKrw
      : await fetchNaverMarketCapKrw(stock);
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
    (b.confidenceRank || 0) - (a.confidenceRank || 0) ||
    (b.mirofishAdjustedScore ?? b.setupScore) - (a.mirofishAdjustedScore ?? a.setupScore) ||
    b.setupScore - a.setupScore ||
    b.relativeReturn - a.relativeReturn ||
    b.volumeRatio - a.volumeRatio,
);

const payload = {
  generatedAt: new Date().toISOString(),
  benchmarkAsOfByMarket,
  benchmarkByMarket: Object.fromEntries(
    Object.entries(BENCHMARKS).map(([marketType, source]) => [
      marketType,
      source.label,
    ]),
  ),
  comparisonMonthCount: COMPARISON_MONTH_COUNT,
  completionPolicy: {
    cutoffDate: COMPLETED_SESSION_CUTOFF,
    marketCloseBuffer: "16:00 Asia/Seoul",
    requiresBenchmarkDateMatch: true,
  },
  condition: buildStockRecommendationCondition(
    RECOMMENDATION_CRITERIA,
    MIN_MARKET_CAP_KRW,
    {
      domesticTightConfirmation: true,
      marketFilter: [...ALLOWED_MARKETS],
    },
  ),
  marketMonth: MARKET_MONTH,
  criteriaHash: CRITERIA_HASH,
  dataAsOf: [...new Set(Object.values(benchmarkAsOfByMarket).filter(Boolean))].join(","),
  dataAsOfByMarket: benchmarkAsOfByMarket,
  isCompleteBar: IS_COMPLETE_BAR,
  note:
    "Forward returns are included only for historical review and are not used in the screen.",
  screenVersion: SCREEN_VERSION,
  mirofish: {
    enabled: true,
    adjustment: "setupScore is adjusted by market/theme fit before final sorting",
    agentPerformance: mirofishAgentPerformance,
    availableMarketSeries: Object.keys(mirofishMarketHistories),
  },
  universe: "KRX listed corporations from KIND; KOSPI/KOSDAQ stocks only",
  universeAsOf: localDateTimeParts(SCREEN_NOW, "Asia/Seoul").date,
  marketCapPrefilter: {
    enabled: universeInfo.usedMarketCapPrefilter,
    failureCount: universeInfo.marketCapFailureCount,
    rawCount: universeInfo.rawCount,
    universeCount: universeInfo.universe.length,
  },
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

function screenStock(stock, rows, benchmarkRows, benchmarkAsOf) {
  const sortedRows = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!benchmarkAsOf || !benchmarkAsOf.startsWith(MARKET_MONTH)) return null;
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
      name: stock.name,
    },
    { baseMarket: "domestic", simulation: mirofishSimulation },
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
  const weakMarketRegime = recommendationWeakMarketRegime({
    benchmarkReturn,
    breakout,
    relativeReturn,
    targetReturn,
  });
  const technicalCautionReasons = [
    overheatRisk ? "과열 신호" : "",
    mfiReversalRisk ? "MFI 과열 후 되밀림" : "",
    targetReturn > MAX_CONFIRMED_ROLLING_RETURN ? "단기 과열 상승" : "",
    monthHighDrawdown <= -MAX_CONFIRMED_HIGH_DRAWDOWN ? "고점 이탈" : "",
    weakMarketRegime ? "시장 약세" : "",
    setupScore < MIN_CONFIRMED_SETUP_SCORE ? "확신 점수 부족" : "",
    volumeStats.volumeRatio < MIN_DOMESTIC_CONFIRMED_VOLUME_RATIO
      ? "국내 거래량 확신 부족"
      : "",
    relativeReturn < MIN_DOMESTIC_CONFIRMED_RELATIVE_RETURN
      ? "국내 상대강도 확신 부족"
      : "",
    mfi < MIN_DOMESTIC_CONFIRMED_MFI ? "국내 MFI 확신 부족" : "",
    stock.marketType === "KOSPI" &&
    volumeStats.volumeRatio < MIN_DOMESTIC_KOSPI_CONFIRMED_VOLUME_RATIO
      ? "KOSPI 거래량 강화 기준 부족"
      : "",
    stock.marketType === "KOSPI" &&
    relativeReturn < MIN_DOMESTIC_KOSPI_CONFIRMED_RELATIVE_RETURN
      ? "KOSPI 상대강도 강화 기준 부족"
      : "",
    mirofishFit?.score <= -0.25 ? `MiroFish ${mirofishFit.label}` : "",
  ].filter(Boolean);
  const cautionObservation =
    overheatRisk || mfiReversalRisk || targetReturn > MAX_CONFIRMED_ROLLING_RETURN;

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
    volumeStats.volumeRatio >= MIN_DOMESTIC_CONFIRMED_VOLUME_RATIO &&
    relativeReturn >= MIN_DOMESTIC_CONFIRMED_RELATIVE_RETURN &&
    mfi >= MIN_DOMESTIC_CONFIRMED_MFI &&
    (stock.marketType !== "KOSPI" ||
      (volumeStats.volumeRatio >= MIN_DOMESTIC_KOSPI_CONFIRMED_VOLUME_RATIO &&
        relativeReturn >= MIN_DOMESTIC_KOSPI_CONFIRMED_RELATIVE_RETURN)) &&
    !mfiReversalRisk &&
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
    benchmark: BENCHMARKS[stock.marketType]?.label || stock.marketType,
    benchmarkAsOf,
    benchmarkReturn: round(benchmarkReturn, 2),
    breakout,
    confidenceRank: highConfidenceCandidate ? 2 : confirmationReady ? 1 : 0,
    confidenceTier: highConfidenceCandidate ? "high" : confirmationReady ? "standard" : "",
    code: stock.code,
    firstToLastReturn: round(percentChange(current.close, recentWindow[0]?.close), 2),
    dayReturn: round(percentChange(current.close, previousTradingDay?.close), 2),
    lastClose: current.close,
    lastDate: current.date,
    isCompleteBar: current.date === benchmarkAsOf && current.date <= COMPLETED_SESSION_CUTOFF,
    market: stock.market,
    marketType: stock.marketType,
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
    monthHigh: rollingHigh,
    monthHighDrawdown: round(monthHighDrawdown, 2),
    monthlyReturn: round(targetReturn, 2),
    name: stock.name,
    next1mReturn: round(forwardTradingDayReturn(sortedRows, targetIndex, 21), 2),
    next3mReturn: round(forwardTradingDayReturn(sortedRows, targetIndex, 63), 2),
    next6mReturn: round(forwardTradingDayReturn(sortedRows, targetIndex, 126), 2),
    previousAverageVolume: Math.round(volumeStats.previousAverageVolume),
    previousCloseHigh,
    previousDayClose: previousTradingDay?.close ?? null,
    previousMonthClose: returnBase.close,
    recentVolumeDays: RECENT_VOLUME_DAYS,
    recentVolumeRatio: round(recentVolumeRatio, 2),
    recentWorstDailyReturn: round(recentWorstDailyReturn, 2),
    recommendationStage,
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

function recommendationWeakMarketRegime({
  benchmarkReturn,
  breakout,
  relativeReturn,
  targetReturn,
}) {
  if (!Number.isFinite(benchmarkReturn) || benchmarkReturn >= WEAK_MARKET_RETURN) {
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

async function prefilterKrxUniverseByMarketCap(rawUniverse) {
  const universe = [];
  const failures = [];
  let completedMarketCap = 0;

  await runPool(rawUniverse, CONCURRENCY, async (stock) => {
    try {
      const marketCapKrw = await fetchNaverMarketCapKrw(stock);
      if (marketCapKrw >= MIN_MARKET_CAP_KRW) {
        universe.push({ ...stock, marketCapKrw });
      }
    } catch (error) {
      failures.push({ ...stock, error: error.message });
    } finally {
      completedMarketCap += 1;
      if (completedMarketCap % 100 === 0 || completedMarketCap === rawUniverse.length) {
        console.error(`marketcap ${completedMarketCap}/${rawUniverse.length}`);
      }
    }
  });

  universe.sort((a, b) => a.universeIndex - b.universeIndex);
  return {
    marketCapFailureCount: failures.length,
    rawCount: rawUniverse.length,
    universe,
    usedMarketCapPrefilter: true,
  };
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

function movingAverage(values, period) {
  const recent = values.filter(Number.isFinite).slice(-period);
  return recent.length === period ? average(recent) : NaN;
}

function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function csvEscape(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
