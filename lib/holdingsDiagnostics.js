const TRADING_DAYS = 252;
const INDIVIDUAL_TARGET_CAP = 0.15;
const REBALANCE_BAND = 0.015;
const RISK_TAGS = new Set([
  "ai",
  "aiInfra",
  "cybersecurity",
  "defense",
  "hbm",
  "nasdaq",
  "network",
  "power",
  "semi",
]);

function buildHoldingsDiagnostics(holdings, { now = new Date() } = {}) {
  const source = Array.isArray(holdings) ? holdings : [];
  if (!source.length) return emptyDiagnostics(now);

  const actualAmountReady = source.every(
    (holding) => holding.currentValueKrw !== null && Number.isFinite(Number(holding.currentValueKrw)),
  );
  const totalAmount = source.reduce(
    (sum, holding) => sum + Math.max(0, Number(holding.currentValueKrw) || 0),
    0,
  );
  const weightMode = actualAmountReady && totalAmount > 0 ? "actual" : "equal_assumption";
  const equalWeight = 1 / source.length;
  const currentWeights = source.map((holding) =>
    weightMode === "actual"
      ? Math.max(0, Number(holding.currentValueKrw) || 0) / totalAmount
      : equalWeight,
  );

  const analyzed = source.map((holding) => analyzeHoldingHistory(holding));
  const momentum12Ranks = centeredRanks(analyzed.map((item) => item.momentum12_1));
  const momentum6Ranks = centeredRanks(analyzed.map((item) => item.momentum6_1));
  const return63Ranks = centeredRanks(analyzed.map((item) => item.return63));
  const themeExposure = buildThemeExposure(source, currentWeights);
  const riskContributions = portfolioRiskContributions(analyzed, currentWeights);
  const validVolatility = analyzed
    .map((item) => item.volatility)
    .filter((value) => Number.isFinite(value) && value > 0);
  const fallbackVolatility = median(validVolatility) || 0.25;

  const scored = analyzed.map((item, index) => {
    const trendScore = item.trendScore ?? 0;
    const alphaScore = clamp(
      0.35 * momentum12Ranks[index] +
        0.25 * momentum6Ranks[index] +
        0.2 * return63Ranks[index] +
        0.2 * trendScore,
      -1,
      1,
    );
    const tags = Array.isArray(source[index].tags) ? source[index].tags : [];
    const crowdedTheme = tags
      .filter((tag) => RISK_TAGS.has(tag))
      .map((tag) => ({ tag, weight: themeExposure[tag] || 0 }))
      .sort((a, b) => b.weight - a.weight)[0] || null;
    const crowdingPenalty = crowdedTheme
      ? 1 / (1 + Math.max(0, crowdedTheme.weight - 0.35) * 2.5)
      : 1;
    const trendPenalty = item.belowMa200 ? 0.78 : 1;
    const drawdownPenalty = Number(item.maxDrawdown) < -0.25 ? 0.82 : 1;
    const volatility = item.volatility || fallbackVolatility;
    const targetRaw =
      (1 / Math.max(0.08, volatility)) *
      Math.exp(0.55 * alphaScore) *
      crowdingPenalty *
      trendPenalty *
      drawdownPenalty;
    return {
      ...item,
      alphaScore,
      crowdedTheme,
      riskContribution: riskContributions[index],
      targetRaw: item.pointCount >= 63 && source[index].code ? targetRaw : 0,
    };
  });

  const targetWeights = cappedNormalize(
    scored.map((item) => item.targetRaw),
    INDIVIDUAL_TARGET_CAP,
  );
  const items = scored.map((item, index) =>
    buildDiagnosticItem({
      currentWeight: currentWeights[index],
      holding: source[index],
      item,
      now,
      targetWeight: targetWeights[index],
      weightMode,
      universeSize: source.length,
    }),
  );
  const actionCounts = countBy(items, (item) => item.actionCode);
  const topTheme = Object.entries(themeExposure).sort((a, b) => b[1] - a[1])[0] || null;
  const missingAmountCount = source.filter((holding) => holding.currentValueKrw === null).length;
  const dataReadyCount = items.filter((item) => item.actionCode !== "pending").length;

  return {
    assessment: "conditional-risk-screen",
    generatedAt: now.toISOString(),
    modelVersion: "conditional-quant-v1.0",
    weightMode,
    totalAmountKrw: weightMode === "actual" ? totalAmount : null,
    missingAmountCount,
    dataReadyCount,
    count: items.length,
    summary: {
      expand: actionCounts.expand || 0,
      hold: actionCounts.hold || 0,
      trim: actionCounts.trim || 0,
      pending: actionCounts.pending || 0,
      topTheme: topTheme ? { tag: topTheme[0], weight: round(topTheme[1], 4) } : null,
    },
    methodology: {
      actionBandPercentagePoints: REBALANCE_BAND * 100,
      individualTargetCap: INDIVIDUAL_TARGET_CAP,
      momentum: "12-1개월 35% + 6-1개월 25% + 3개월 20%",
      trend: "50일·200일 이동평균 20%",
      riskBudget: "126일 변동성 역수, 공분산 50% 대각 축소, 테마 집중 페널티",
      exposureSource: "상품명·지수 프로필 기반 태그이며 구성종목 실시간 look-through가 아님",
    },
    limitations: [
      weightMode === "actual"
        ? "입력한 평가금액을 현재 비중으로 사용했습니다."
        : "모든 평가금액이 입력되지 않아 현재 비중은 동일비중으로 가정했습니다.",
      "세금·거래비용·계좌 목적·현금 수요를 반영하지 않은 조건부 위험 화면입니다.",
      "확대·축소 표시는 주문 지시가 아니라 추가 검토 우선순위입니다.",
    ],
    items,
  };
}

