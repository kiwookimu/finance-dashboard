import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  criteriaMarketCap,
  criteriaMinimumHistoryDays,
  criteriaNumber,
  loadRecommendationCriteria,
} = require("../lib/recommendationCriteria");
const {
  MIROFISH_MARKET_SYMBOLS,
  applyMirofishSetupScore,
  buildMirofishAgentPerformance,
  buildMirofishSimulationFromHistories,
  loadMirofishAgentPerformance,
  mirofishAgentScores,
  scoreRecommendationWithMirofish,
} = require("../lib/mirofishScreener");
const RECOMMENDATION_CRITERIA = loadRecommendationCriteria();

const MARKET = (process.argv[2] || "both").toLowerCase();
const START_MONTH = process.argv[3] || "2025-01";
const END_MONTH = process.argv[4] || "2026-05";
const CONCURRENCY = Number(process.env.BACKTEST_SCREEN_CONCURRENCY || 10);
const LIMIT = Number(process.env.BACKTEST_SCREEN_LIMIT || 0);
const COMPARE_MONTHS = criteriaNumber(RECOMMENDATION_CRITERIA, "comparisonMonthCount", 5);
const ROLLING_WINDOW_DAYS = criteriaNumber(RECOMMENDATION_CRITERIA, "rollingWindowDays", 21);
const RECENT_VOLUME_DAYS = criteriaNumber(RECOMMENDATION_CRITERIA, "recentVolumeDays", 5);
const MIN_HISTORY_DAYS = criteriaMinimumHistoryDays(RECOMMENDATION_CRITERIA);
const MIN_SETUP_SCORE = criteriaNumber(RECOMMENDATION_CRITERIA, "setupScore", 70);
const MIN_CONFIRMED_SETUP_SCORE = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "confirmedSetupScore",
  75,
);
const MIN_VOLUME_RATIO = criteriaNumber(RECOMMENDATION_CRITERIA, "volumeRatio", 1.8);
const MIN_RECENT_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "recentVolumeRatio",
  1.8,
);
const MIN_KR_CONFIRMED_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "domesticConfirmedVolumeRatio",
  2,
);
const MIN_KR_CONFIRMED_RELATIVE_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "domesticConfirmedRelativeReturn",
  30,
);
const MIN_KR_CONFIRMED_MFI = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "domesticConfirmedMfi",
  88,
);
const MIN_KR_KOSPI_CONFIRMED_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "domesticKospiConfirmedVolumeRatio",
  2.2,
);
const MIN_KR_KOSPI_CONFIRMED_RELATIVE_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "domesticKospiConfirmedRelativeReturn",
  40,
);
const MIN_WATCH_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "watchVolumeRatio",
  1.2,
);
const MIN_ROLLING_RETURN = criteriaNumber(RECOMMENDATION_CRITERIA, "rollingReturn", 15);
const MAX_CONFIRMED_ROLLING_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "maxConfirmedRollingReturn",
  80,
);
const MIN_HIGH_CONFIDENCE_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "highConfidenceVolumeRatio",
  2.2,
);
const MIN_HIGH_CONFIDENCE_RELATIVE_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "highConfidenceRelativeReturn",
  40,
);
const MAX_HIGH_CONFIDENCE_DRAWDOWN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "highConfidenceMaxHighDrawdown",
  3,
);
const MIN_WATCH_RETURN = criteriaNumber(RECOMMENDATION_CRITERIA, "watchReturn", 60);
const MIN_RELATIVE_RETURN = criteriaNumber(RECOMMENDATION_CRITERIA, "relativeReturn", 8);
const MIN_MFI = criteriaNumber(RECOMMENDATION_CRITERIA, "mfi", 80);
const MIN_WATCH_MFI = criteriaNumber(RECOMMENDATION_CRITERIA, "watchMfi", 75);
const MIN_OBSERVATION_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "observationVolumeRatio",
  1.2,
);
const MIN_OBSERVATION_RECENT_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "observationRecentVolumeRatio",
  1.5,
);
const MIN_OBSERVATION_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "observationReturn",
  60,
);
const MIN_OBSERVATION_RELATIVE_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "observationRelativeReturn",
  40,
);
const MIN_OBSERVATION_MFI = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "observationMfi",
  75,
);
const MAX_OBSERVATION_HIGH_DRAWDOWN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "observationMaxHighDrawdown",
  5,
);
const MOVING_AVERAGE_DAYS = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "movingAverageDays",
  10,
);
const MAX_ROLLING_HIGH_DRAWDOWN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "maxRollingHighDrawdown",
  20,
);
const MAX_CONFIRMED_HIGH_DRAWDOWN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "maxConfirmedHighDrawdown",
  10,
);
const MAX_CONFIRMED_MFI = criteriaNumber(RECOMMENDATION_CRITERIA, "maxConfirmedMfi", 90);
const MFI_REVERSAL_MAX_HIGH_DRAWDOWN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "mfiReversalMaxHighDrawdown",
  5,
);
const MFI_REVERSAL_RECENT_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "mfiReversalRecentVolumeRatio",
  3,
);
const MFI_REVERSAL_WORST_DAILY_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "mfiReversalWorstDailyReturn",
  3,
);
const OVERHEAT_MFI = criteriaNumber(RECOMMENDATION_CRITERIA, "overheatMfi", 92);
const OVERHEAT_RETURN = criteriaNumber(RECOMMENDATION_CRITERIA, "overheatReturn", 70);
const EXTREME_RETURN = criteriaNumber(RECOMMENDATION_CRITERIA, "extremeReturn", 100);
const EXTREME_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "extremeVolumeRatio",
  12,
);
const EVENT_LOCK_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "eventLockVolumeRatio",
  5,
);
const EVENT_LOCK_RECENT_VOLUME_RATIO = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "eventLockRecentVolumeRatio",
  3,
);
const EVENT_LOCK_MAX_HIGH_DRAWDOWN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "eventLockMaxHighDrawdown",
  1,
);
const EVENT_LOCK_MAX_ROLLING_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "eventLockMaxRollingReturn",
  35,
);
const EVENT_LOCK_MAX_RECENT_WORST_DAILY_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "eventLockMaxRecentWorstDailyReturn",
  3,
);
const WEAK_MARKET_RETURN = criteriaNumber(RECOMMENDATION_CRITERIA, "weakMarketReturn.us", -5);
const KR_WEAK_MARKET_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "weakMarketReturn.domestic",
  0,
);
const WEAK_MARKET_OVERRIDE_RELATIVE_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "weakMarketOverrideRelativeReturn",
  25,
);
const WEAK_MARKET_OVERRIDE_RETURN = criteriaNumber(
  RECOMMENDATION_CRITERIA,
  "weakMarketOverrideReturn",
  30,
);
const KR_MIN_MARKET_CAP_KRW = criteriaMarketCap(
  RECOMMENDATION_CRITERIA,
  "domestic",
  1_000_000_000_000,
);
const US_MIN_MARKET_CAP_KRW = criteriaMarketCap(
  RECOMMENDATION_CRITERIA,
  "us",
  10_000_000_000_000,
);
const HORIZONS = [
  { days: 5, key: "next1wReturn", label: "1주" },
  { days: 21, key: "next1mReturn", label: "1개월" },
  { days: 63, key: "next3mReturn", label: "3개월" },
  { days: 126, key: "next6mReturn", label: "6개월" },
];
const MONTHS = monthRange(START_MONTH, END_MONTH);
const TODAY = new Date().toISOString().slice(0, 10);
const FETCH_START_DATE = `${shiftMonth(START_MONTH, -(COMPARE_MONTHS + 8))}-01`;
const FETCH_END_DATE = TODAY;
const mirofishAgentPerformance =
  process.env.MIROFISH_AGENT_PERFORMANCE === "0"
    ? null
    : loadMirofishAgentPerformance();

