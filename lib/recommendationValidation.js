const { average, median, rate, round, wilsonPercentInterval } = require("./statistics.js");

const MINIMUM_PROSPECTIVE_SAMPLES = 30;

function summarizeReturnRows(rows) {
  const signalRows = Array.isArray(rows) ? rows : [];
  const observed = signalRows.filter(
    (row) =>
      row?.next1mReturn !== null &&
      row?.next1mReturn !== undefined &&
      row?.next1mReturn !== "" &&
      Number.isFinite(Number(row.next1mReturn)),
  );
  const returns = observed.map((row) => Number(row.next1mReturn));
  const excessReturns = observed
    .map((row) => row.next1mReturnExcess)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);
  const hits = returns.filter((value) => value > 0).length;
  const hitRate = rate(hits, observed.length);
  const interval = wilsonPercentInterval(hitRate, observed.length);
  return {
    averageReturn: round(average(returns), 2),
    averageReturnExcess: round(average(excessReturns), 2),
    hitRate,
    hitRateLower: interval?.lower ?? null,
    hitRateUpper: interval?.upper ?? null,
    medianReturn: round(median(returns), 2),
    medianReturnExcess: round(median(excessReturns), 2),
    missingOutcomeCount: signalRows.length - observed.length,
    sampleAdequacy: observed.length >= MINIMUM_PROSPECTIVE_SAMPLES ? "directional" : "insufficient",
    sample: observed.length,
    signalCount: signalRows.length,
  };
}

function summarizeRecommendationValidation(payload, ledger = {}) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const retrospective = summarizeReturnRows(rows);
  const years = [...new Set(rows.map((row) => String(row?.month || "").slice(0, 4)).filter(Boolean))].sort();
  const timeSlices = years.map((year) => ({
    endMonth: maximum(rows.filter((row) => row.month?.startsWith(year)).map((row) => row.month)),
    metrics: summarizeReturnRows(rows.filter((row) => row.month?.startsWith(year))),
    startMonth: minimum(rows.filter((row) => row.month?.startsWith(year)).map((row) => row.month)),
    year,
  }));
  const prospectiveRows = (ledger?.cohorts || []).flatMap((cohort) =>
    (cohort.signals || []).map((signal) => ({
      ...signal,
      month: cohort.marketMonth,
      next1mReturn: signal.outcome?.return1m,
      next1mReturnExcess: signal.outcome?.return1mExcess,
    })),
  );
  const prospectiveMetrics = summarizeReturnRows(prospectiveRows);
  const policy = ledger?.policy || {};

  return {
    assessment:
      prospectiveMetrics.sample >= Number(policy.minimumMaturedSamples || MINIMUM_PROSPECTIVE_SAMPLES)
        ? "prospective-directional"
        : "collecting",
    dataQuality: {
      fundamentalsIncludedInHistoricalPerformance: false,
      fundamentalPointInTimeAvailable: false,
      marketCapHistoryReconstructed: false,
      outcomeCensoring:
        "전체 21거래일 수익률이 존재하는 신호만 성과 모수에 포함",
      survivorshipBiasRisk: true,
    },
    independentPerformanceReady:
      prospectiveMetrics.sample >= Number(policy.minimumMaturedSamples || MINIMUM_PROSPECTIVE_SAMPLES),
    prospective: {
      criteriaHash: policy.criteriaHash || "",
      frozenAt: policy.frozenAt || "",
      marketMonths: [...new Set((ledger?.cohorts || []).map((cohort) => cohort.marketMonth))].sort(),
      metrics: prospectiveMetrics,
      minimumMaturedSamples: Number(
        policy.minimumMaturedSamples || MINIMUM_PROSPECTIVE_SAMPLES,
      ),
      performanceReady:
        prospectiveMetrics.sample >= Number(
          policy.minimumMaturedSamples || MINIMUM_PROSPECTIVE_SAMPLES,
        ),
      startMonth: policy.startMonth || "",
      status:
        prospectiveMetrics.sample >= Number(
          policy.minimumMaturedSamples || MINIMUM_PROSPECTIVE_SAMPLES,
        )
          ? "directional"
          : "collecting",
    },
    retrospective: {
      metrics: retrospective,
      scope: "technical-screen-only",
      status: "retrospective-only",
      timeSlices,
    },
    warning:
      "과거 성과는 현행 기술 규칙을 이전 구간에 재적용한 회고검증입니다. 실적·컨센서스는 시점 자료가 없어 성과에 포함하지 않았습니다.",
  };
}

function minimum(values) {
  return (values || []).filter(Boolean).sort().at(0) || "";
}

function maximum(values) {
  return (values || []).filter(Boolean).sort().at(-1) || "";
}

module.exports = {
  summarizeRecommendationValidation,
  summarizeReturnRows,
};