function analyzeHoldingHistory(holding) {
  const rows = (Array.isArray(holding.history) ? holding.history : [])
    .map((row) => ({ date: String(row.date || ""), close: Number(row.close ?? row.value) }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const closes = rows.map((row) => row.close);
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const latest = closes.at(-1);
  const ma50 = closes.length >= 50 ? average(closes.slice(-50)) : null;
  const ma200 = closes.length >= 200 ? average(closes.slice(-200)) : null;
  const above50 = Number.isFinite(latest) && Number.isFinite(ma50) ? latest >= ma50 : null;
  const above200 = Number.isFinite(latest) && Number.isFinite(ma200) ? latest >= ma200 : null;
  const trendScore = above200 === null
    ? above50 === null ? null : above50 ? 0.35 : -0.35
    : (above50 ? 0.35 : -0.35) + (above200 ? 0.65 : -0.65);
  return {
    pointCount: rows.length,
    latestDate: rows.at(-1)?.date || "",
    latestClose: latest || null,
    return21: trailingReturn(closes, 21),
    return63: trailingReturn(closes, 63),
    momentum6_1: skipMonthReturn(closes, 126),
    momentum12_1: skipMonthReturn(closes, 252),
    volatility: annualizedVolatility(returns.slice(-126)),
    maxDrawdown: maximumDrawdown(closes.slice(-252)),
    ma50: Number.isFinite(ma50) ? ma50 : null,
    ma200: Number.isFinite(ma200) ? ma200 : null,
    belowMa200: above200 === false,
    trendScore,
    returns,
  };
}

function buildDiagnosticItem({
  currentWeight,
  holding,
  item,
  now,
  targetWeight,
  weightMode,
  universeSize,
}) {
  const deltaWeight = targetWeight - currentWeight;
  const staleDays = item.latestDate
    ? Math.max(0, (now.getTime() - Date.parse(`${item.latestDate}T00:00:00Z`)) / 86400000)
    : Infinity;
  const dataReady = Boolean(holding.code) && item.pointCount >= 63 && staleDays <= 14;
  const confidenceScore =
    (item.pointCount >= 252 ? 0.5 : item.pointCount >= 126 ? 0.38 : item.pointCount >= 63 ? 0.22 : 0) +
    (staleDays <= 5 ? 0.2 : staleDays <= 10 ? 0.1 : 0) +
    (weightMode === "actual" ? 0.2 : 0.06) +
    (holding.code ? 0.1 : 0);
  const confidence = confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.55 ? "medium" : "low";
  let actionCode = "hold";
  if (!dataReady) actionCode = "pending";
  else if (deltaWeight >= REBALANCE_BAND) actionCode = "expand";
  else if (deltaWeight <= -REBALANCE_BAND) actionCode = "trim";

  const reasons = [];
  if (!dataReady) {
    if (!holding.code) reasons.push("종목 코드가 없어 가격 이력을 연결하지 못했습니다.");
    if (holding.code && item.pointCount < 63) reasons.push(`가격 이력 ${item.pointCount}일로 최소 63일에 미달합니다.`);
    if (staleDays > 14) reasons.push("최근 가격이 14일 이상 지연돼 판단을 보류했습니다.");
  } else {
    reasons.push(
      item.alphaScore >= 0.25
        ? "중기 모멘텀과 추세가 보유 종목군 상위입니다."
        : item.alphaScore <= -0.25
          ? "중기 모멘텀 또는 추세가 보유 종목군 하위입니다."
          : "모멘텀과 추세가 보유 종목군 중립권입니다.",
    );
    if (item.belowMa200) reasons.push("현재 가격이 200일 이동평균 아래입니다.");
    if (Number(item.maxDrawdown) <= -0.2) reasons.push("최근 1년 최대 낙폭이 20%를 넘었습니다.");
    if (item.crowdedTheme?.weight >= 0.35) {
      reasons.push(`동일 테마 비중이 ${(item.crowdedTheme.weight * 100).toFixed(1)}%로 집중돼 있습니다.`);
    }
    if (Number(item.riskContribution) > 1.6 / universeSize) {
      reasons.push("축소 공분산 기준 포트폴리오 위험 기여가 높습니다.");
    }
  }
  const bindingConstraint = !dataReady
    ? "data"
    : item.crowdedTheme?.weight >= 0.35
      ? "theme-concentration"
      : Number(item.riskContribution) > 1.6 / universeSize
        ? "risk-contribution"
        : item.belowMa200
          ? "long-term-trend"
          : "risk-budget";

  return {
    id: String(holding.id || ""),
    name: String(holding.name || ""),
    code: String(holding.code || ""),
    actionCode,
    action: actionCode === "expand"
      ? "확대 후보"
      : actionCode === "trim"
        ? "축소 후보"
        : actionCode === "pending"
          ? "판단 보류"
          : "유지",
    confidence,
    confidenceLabel: confidence === "high" ? "높음" : confidence === "medium" ? "보통" : "낮음",
    bindingConstraint,
    currentWeight: round(currentWeight, 4),
    targetWeight: round(targetWeight, 4),
    deltaWeight: round(deltaWeight, 4),
    reasons: reasons.slice(0, 3),
    metrics: {
      alphaScore: round(item.alphaScore, 3),
      return21: round(item.return21, 4),
      return63: round(item.return63, 4),
      momentum6_1: round(item.momentum6_1, 4),
      momentum12_1: round(item.momentum12_1, 4),
      volatility: round(item.volatility, 4),
      maxDrawdown: round(item.maxDrawdown, 4),
      riskContribution: round(item.riskContribution, 4),
      pointCount: item.pointCount,
      latestDate: item.latestDate,
    },
  };
}

function portfolioRiskContributions(analyzed, weights) {
  if (!analyzed.length || analyzed.some((item) => item.returns.length < 60)) {
    return analyzed.map(() => null);
  }
  const length = Math.min(126, ...analyzed.map((item) => item.returns.length));
  const series = analyzed.map((item) => item.returns.slice(-length));
  const means = series.map(average);
  const covariance = series.map((left, i) =>
    series.map((right, j) => {
      let total = 0;
      for (let k = 0; k < length; k += 1) {
        total += (left[k] - means[i]) * (right[k] - means[j]);
      }
      const sample = total / Math.max(1, length - 1);
      return i === j ? sample : sample * 0.5;
    }),
  );
  const sigmaW = covariance.map((row) =>
    row.reduce((sum, value, index) => sum + value * weights[index], 0),
  );
  const variance = weights.reduce((sum, weight, index) => sum + weight * sigmaW[index], 0);
  if (!(variance > 0)) return analyzed.map(() => null);
  return weights.map((weight, index) => (weight * sigmaW[index]) / variance);
}

function buildThemeExposure(holdings, weights) {
  const exposure = {};
  holdings.forEach((holding, index) => {
    const tags = Array.isArray(holding.tags) ? holding.tags : [];
    for (const tag of tags) {
      if (!RISK_TAGS.has(tag)) continue;
      exposure[tag] = (exposure[tag] || 0) + weights[index];
    }
  });
  return exposure;
}

function centeredRanks(values) {
  const valid = values
    .map((value, index) => ({ index, value: Number(value) }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  const output = values.map(() => 0);
  if (valid.length === 1) return output;
  valid.forEach((item, rank) => {
    output[item.index] = (rank / (valid.length - 1)) * 2 - 1;
  });
  return output;
}

function cappedNormalize(rawValues, cap) {
  const values = rawValues.map((value) => Math.max(0, Number(value) || 0));
  if (!values.some((value) => value > 0)) return values.map(() => 0);
  const result = values.map(() => 0);
  let active = values.map((value, index) => value > 0 ? index : -1).filter((index) => index >= 0);
  const effectiveCap = Math.max(cap, 1 / active.length);
  let remaining = 1;
  while (active.length && remaining > 1e-10) {
    const activeTotal = active.reduce((sum, index) => sum + values[index], 0);
    if (!(activeTotal > 0)) break;
    const overCap = active.filter((index) => (values[index] / activeTotal) * remaining > effectiveCap);
    if (!overCap.length) {
      for (const index of active) result[index] = (values[index] / activeTotal) * remaining;
      remaining = 0;
      break;
    }
    for (const index of overCap) result[index] = effectiveCap;
    remaining -= effectiveCap * overCap.length;
    const overSet = new Set(overCap);
    active = active.filter((index) => !overSet.has(index));
  }
  return result;
}

function trailingReturn(closes, days) {
  if (closes.length <= days) return null;
  const latest = closes.at(-1);
  const base = closes.at(-1 - days);
  return Number.isFinite(latest) && Number.isFinite(base) && base > 0 ? latest / base - 1 : null;
}

function skipMonthReturn(closes, lookbackDays) {
  if (closes.length <= lookbackDays) return null;
  const recent = closes.at(-22);
  const base = closes.at(-1 - lookbackDays);
  return Number.isFinite(recent) && Number.isFinite(base) && base > 0 ? recent / base - 1 : null;
}

function annualizedVolatility(returns) {
  if (returns.length < 20) return null;
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * TRADING_DAYS);
}

function maximumDrawdown(closes) {
  if (!closes.length) return null;
  let peak = closes[0];
  let drawdown = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    drawdown = Math.min(drawdown, close / peak - 1);
  }
  return drawdown;
}

function emptyDiagnostics(now) {
  return {
    assessment: "conditional-risk-screen",
    generatedAt: now.toISOString(),
    modelVersion: "conditional-quant-v1.0",
    weightMode: "equal_assumption",
    missingAmountCount: 0,
    dataReadyCount: 0,
    count: 0,
    summary: { expand: 0, hold: 0, trim: 0, pending: 0, topTheme: null },
    items: [],
  };
}

function countBy(items, picker) {
  return items.reduce((counts, item) => {
    const key = picker(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, decimals = 4) {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** decimals;
  return Math.round(Number(value) * scale) / scale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  analyzeHoldingHistory,
  buildHoldingsDiagnostics,
  cappedNormalize,
};