const rows = [];
if (MARKET === "both" || MARKET === "kr" || MARKET === "domestic") {
  rows.push(...(await runKoreaBacktest()));
}
if (MARKET === "both" || MARKET === "us") {
  rows.push(...(await runUsBacktest()));
}

const summary = summarizeRows(rows);
const strategyComparison = summarizeStrategyComparison(rows);
const generatedMirofishAgentPerformance = buildMirofishAgentPerformance(rows);
const outStem = `screen_results/backtest_monthly_recommendations_${MARKET}_${START_MONTH}_${END_MONTH}`;
await mkdir("screen_results", { recursive: true });
await writeFile(
  `${outStem}.json`,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      range: {
        endMonth: END_MONTH,
        fetchEndDate: FETCH_END_DATE,
        fetchStartDate: FETCH_START_DATE,
        months: MONTHS,
        startMonth: START_MONTH,
      },
      assumptions: [
        "Universe membership and market-cap filtering use currently available public metadata, so delisted names and exact historical market caps are not fully reconstructed.",
        "Forward returns are based on available daily price history after each signal date and exclude rows where the full horizon is unavailable.",
        "Domestic relative strength uses each listing market benchmark, KOSPI or KOSDAQ. U.S. relative strength uses QQQ.",
        "Fundamental enrichment is not used in this historical screen because full point-in-time consensus data is not available.",
        "Strategy comparison keeps the same technical candidate logic and compares the original setupScore gate/rank against the MiroFish-adjusted setup score.",
        "MiroFish agent performance is generated from this backtest and can be applied to later recommendation refreshes.",
      ],
      config: {
        krMinimumMarketCapKrw: KR_MIN_MARKET_CAP_KRW,
        usMinimumMarketCapKrw: US_MIN_MARKET_CAP_KRW,
        minObservationMfi: MIN_OBSERVATION_MFI,
        minObservationRecentVolumeRatio: MIN_OBSERVATION_RECENT_VOLUME_RATIO,
        minObservationRelativeReturn: MIN_OBSERVATION_RELATIVE_RETURN,
        minObservationReturn: MIN_OBSERVATION_RETURN,
        minObservationVolumeRatio: MIN_OBSERVATION_VOLUME_RATIO,
        minConfirmedRecentVolumeRatio: MIN_RECENT_VOLUME_RATIO,
        maxConfirmedRollingReturn: MAX_CONFIRMED_ROLLING_RETURN,
        minConfirmedSetupScore: MIN_CONFIRMED_SETUP_SCORE,
        maxConfirmedHighDrawdown: -MAX_CONFIRMED_HIGH_DRAWDOWN,
        minKrConfirmedMfi: MIN_KR_CONFIRMED_MFI,
        minKrConfirmedRelativeReturn: MIN_KR_CONFIRMED_RELATIVE_RETURN,
        minKrConfirmedVolumeRatio: MIN_KR_CONFIRMED_VOLUME_RATIO,
        minKrKospiConfirmedRelativeReturn: MIN_KR_KOSPI_CONFIRMED_RELATIVE_RETURN,
        minKrKospiConfirmedVolumeRatio: MIN_KR_KOSPI_CONFIRMED_VOLUME_RATIO,
        minHighConfidenceRelativeReturn: MIN_HIGH_CONFIDENCE_RELATIVE_RETURN,
        minHighConfidenceVolumeRatio: MIN_HIGH_CONFIDENCE_VOLUME_RATIO,
        maxHighConfidenceDrawdown: -MAX_HIGH_CONFIDENCE_DRAWDOWN,
        overheatMfi: OVERHEAT_MFI,
        overheatReturn: OVERHEAT_RETURN,
        weakMarketReturn: WEAK_MARKET_RETURN,
      },
      mirofishAgentPerformance: {
        applied: mirofishAgentPerformance,
        generated: generatedMirofishAgentPerformance,
      },
      summary,
      strategyComparison,
      rows,
    },
    null,
    2,
  )}\n`,
);
await writeFile(`${outStem}.csv`, toCsv(rows));
await writeFile(
  "screen_results/mirofish_agent_performance.json",
  `${JSON.stringify(generatedMirofishAgentPerformance, null, 2)}\n`,
);
printSummary(summary, outStem, strategyComparison);

async function runKoreaBacktest() {
  console.error(`KR backtest ${START_MONTH}..${END_MONTH}`);
  const benchmarkRowsByMarket = Object.fromEntries(
    await Promise.all(
      Object.entries({
        KOSDAQ: { label: "KOSDAQ", symbol: "^KQ11" },
        KOSPI: { label: "KOSPI", symbol: "^KS11" },
      }).map(async ([marketType, source]) => [
        marketType,
        await fetchYahooDaily(source.symbol, FETCH_START_DATE, FETCH_END_DATE),
      ]),
    ),
  );
  const mirofishContext = createMirofishContext(
    await fetchMirofishMarketHistories({
      kosdaq: benchmarkRowsByMarket.KOSDAQ,
      kospi: benchmarkRowsByMarket.KOSPI,
    }),
  );
  const rawUniverse = (await fetchKrxUniverse()).map((stock, universeIndex) => ({
    ...stock,
    universeIndex,
  }));
  const sourceUniverse = rawUniverse.slice(0, LIMIT || undefined);
  const universe = [];
  await runPool(sourceUniverse, CONCURRENCY, async (stock, index) => {
    const marketCapKrw = await fetchNaverMarketCapKrw(stock).catch(() => NaN);
    if (marketCapKrw >= KR_MIN_MARKET_CAP_KRW) {
      universe.push({ ...stock, marketCapKrw });
    }
    reportProgress("KR marketcap", index + 1, sourceUniverse.length);
  });
  universe.sort((a, b) => a.universeIndex - b.universeIndex);
  console.error(`KR universe ${universe.length}/${sourceUniverse.length}`);

  const out = [];
  await runPool(universe, CONCURRENCY, async (stock, index) => {
    const priceRows = await fetchNaverDaily(stock.code, 1000).catch(() => []);
    for (const month of MONTHS) {
      const item = screenStock({
        benchmarkLabel: stock.marketType,
        benchmarkRows: benchmarkRowsByMarket[stock.marketType],
        market: "kr",
        mirofishContext,
        month,
        rows: priceRows,
        stock,
      });
      if (item) out.push(item);
    }
    reportProgress("KR prices", index + 1, universe.length);
  });
  return out;
}

async function runUsBacktest() {
  console.error(`US backtest ${START_MONTH}..${END_MONTH}`);
  const usdKrw = await fetchUsdKrw();
  const minimumMarketCapUsd = US_MIN_MARKET_CAP_KRW / usdKrw;
  const benchmarkRows = await fetchYahooDaily("QQQ", FETCH_START_DATE, FETCH_END_DATE);
  const mirofishContext = createMirofishContext(
    await fetchMirofishMarketHistories({
      qqq: benchmarkRows,
    }),
  );
  const universeInfo = await fetchUsUniverse({ minimumMarketCapUsd });
  const universe = universeInfo.universe.slice(0, LIMIT || undefined);
  console.error(`US universe ${universe.length}/${universeInfo.rawCount}`);

  const out = [];
  await runPool(universe, CONCURRENCY, async (stock, index) => {
    const priceRows = await fetchNasdaqDaily(stock).catch(() => []);
    const marketCapUsd = Number.isFinite(stock.marketCapUsd)
      ? stock.marketCapUsd
      : NaN;
    if (marketCapUsd < minimumMarketCapUsd) return;
    const baseStock = {
      ...stock,
      marketCapKrw: Math.round(marketCapUsd * usdKrw),
      marketCapUsd: Math.round(marketCapUsd),
    };
    for (const month of MONTHS) {
      const item = screenStock({
        benchmarkLabel: "QQQ",
        benchmarkRows,
        market: "us",
        mirofishContext,
        month,
        rows: priceRows,
        stock: baseStock,
      });
      if (item) out.push(item);
    }
    reportProgress("US prices", index + 1, universe.length);
  });
  return out;
}

function screenStock({ benchmarkLabel, benchmarkRows, market, mirofishContext, month, rows, stock }) {
  const sortedRows = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const targetIndex = latestIndexInMonth(sortedRows, month);
  if (targetIndex < 0 || targetIndex + 1 < MIN_HISTORY_DAYS) return null;

  const current = sortedRows[targetIndex];
  const previousTradingDay = sortedRows[targetIndex - 1];
  const rowsUntilTarget = sortedRows.slice(0, targetIndex + 1);
  const volumeStats = rollingVolumeStats(
    sortedRows,
    targetIndex,
    ROLLING_WINDOW_DAYS,
    COMPARE_MONTHS,
  );
  if (!volumeStats) return null;
  const recentVolumeRatio = recentAverageVolumeRatio(
    sortedRows,
    targetIndex,
    RECENT_VOLUME_DAYS,
    ROLLING_WINDOW_DAYS * COMPARE_MONTHS,
  );
  if (!Number.isFinite(recentVolumeRatio)) return null;

  const returnBase = sortedRows[targetIndex - ROLLING_WINDOW_DAYS];
  const targetReturn = percentChange(current.close, returnBase?.close);
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
  const mirofishSimulation = mirofishContext?.simulationForDate(current.date);
  const mirofishFit = scoreRecommendationWithMirofish(
    {
      ...stock,
      industry: stock.industry,
      name: stock.name,
      sector: stock.sector,
    },
    {
      baseMarket: market === "kr" ? "domestic" : "us",
      simulation: mirofishSimulation,
    },
  );
  const mirofishAdjustedScore = applyMirofishSetupScore(setupScore, mirofishFit);
  const recentWorstDailyReturn = worstRecentDailyReturn(rowsUntilTarget, 5);
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
  const eventPriceLockRisk =
    market === "us" &&
    recommendationEventPriceLockRisk({
      monthHighDrawdown,
      recentVolumeRatio,
      recentWorstDailyReturn,
      targetReturn,
      volumeRatio: volumeStats.volumeRatio,
    });
  const speculativeBiotechRisk = market === "us" && usSpeculativeBiotechRisk(stock);
  const weakMarketRegime = recommendationWeakMarketRegime({
    benchmarkReturn,
    breakout,
    market,
    relativeReturn,
    targetReturn,
  });
  const domesticConfirmationReady =
    market !== "kr" ||
    (volumeStats.volumeRatio >= MIN_KR_CONFIRMED_VOLUME_RATIO &&
      relativeReturn >= MIN_KR_CONFIRMED_RELATIVE_RETURN &&
      mfi >= MIN_KR_CONFIRMED_MFI &&
      (stock.marketType !== "KOSPI" ||
        (volumeStats.volumeRatio >= MIN_KR_KOSPI_CONFIRMED_VOLUME_RATIO &&
          relativeReturn >= MIN_KR_KOSPI_CONFIRMED_RELATIVE_RETURN)));
  const passesBaseline = setupScore >= MIN_SETUP_SCORE;
  const passesMirofish = mirofishAdjustedScore >= MIN_SETUP_SCORE;

  if (
    (!passesBaseline && !passesMirofish) ||
    (!confirmedCandidate && !observationCandidate && !earlyObservationCandidate)
  ) {
    return null;
  }

  const baselineConfirmationReady =
    confirmedCandidate &&
    targetReturn <= MAX_CONFIRMED_ROLLING_RETURN &&
    setupScore >= MIN_CONFIRMED_SETUP_SCORE &&
    monthHighDrawdown > -MAX_CONFIRMED_HIGH_DRAWDOWN &&
    domesticConfirmationReady &&
    !mfiReversalRisk &&
    !eventPriceLockRisk &&
    !speculativeBiotechRisk &&
    !overheatRisk &&
    !weakMarketRegime;
  const mirofishConfirmationReady =
    confirmedCandidate &&
    targetReturn <= MAX_CONFIRMED_ROLLING_RETURN &&
    mirofishAdjustedScore >= MIN_CONFIRMED_SETUP_SCORE &&
    monthHighDrawdown > -MAX_CONFIRMED_HIGH_DRAWDOWN &&
    domesticConfirmationReady &&
    !mfiReversalRisk &&
    !eventPriceLockRisk &&
    !speculativeBiotechRisk &&
    !overheatRisk &&
    !weakMarketRegime &&
    (!mirofishFit || mirofishFit.score > -0.35);
  const legacyRecommendationStage = baselineConfirmationReady
    ? "confirmed"
    : confirmedCandidate || observationCandidate
      ? "watch"
      : "observe";
  const baselineStage = !passesBaseline ? "filtered" : legacyRecommendationStage;
  const mirofishStage = !passesMirofish
    ? "filtered"
    : mirofishConfirmationReady
      ? "confirmed"
      : confirmedCandidate || observationCandidate
        ? "watch"
        : "observe";
  const recommendationStage = mirofishStage;
  const confirmationReady = mirofishConfirmationReady;
  const highConfidenceCandidate =
    confirmationReady &&
    ((volumeStats.volumeRatio >= MIN_HIGH_CONFIDENCE_VOLUME_RATIO &&
      relativeReturn >= MIN_HIGH_CONFIDENCE_RELATIVE_RETURN) ||
      monthHighDrawdown >= -MAX_HIGH_CONFIDENCE_DRAWDOWN);
  const benchmarkIndex = latestIndexAtOrBefore(benchmarkRows || [], current.date);
  const forward = Object.fromEntries(
    HORIZONS.flatMap((horizon) => {
      const value = forwardTradingDayReturn(sortedRows, targetIndex, horizon.days);
      const benchmarkValue = forwardTradingDayReturn(
        benchmarkRows || [],
        benchmarkIndex,
        horizon.days,
      );
      return [
        [horizon.key, round(value, 2)],
        [`${horizon.key}Benchmark`, round(benchmarkValue, 2)],
        [`${horizon.key}Excess`, round(value - benchmarkValue, 2)],
      ];
    }),
  );

  return {
    aboveTenDayAverage,
    benchmark: benchmarkLabel,
    benchmarkReturn: round(benchmarkReturn, 2),
    baselineStage,
    breakout,
    confidenceRank: highConfidenceCandidate ? 2 : confirmationReady ? 1 : 0,
    confidenceTier: highConfidenceCandidate ? "high" : confirmationReady ? "standard" : "",
    code: stock.code || "",
    exchange: stock.exchange || "",
    eventPriceLockRisk: Boolean(eventPriceLockRisk),
    lastClose: round(current.close, 4),
    lastDate: current.date,
    market,
    marketCapKrw: stock.marketCapKrw || null,
    marketCapUsd: stock.marketCapUsd || null,
    marketType: stock.marketType || stock.exchange || "",
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
    mirofishStage,
    mirofishTone: mirofishFit?.tone || "",
    month,
    monthHighDrawdown: round(monthHighDrawdown, 2),
    monthlyReturn: round(targetReturn, 2),
    name: stock.name,
    previousDayClose: round(previousTradingDay?.close, 4),
    passesBaseline,
    passesMirofish,
    recentVolumeRatio: round(recentVolumeRatio, 2),
    recentWorstDailyReturn: round(recentWorstDailyReturn, 2),
    legacyRecommendationStage,
    recommendationStage,
    relativeReturn: round(relativeReturn, 2),
    setupScore,
    symbol: stock.rawSymbol || stock.symbol,
    speculativeBiotechRisk: Boolean(speculativeBiotechRisk),
    weakMarketRegime,
    volumeRatio: round(volumeStats.volumeRatio, 2),
    ...forward,
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
  market,
  relativeReturn,
  targetReturn,
}) {
  const weakMarketReturn =
    market === "kr" ? KR_WEAK_MARKET_RETURN : WEAK_MARKET_RETURN;
  if (!Number.isFinite(benchmarkReturn) || benchmarkReturn >= weakMarketReturn) {
    return false;
  }
  return !(
    breakout &&
    relativeReturn >= WEAK_MARKET_OVERRIDE_RELATIVE_RETURN &&
    targetReturn >= WEAK_MARKET_OVERRIDE_RETURN
  );
}

function summarizeRows(items) {
  const groups = [
    ["전체", items],
    ...groupEntries(items, (item) => item.market).map(([key, value]) => [key, value]),
    ...groupEntries(items, (item) => `${item.market}:${item.recommendationStage}`).map(
      ([key, value]) => [key, value],
    ),
  ];
  return Object.fromEntries(
    groups.map(([key, groupRows]) => [
      key,
      {
        count: groupRows.length,
        horizons: Object.fromEntries(HORIZONS.map((horizon) => [horizon.label, summarizeHorizon(groupRows, horizon.key)])),
        monthCounts: Object.fromEntries(
          groupEntries(groupRows, (item) => item.month).map(([month, monthRows]) => [
            month,
            monthRows.length,
          ]),
        ),
      },
    ]),
  );
}

function summarizeStrategyComparison(items) {
  const variants = {
    baseline: {
      label: "기존 setupScore",
      passKey: "passesBaseline",
      scoreKey: "setupScore",
      stageKey: "baselineStage",
    },
    mirofish: {
      label: "MiroFish 보정",
      passKey: "passesMirofish",
      scoreKey: "mirofishAdjustedScore",
      stageKey: "mirofishStage",
    },
  };
  const scopes = {
    all: (variant) => items.filter((item) => item[variant.passKey]),
    confirmed: (variant) =>
      items.filter((item) => item[variant.passKey] && item[variant.stageKey] === "confirmed"),
    highConfidence: (variant) =>
      items.filter(
        (item) =>
          item[variant.passKey] &&
          item[variant.stageKey] === "confirmed" &&
          item.confidenceTier === "high",
      ),
    top5Monthly: (variant) => topNByMonthAndMarket(items, variant),
  };
  return Object.fromEntries(
    Object.entries(scopes).map(([scopeKey, scopeRows]) => [
      scopeKey,
      compareStrategyScope(variants, scopeRows),
    ]),
  );
}

function compareStrategyScope(variants, scopeRows) {
  const entries = Object.entries(variants).map(([key, variant]) => [
    key,
    summarizeStrategyRows(scopeRows(variant)),
  ]);
  const result = Object.fromEntries(entries);
  result.delta = {
    count: result.mirofish.count - result.baseline.count,
    oneMonthAverage: metricDiff(
      result.mirofish.horizons["1개월"].average,
      result.baseline.horizons["1개월"].average,
    ),
    oneMonthAverageExcess: metricDiff(
      result.mirofish.horizons["1개월"].averageExcess,
      result.baseline.horizons["1개월"].averageExcess,
    ),
    oneMonthHitRate: metricDiff(
      result.mirofish.horizons["1개월"].hitRate,
      result.baseline.horizons["1개월"].hitRate,
      1,
    ),
  };
  return result;
}

function summarizeStrategyRows(items) {
  return {
    count: items.length,
    horizons: Object.fromEntries(
      HORIZONS.map((horizon) => [horizon.label, summarizeHorizon(items, horizon.key)]),
    ),
    marketCounts: Object.fromEntries(
      groupEntries(items, (item) => item.market).map(([market, marketRows]) => [
        market,
        marketRows.length,
      ]),
    ),
  };
}

function topNByMonthAndMarket(items, variant, limit = 5) {
  const selected = [];
  for (const [, groupRows] of groupEntries(
    items.filter((item) => item[variant.passKey]),
    (item) => `${item.market}:${item.month}`,
  )) {
    selected.push(
      ...groupRows
        .slice()
        .sort(
          (a, b) =>
            Number(b[variant.scoreKey] || 0) - Number(a[variant.scoreKey] || 0) ||
            Number(b.relativeReturn || 0) - Number(a.relativeReturn || 0) ||
            Number(b.monthlyReturn || 0) - Number(a.monthlyReturn || 0),
        )
        .slice(0, limit),
    );
  }
  return selected;
}

function summarizeHorizon(items, key) {
  const rows = items.filter((item) => Number.isFinite(item[key]));
  const values = rows.map((item) => item[key]);
  const excessValues = rows
    .map((item) => item[`${key}Excess`])
    .filter(Number.isFinite);
  return {
    average: round(average(values), 2),
    averageExcess: round(average(excessValues), 2),
    hitRate: round((values.filter((value) => value > 0).length / values.length) * 100, 1),
    median: round(median(values), 2),
    sample: rows.length,
  };
}

function metricDiff(current, previous, digits = 2) {
  return Number.isFinite(current) && Number.isFinite(previous)
    ? round(current - previous, digits)
    : null;
}

function printSummary(summary, outStem, strategyComparison) {
  console.log(`saved ${outStem}.json`);
  for (const [group, data] of Object.entries(summary)) {
    const oneMonth = data.horizons["1개월"];
    const threeMonth = data.horizons["3개월"];
    console.log(
      `${group}: n=${data.count}, 1m avg=${formatPercent(oneMonth.average)} hit=${formatPercent(oneMonth.hitRate)} excess=${formatPercent(oneMonth.averageExcess)}, 3m avg=${formatPercent(threeMonth.average)} hit=${formatPercent(threeMonth.hitRate)}`,
    );
  }
  console.log("strategy comparison:");
  for (const [scope, data] of Object.entries(strategyComparison)) {
    const baseline = data.baseline.horizons["1개월"];
    const mirofish = data.mirofish.horizons["1개월"];
    console.log(
      `${scope}: baseline n=${data.baseline.count} avg=${formatPercent(baseline.average)} hit=${formatPercent(baseline.hitRate)} excess=${formatPercent(baseline.averageExcess)} | mirofish n=${data.mirofish.count} avg=${formatPercent(mirofish.average)} hit=${formatPercent(mirofish.hitRate)} excess=${formatPercent(mirofish.averageExcess)} | delta avg=${formatPercent(data.delta.oneMonthAverage)} hit=${formatPercent(data.delta.oneMonthHitRate)} excess=${formatPercent(data.delta.oneMonthAverageExcess)}`,
    );
  }
}

async function fetchKrxUniverse() {
  const response = await fetch(
    "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13",
    {
      headers: {
        Accept: "application/vnd.ms-excel,text/html,*/*",
        "User-Agent": "Mozilla/5.0",
      },
    },
  );
  if (!response.ok) throw new Error(`KRX universe unavailable: ${response.status}`);
  const html = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].slice(1);
  return rows
    .map((row) => {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
        cleanHtml(cell[1]),
      );
      const [name, market, code] = cells;
      const marketType = market?.includes("코스닥")
        ? "KOSDAQ"
        : market?.includes("유가")
          ? "KOSPI"
          : "";
      const suffix =
        marketType === "KOSDAQ" ? "KQ" : marketType === "KOSPI" ? "KS" : "";
      if (!name || !/^\d{6}$/.test(code || "") || !suffix) return null;
      return { code, market, marketType, name, symbol: `${code}.${suffix}` };
    })
    .filter(Boolean);
}

async function fetchNaverMarketCapKrw(stock) {
  const json = await fetchJson(
    `https://m.stock.naver.com/api/stock/${encodeURIComponent(stock.code)}/integration`,
  );
  const item = (json.totalInfos || []).find((info) => info.code === "marketValue");
  const value = parseKoreanMarketCap(item?.value);
  if (!Number.isFinite(value)) throw new Error(`market cap unavailable: ${stock.code}`);
  return value;
}

