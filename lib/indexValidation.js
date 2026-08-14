const { rate, wilsonPercentInterval } = require("./statistics.js");

const INDEX_RULE_VERSION = "index-high-confidence-v1";
const PROSPECTIVE_START_DATE = "2026-08-14";

function highConfidenceDirection(row) {
  const components = row?.components || {};
  const score = Number(row?.score);
  const usMarket = Number(components["미국장"]);
  const nikkei = Number(components["니케이"]);
  const interestRate = Number(components["금리"]);
  const spFuture = Number(components["S&P선물"]);
  const vixTerm = Number(components["VIX구조"]);

  if (row?.indexId === "kospi") {
    if (usMarket >= 0.45) return "상승";
    if (spFuture <= -0.8 && vixTerm < 0.2) return "하락";
    if (interestRate <= -0.7) return "하락";
    if (nikkei <= -0.8 && vixTerm > -0.5) return "상승";
    if (score >= 0.35) return "상승";
  }
  if (row?.indexId === "nasdaq" || row?.indexId === "sp500") {
    if (vixTerm >= 0.35) return "상승";
    if (vixTerm <= 0) return "하락";
  }
  return null;
}

function summarizeRuleRows(rows) {
  const eligible = (rows || []).filter((row) => row?.date && row?.actualDirection);
  const signals = eligible
    .map((row) => ({ direction: highConfidenceDirection(row), row }))
    .filter((item) => item.direction);
  const hits = signals.filter(
    (item) => item.direction === item.row.actualDirection,
  ).length;
  const hitRate = rate(hits, signals.length);
  const interval = wilsonPercentInterval(hitRate, signals.length);
  return {
    coverage: rate(signals.length, eligible.length),
    hitRate,
    hitRateLower: interval?.lower ?? null,
    hitRateUpper: interval?.upper ?? null,
    observations: signals.length,
    totalRows: eligible.length,
  };
}

function summarizeIndexValidation(rows) {
  const eligible = (rows || []).filter((row) => row?.date && row?.indexId);
  const years = [...new Set(eligible.map((row) => row.date.slice(0, 4)))].sort();
  const indexIds = [...new Set(eligible.map((row) => row.indexId))].sort();
  const yearly = years.map((year) => ({
    ...summarizeRuleRows(eligible.filter((row) => row.date.startsWith(year))),
    isPartial: year === years.at(-1) && !eligible.some((row) => row.date.startsWith(`${year}-12`)),
    year,
  }));
  const byIndex = Object.fromEntries(
    indexIds.map((indexId) => {
      const indexYearly = years.map((year) => ({
        ...summarizeRuleRows(
          eligible.filter(
            (row) => row.indexId === indexId && row.date.startsWith(year),
          ),
        ),
        isPartial:
          year === years.at(-1) &&
          !eligible.some(
            (row) => row.indexId === indexId && row.date.startsWith(`${year}-12`),
          ),
        year,
      }));
      return [indexId, {
        overall: summarizeRuleRows(eligible.filter((row) => row.indexId === indexId)),
        worstYearHitRate: minimumFinite(indexYearly.map((item) => item.hitRate)),
        yearly: indexYearly,
      }];
    }),
  );

  return {
    assessment: "retrospective-only",
    byIndex,
    independentPerformanceReady: false,
    methodology: "fixed-rule historical replay",
    prospective: {
      performanceReady: false,
      startDate: PROSPECTIVE_START_DATE,
      status: "collecting",
    },
    ruleVersion: INDEX_RULE_VERSION,
    warning:
      "규칙 확정 전 기간을 포함한 회고검증이며 독립 전향 성과가 아닙니다.",
    worstYearHitRate: minimumFinite(yearly.map((item) => item.hitRate)),
    yearly,
  };
}

function minimumFinite(values) {
  const finite = (values || []).map(Number).filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

module.exports = {
  highConfidenceDirection,
  summarizeIndexValidation,
  summarizeRuleRows,
};
