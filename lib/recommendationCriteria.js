const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CRITERIA_PATH = path.join(__dirname, "..", "recommendation-criteria.json");
let cachedCriteria = null;

function loadRecommendationCriteria(filePath = DEFAULT_CRITERIA_PATH) {
  if (cachedCriteria && filePath === DEFAULT_CRITERIA_PATH) return cachedCriteria;
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (filePath === DEFAULT_CRITERIA_PATH) cachedCriteria = payload;
  return payload;
}

function criteriaValue(criteria, key, fallback) {
  const source = criteria || loadRecommendationCriteria();
  const value = String(key)
    .split(".")
    .reduce((current, part) => (current == null ? undefined : current[part]), source);
  return value ?? fallback;
}

function criteriaNumber(criteria, key, fallback) {
  const number = Number(criteriaValue(criteria, key, fallback));
  return Number.isFinite(number) ? number : fallback;
}

function criteriaString(criteria, key, fallback) {
  const value = criteriaValue(criteria, key, fallback);
  return value == null ? fallback : String(value);
}

function criteriaMarketCap(criteria, market, fallback) {
  return criteriaNumber(criteria, `minimumMarketCapKrw.${market}`, fallback);
}

function criteriaMinimumHistoryDays(criteria) {
  const comparisonMonthCount = criteriaNumber(criteria, "comparisonMonthCount", 5);
  const rollingWindowDays = criteriaNumber(criteria, "rollingWindowDays", 21);
  return rollingWindowDays * (comparisonMonthCount + 1) + 1;
}