async function fetchNaverDaily(code, count = 430) {
  const response = await fetch(
    `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,
    {
      headers: {
        Accept: "application/xml,text/xml,text/plain,*/*",
        "User-Agent": "Mozilla/5.0",
      },
    },
  );
  if (!response.ok) throw new Error(`Naver chart unavailable: ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item data="([^"]+)"/g)]
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
    .filter(validDailyRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchUsdKrw() {
  const rows = await fetchYahooDaily("KRW=X", shiftMonth(END_MONTH, -1) + "-01", FETCH_END_DATE);
  const latest = rows.at(-1)?.close;
  if (!Number.isFinite(latest)) throw new Error("USD/KRW unavailable");
  return latest;
}

async function fetchUsUniverse({ minimumMarketCapUsd }) {
  const [nasdaqText, otherText, screenerRows] = await Promise.all([
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"),
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"),
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
      rawSymbol: row.Symbol,
      symbol: normalizeNasdaqSymbol(row.Symbol),
      etf: row.ETF,
      testIssue: row["Test Issue"],
    }));
  const other = parsePipeTable(otherText)
    .filter((row) => row["ACT Symbol"] && row["ACT Symbol"] !== "File Creation Time")
    .map((row) => ({
      exchange: exchangeName(row.Exchange),
      name: row["Security Name"],
      rawSymbol: row["ACT Symbol"],
      symbol: normalizeNasdaqSymbol(row["NASDAQ Symbol"] || row["ACT Symbol"]),
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
        industry: screener?.industry || "",
        marketCapUsd: finiteNumber(screener?.marketCapUsd),
        name: screener?.name || stock.name,
        sector: screener?.sector || "",
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    marketCapCoverageCount: all.filter((stock) => Number.isFinite(stock.marketCapUsd)).length,
    rawCount: all.length,
    universe: all.filter((stock) => stock.marketCapUsd >= minimumMarketCapUsd),
  };
}

async function fetchNasdaqScreenerStocks() {
  const json = await fetchJson(
    "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true",
    nasdaqHeaders(),
  );
  return (json.data?.rows || [])
    .map((row) => ({
      industry: row.industry || "",
      marketCapUsd: parseNasdaqNumber(row.marketCap),
      name: row.name || "",
      sector: row.sector || "",
      symbol: normalizeNasdaqSymbol(row.symbol),
    }))
    .filter((row) => row.symbol);
}

async function fetchNasdaqDaily(stock) {
  const json = await fetchJson(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(
      stock.symbol,
    )}/historical?assetclass=stocks&fromdate=${FETCH_START_DATE}&todate=${FETCH_END_DATE}&limit=9999`,
    nasdaqHeaders(),
  ).catch((error) => {
    console.error(
      `Nasdaq historical unavailable for ${stock.symbol}: ${error.message}; falling back to Yahoo`,
    );
    return null;
  });
  if (!json) return fetchYahooDaily(stock.symbol, FETCH_START_DATE, FETCH_END_DATE);
  const rows = (json.data?.tradesTable?.rows || [])
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
  return rows.length ? rows : fetchYahooDaily(stock.symbol, FETCH_START_DATE, FETCH_END_DATE);
}

async function fetchYahooDaily(symbol, startDate, endDate) {
  const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${endDate}T23:59:59Z`) / 1000);
  const json = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?period1=${period1}&period2=${period2}&interval=1d`,
  );
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  return (result?.timestamp || [])
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
      await fetchYahooDaily(symbol, FETCH_START_DATE, FETCH_END_DATE),
    ]),
  );
  for (const result of settled) {
    if (result.status === "fulfilled") {
      const [id, historyRows] = result.value;
      histories[id] = historyRows;
    } else {
      console.error(`mirofish market series unavailable: ${result.reason.message}`);
    }
  }
  return histories;
}

function createMirofishContext(histories) {
  const simulationByDate = new Map();
  return {
    simulationForDate(date) {
      if (!date) return null;
      if (!simulationByDate.has(date)) {
        simulationByDate.set(
          date,
          buildMirofishSimulationFromHistories(histories, date, {
            agentPerformance: mirofishAgentPerformance,
          }),
        );
      }
      return simulationByDate.get(date);
    },
  };
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, "application/json,text/plain,*/*", headers);
  return JSON.parse(text);
}

async function fetchText(url, accept = "text/plain,*/*", headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "Mozilla/5.0",
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
  return response.text();
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
  const previousVolumes = Array.from({ length: comparisonCount }, (_, index) =>
    sum(previousRows.slice(index * windowDays, index * windowDays + windowDays).map((row) => row.volume)),
  );
  const previousAverageVolume = average(previousVolumes);
  return previousAverageVolume > 0
    ? { previousAverageVolume, recentVolume, volumeRatio: recentVolume / previousAverageVolume }
    : null;
}

function recentAverageVolumeRatio(rows, targetIndex, recentDays, previousDays) {
  const recentStart = targetIndex - recentDays + 1;
  const previousStart = recentStart - previousDays;
  if (previousStart < 0) return NaN;
  const recentRows = rows.slice(recentStart, targetIndex + 1);
  const previousRows = rows.slice(previousStart, recentStart);
  if (recentRows.length < recentDays || previousRows.length < previousDays) return NaN;
  return average(recentRows.map((row) => row.volume)) / average(previousRows.map((row) => row.volume));
}

function benchmarkRollingReturn(rows, targetDate, windowDays) {
  const targetIndex = latestIndexAtOrBefore(rows || [], targetDate);
  if (targetIndex < windowDays) return NaN;
  return percentChange(rows[targetIndex].close, rows[targetIndex - windowDays].close);
}

function forwardTradingDayReturn(rows, targetIndex, daysForward) {
  const target = rows?.[targetIndex + daysForward];
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
  const positive = sum(recent.map((flow) => flow.positive));
  const negative = sum(recent.map((flow) => flow.negative));
  if (negative === 0 && positive > 0) return 100;
  if (negative === 0) return 50;
  return 100 - 100 / (1 + positive / negative);
}

function monthRange(startMonth, endMonth) {
  const months = [];
  for (let month = startMonth; month <= endMonth; month = shiftMonth(month, 1)) {
    months.push(month);
  }
  return months;
}

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
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

function reportProgress(label, done, total) {
  if (done % 100 === 0 || done === total) console.error(`${label} ${done}/${total}`);
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

function isCommonEquity(stock) {
  if (stock.etf === "Y" || stock.testIssue === "Y") return false;
  const name = stock.name.toLowerCase();
  if (stock.symbol.includes("^") || /[+*=]/.test(stock.symbol)) return false;
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

function parseKoreanMarketCap(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  const trillion = Number.parseFloat(text.match(/(-?\d+(?:\.\d+)?)\s*조/)?.[1] || "0");
  const hundredMillion = Number.parseFloat(text.match(/(-?\d+(?:\.\d+)?)\s*억/)?.[1] || "0");
  const total = trillion * 1_000_000_000_000 + hundredMillion * 100_000_000;
  if (total > 0) return total;
  return parseKoreanNumber(text);
}

function parseKoreanNumber(value) {
  const number = Number(String(value || "").replace(/[,\s]/g, ""));
  return Number.isFinite(number) ? number : NaN;
}

function parseNasdaqNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value || "").replace(/[$,%\s,]/g, "").trim();
  if (!text || text.toUpperCase() === "N/A") return NaN;
  return Number(text);
}

function normalizeNasdaqSymbol(symbol) {
  return String(symbol || "").trim();
}

function exchangeName(code) {
  return { A: "NYSE American", N: "NYSE", P: "NYSE Arca", Z: "Cboe BZX", V: "IEX" }[code] || code;
}

function nasdaqHeaders() {
  return {
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Origin: "https://www.nasdaq.com",
    Referer: "https://www.nasdaq.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
}

function toIsoDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function cleanHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
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

function groupEntries(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function toCsv(items) {
  const headers = [
    "market",
    "month",
    "lastDate",
    "recommendationStage",
    "legacyRecommendationStage",
    "baselineStage",
    "mirofishStage",
    "confidenceTier",
    "confidenceRank",
    "symbol",
    "code",
    "name",
    "marketType",
    "setupScore",
    "mirofishAdjustedScore",
    "mirofishScore",
    "mirofishLabel",
    "mirofishBonus",
    "mirofishConfidence",
    "mirofishConsensusStrength",
    "mirofishDisagreement",
    "mirofishAgentScores",
    "passesBaseline",
    "passesMirofish",
    "monthlyReturn",
    "relativeReturn",
    "volumeRatio",
    "recentVolumeRatio",
    "mfi",
    "mfiReversalRisk",
    "monthHighDrawdown",
    "recentWorstDailyReturn",
    "eventPriceLockRisk",
    "speculativeBiotechRisk",
    "next1wReturn",
    "next1wReturnExcess",
    "next1mReturn",
    "next1mReturnExcess",
    "next3mReturn",
    "next3mReturnExcess",
    "next6mReturn",
    "next6mReturnExcess",
  ];
  return [
    headers.join(","),
    ...items.map((item) => headers.map((header) => csvEscape(item[header] ?? "")).join(",")),
  ].join("\n");
}

function csvEscape(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function typicalPrice(row) {
  return (row.high + row.low + row.close) / 3;
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return NaN;
  return ((current - previous) / previous) * 100;
}

function movingAverage(values, period) {
  const recent = values.filter(Number.isFinite).slice(-period);
  return recent.length === period ? average(recent) : NaN;
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

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return NaN;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}