function buildStockRecommendationCondition(
  criteria = loadRecommendationCriteria(),
  minimumMarketCapKrw,
  {
    domesticTightConfirmation = false,
    marketFilter,
    minimumMarketCapUsd,
    relativeBenchmark = "own market benchmark",
  } = {},
) {
  const hasMarketCap =
    Number.isFinite(Number(minimumMarketCapKrw)) && Number(minimumMarketCapKrw) > 0;
  const rollingWindowDays = criteriaNumber(criteria, "rollingWindowDays", 21);
  const comparisonMonthCount = criteriaNumber(criteria, "comparisonMonthCount", 5);
  const recentVolumeDays = criteriaNumber(criteria, "recentVolumeDays", 5);
  const movingAverageDays = criteriaNumber(criteria, "movingAverageDays", 10);
  const maxRollingHighDrawdown = criteriaNumber(criteria, "maxRollingHighDrawdown", 20);
  const maxConfirmedHighDrawdown = criteriaNumber(criteria, "maxConfirmedHighDrawdown", 10);
  const maxConfirmedRollingReturn = criteriaNumber(
    criteria,
    "maxConfirmedRollingReturn",
    80,
  );
  const maxConfirmedMfi = criteriaNumber(criteria, "maxConfirmedMfi", 90);
  const maxObservationHighDrawdown = criteriaNumber(
    criteria,
    "observationMaxHighDrawdown",
    5,
  );
  const highConfidenceVolumeRatio = criteriaNumber(
    criteria,
    "highConfidenceVolumeRatio",
    2.2,
  );
  const highConfidenceRelativeReturn = criteriaNumber(
    criteria,
    "highConfidenceRelativeReturn",
    40,
  );
  const highConfidenceMaxHighDrawdown = criteriaNumber(
    criteria,
    "highConfidenceMaxHighDrawdown",
    3,
  );

  return {
    breakout: `latest close reaches recent ${rollingWindowDays}-trading-day closing high`,
    dailyMfi: `>= ${criteriaNumber(criteria, "mfi", 80)}`,
    earlyWatch:
      `${rollingWindowDays}-day return >= ${criteriaNumber(criteria, "watchReturn", 60)}%, ` +
      `relative return >= ${criteriaNumber(criteria, "observationRelativeReturn", 40)}%p, ` +
      `${rollingWindowDays}-day volume >= ${criteriaNumber(criteria, "watchVolumeRatio", 1.2)}x, ` +
      `${recentVolumeDays}-day average volume >= ${criteriaNumber(criteria, "observationRecentVolumeRatio", 1.5)}x, ` +
      `MFI >= ${criteriaNumber(criteria, "watchMfi", 75)}, within -${maxObservationHighDrawdown}% from the ${rollingWindowDays}-day high, and above the ${movingAverageDays}-day average`,
    observation:
      `${rollingWindowDays}-day return >= ${criteriaNumber(criteria, "observationReturn", 60)}%, ` +
      `relative return >= ${criteriaNumber(criteria, "observationRelativeReturn", 40)}%p, ` +
      `MFI >= ${criteriaNumber(criteria, "observationMfi", 75)}, within -${maxObservationHighDrawdown}% from the ${rollingWindowDays}-day high, ` +
      `${rollingWindowDays}-day volume >= ${criteriaNumber(criteria, "observationVolumeRatio", 1.2)}x, ` +
      `${recentVolumeDays}-day volume >= ${criteriaNumber(criteria, "observationRecentVolumeRatio", 1.5)}x, and above the ${movingAverageDays}-day average`,
    invalidation:
      "exclude active picks if latest price is <= -8% from signal, below 10-day average, or <= -20% from recent 21-trading-day high",
    confirmationGuard:
      `confirmed picks require ${recentVolumeDays}-day volume >= ${criteriaNumber(criteria, "recentVolumeRatio", 1.8)}x, ` +
      `setup score >= ${criteriaNumber(criteria, "confirmedSetupScore", 75)}, ${rollingWindowDays}-day return <= ${maxConfirmedRollingReturn}%, ` +
      `high drawdown within -${maxConfirmedHighDrawdown}%, and no overheat, MFI reversal, or weak-market downgrade. ` +
      `MFI reversal means MFI >= ${maxConfirmedMfi} plus a fade from the recent high with renewed short-term volume`,
    ...(domesticTightConfirmation
      ? {
          domesticConfirmationGuard:
            `Korean confirmed picks additionally require ${rollingWindowDays}-day volume >= ${criteriaNumber(criteria, "domesticConfirmedVolumeRatio", 2)}x, ` +
            `relative return >= ${criteriaNumber(criteria, "domesticConfirmedRelativeReturn", 30)}%p, ` +
            `MFI >= ${criteriaNumber(criteria, "domesticConfirmedMfi", 88)}, and benchmark ${rollingWindowDays}-day return >= ${criteriaNumber(criteria, "weakMarketReturn.domestic", 0)}%. ` +
            `KOSPI confirmed picks additionally require ${rollingWindowDays}-day volume >= ${criteriaNumber(criteria, "domesticKospiConfirmedVolumeRatio", 2.2)}x and relative return >= ${criteriaNumber(criteria, "domesticKospiConfirmedRelativeReturn", 40)}%p`,
        }
      : {}),
    highConfidence:
      `high-confidence picks require either ${rollingWindowDays}-day volume >= ${highConfidenceVolumeRatio}x and relative return >= ${highConfidenceRelativeReturn}%p, ` +
      `or drawdown within -${highConfidenceMaxHighDrawdown}% from the ${rollingWindowDays}-day high`,
    fundamentalValidation:
      "enrich picks with revenue growth, profit growth, and forward PER when available; confirmed picks can be downgraded when support is weak, event-price-locked, or speculative biotech",
    mirofishAdjustment:
      "adjust setup score and final ordering with a MiroFish-style market/theme fit score; tailwinds raise priority and headwinds can downgrade confirmed picks to observation",
    ...(Array.isArray(marketFilter) && marketFilter.length ? { marketFilter } : {}),
    minimumHistoryDays: criteriaMinimumHistoryDays(criteria),
    ...(hasMarketCap ? { minimumMarketCapKrw } : {}),
    ...(Number.isFinite(Number(minimumMarketCapUsd))
      ? { minimumMarketCapUsd: Math.round(Number(minimumMarketCapUsd)) }
      : {}),
    monthHighDrawdown: `>= -${maxRollingHighDrawdown}% from recent ${rollingWindowDays}-trading-day high`,
    monthlyReturn: `>= ${criteriaNumber(criteria, "rollingReturn", 15)}% over recent ${rollingWindowDays} trading days`,
    recentVolumeRatio:
      `>= ${criteriaNumber(criteria, "recentVolumeRatio", 1.8)}x vs previous ${rollingWindowDays * comparisonMonthCount}-trading-day daily average`,
    relativeReturn: `>= ${criteriaNumber(criteria, "relativeReturn", 8)}% vs ${relativeBenchmark}`,
    setupScore: `>= ${criteriaNumber(criteria, "setupScore", 70)} overall, >= ${criteriaNumber(criteria, "confirmedSetupScore", 75)} for confirmed picks`,
    tenDayTrend: `close >= ${movingAverageDays}-day average for confirmed candidates`,
    volumeRatio: `>= ${criteriaNumber(criteria, "volumeRatio", 1.8)}x vs previous ${comparisonMonthCount} rolling ${rollingWindowDays}-trading-day averages`,
  };
}

module.exports = {
  buildStockRecommendationCondition,
  criteriaMarketCap,
  criteriaMinimumHistoryDays,
  criteriaNumber,
  criteriaString,
  loadRecommendationCriteria,
};
