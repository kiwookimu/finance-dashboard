const TRADING_DAYS = 252;
const MINIMUM_ACTION_HISTORY = 63;
const DEFAULT_COST_SCORE = 2;
const ROTATION_FRACTION = 0.3;

const ETF_PROFILES = {
  "0019K0": profile("bond_mix", 0.15, { broad_us: 0.5, bond: 0.5 }, { us: 1 }),
  "0162Z0": profile("bond_mix", 0.15, { semi: 0.5, bond: 0.5 }, { korea: 1 }),
  "229200": profile("broad", 0.15, { broad_korea: 1 }, { korea: 1 }),
  "284430": profile("bond_mix", 0.15, { broad_korea: 0.5, bond: 0.5 }, { korea: 1 }),
  "315930": profile("sector", 0.12, { large_cap_korea: 0.6, semi: 0.4 }, { korea: 1 }),
  "367760": profile("theme", 0.1, { ai_infra: 0.4, network: 0.3, semi: 0.3 }, { korea: 1 }),
  "381180": profile("sector", 0.12, { semi: 1 }, { us: 1 }),
  "395270": profile("sector", 0.12, { semi: 1 }, { korea: 1 }),
  "418670": profile("concentrated", 0.08, { cybersecurity: 0.7, ai: 0.3 }, { global: 1 }),
  "442580": profile("concentrated", 0.08, { semi: 0.9, ai: 0.1 }, { global: 1 }),
  "449450": profile("theme", 0.1, { defense: 1 }, { korea: 1 }),
  "456600": profile("theme", 0.1, { ai: 1 }, { global: 1 }),
  "487230": profile("concentrated", 0.08, { ai_infra: 0.7, power: 0.3 }, { us: 1 }),
  "487240": profile("concentrated", 0.08, { power: 0.6, ai_infra: 0.4 }, { korea: 1 }),
};

const CONCENTRATION_THEMES = new Set([
  "ai",
  "ai_infra",
  "cybersecurity",
  "defense",
  "network",
  "power",
  "semi",
]);

const EXPOSURE_LIMITS = {
  ai: 0.25,
  ai_infra: 0.25,
  ai_plus_semi: 0.45,
  cybersecurity: 0.25,
  defense: 0.25,
  korea: 0.5,
  network: 0.25,
  power: 0.25,
  semi: 0.3,
  us: 0.5,
};

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
  const currentWeights = source.map((holding) =>
    weightMode === "actual"
      ? Math.max(0, Number(holding.currentValueKrw) || 0) / totalAmount
      : 1 / source.length,
  );
  const profiles = source.map(resolveHoldingProfile);
  const analyzed = source.map(analyzeHoldingHistory);
  const rank = {
    return21: percentileRanks(analyzed.map((item) => item.return21)),
    return63: percentileRanks(analyzed.map((item) => item.return63)),
    return126: percentileRanks(analyzed.map((item) => item.return126)),
    return252: percentileRanks(analyzed.map((item) => item.return252)),
    riskAdjusted126: percentileRanks(analyzed.map((item) => item.riskAdjusted126)),
    avgDailyValue: percentileRanks(analyzed.map((item) => item.avgDailyValue)),
  };
  const averageCorrelations = analyzed.map((item, index) =>
    averagePortfolioCorrelation(item, analyzed, index),
  );
  const currentExposure = buildExposureSummary(profiles, currentWeights);
  const riskContributions = portfolioRiskContributions(analyzed, currentWeights);

  let items = analyzed.map((metrics, index) => {
    const momentumScore =
      rank.return21[index] * 10 +
      rank.return63[index] * 12 +
      rank.return126[index] * 12 +
      rank.return252[index] * 6;
    const momentumAcceleration =
      0.5 * (rank.return21[index] - rank.return126[index]) +
      0.5 * (rank.return63[index] - rank.return126[index]);
    const priceTrendScore = trendConditionScore(metrics);
    const drawdownScore = scoreDrawdown(metrics.drawdown52w);
    const riskAdjustedScore = rank.riskAdjusted126[index] * 10;
    const trendRiskScore = priceTrendScore + drawdownScore + riskAdjustedScore;
    const themeFitScore = scoreThemeFit(profiles[index], currentExposure);
    const positionSizeScore = scorePositionSize(currentWeights[index]);
    const diversificationScore = scoreDiversification(averageCorrelations[index]);
    const portfolioFitScore = themeFitScore + positionSizeScore + diversificationScore;
    const liquidityScore = rank.avgDailyValue[index] * 6;
    const liquidityCostScore = liquidityScore + DEFAULT_COST_SCORE;
    const quantScore = clamp(
      momentumScore + trendRiskScore + portfolioFitScore + liquidityCostScore,
      0,
      100,
    );
    return {
      id: String(source[index].id || ""),
      name: String(source[index].name || ""),
      code: String(source[index].code || ""),
      holding: source[index],
      profile: profiles[index],
      metrics,
      currentWeight: currentWeights[index],
      riskContribution: riskContributions[index],
      averageCorrelation: averageCorrelations[index],
      momentumAcceleration,
      scoreRanks: {
        return21: rank.return21[index],
        return63: rank.return63[index],
        return126: rank.return126[index],
        return252: rank.return252[index],
      },
      scores: {
        momentum: momentumScore,
        trendRisk: trendRiskScore,
        portfolioFit: portfolioFitScore,
        liquidityCost: liquidityCostScore,
        detail: {
          priceTrend: priceTrendScore,
          drawdown: drawdownScore,
          riskAdjusted: riskAdjustedScore,
          themeFit: themeFitScore,
          positionSize: positionSizeScore,
          diversification: diversificationScore,
          liquidity: liquidityScore,
          cost: DEFAULT_COST_SCORE,
        },
      },
      quantScore,
      rating: quantRating(quantScore),
    };
  });

  const quantRanks = percentileRanks(items.map((item) => item.quantScore));
  items = items.map((item, index) => ({
    ...item,
    quantPercentile: quantRanks[index],
    rank: 1 + items.filter((candidate) => candidate.quantScore > item.quantScore).length,
  }));

  const primaryThemeBestReturn = buildPrimaryThemeBestReturn(items);
  items = items.map((item) => {
    const theme = primaryConcentrationTheme(item.profile);
    const peerBestReturn = theme ? primaryThemeBestReturn[theme] : null;
    const themeGap = Number.isFinite(peerBestReturn) && Number.isFinite(item.metrics.return63)
      ? peerBestReturn - item.metrics.return63
      : null;
    const holdingThemeBreach = profileExposureBreached(item.profile, currentExposure);
    const buyChecks = {
      quantTop25: item.quantPercentile >= 0.75,
      return3mTop25: item.scoreRanks.return63 >= 0.75,
      return6mTop35: item.scoreRanks.return126 >= 0.65,
      aboveMa60: item.metrics.aboveMa60 === true,
      aboveMa120: item.metrics.aboveMa120 === true,
      accelerating: item.momentumAcceleration > 0,
      weightBelow10: item.currentWeight < 0.1,
    };
    const sellChecks = {
      quantBottom25: item.quantPercentile <= 0.25,
      return3mBottom25: item.scoreRanks.return63 <= 0.25,
      belowMa120: item.metrics.aboveMa120 === false,
      decelerating: item.scoreRanks.return21 < item.scoreRanks.return126,
      themeUnderperform: Number(themeGap) >= 0.05,
      themeConcentrated: holdingThemeBreach,
    };
    const buyConditionCount = trueCount(buyChecks);
    const sellConditionCount = trueCount(sellChecks);
    const buyScore = clamp(
      item.quantScore +
        item.momentumAcceleration * 8 -
        (7 - item.scores.detail.positionSize) * 0.5 -
        (10 - item.scores.detail.themeFit) * 0.5,
      0,
      100,
    );
    const sellPriority = clamp(
      100 - item.quantScore +
        Math.max(0, 0.5 - item.scoreRanks.return63) * 12 +
        (item.metrics.aboveMa120 === false ? 8 : 0) +
        (holdingThemeBreach ? 6 : 0),
      0,
      100,
    );
    return {
      ...item,
      themeGap,
      buyChecks,
      sellChecks,
      buyConditionCount,
      sellConditionCount,
      buyCandidate: buyConditionCount >= 4,
      sellCandidate: sellConditionCount >= 3,
      buyScore,
      sellPriority,
    };
  });

  const recovery = buildRecoveryMode(items, currentWeights);
  const rawTargets = items.map((item) => {
    if (item.metrics.pointCount < MINIMUM_ACTION_HISTORY || !item.code) return 0;
    const volatility = Math.max(0.08, Number(item.metrics.volatility126) || 0.25);
    const actionTilt = item.buyCandidate ? 1.12 : item.sellCandidate ? 0.7 : 1;
    return (Math.exp((item.quantScore - 55) / 24) / volatility) * actionTilt;
  });
  const caps = items.map((item) => item.profile.maxWeight);
  const targetWeights = allocateTargetsWithLimits(rawTargets, caps, profiles);
  const targetExposure = buildExposureSummary(profiles, targetWeights);

  items = items.map((item, index) =>
    finalizeDiagnosticItem({
      item,
      targetWeight: targetWeights[index],
      now,
      weightMode,
      currentExposure,
      totalAmount,
    }),
  );
  const rotationRecommendation = buildRotationRecommendation(items, recovery, weightMode);
  if (rotationRecommendation.status === "eligible") {
    items = items.map((item) => item.id === rotationRecommendation.sell.id
      ? { ...item, actionCode: "rotate", action: "회전 후보" }
      : item);
  }

  const actionCounts = countBy(items, (item) => item.actionCode);
  const topExposure = Object.entries(currentExposure.themes)
    .filter(([theme]) => CONCENTRATION_THEMES.has(theme))
    .sort((a, b) => b[1] - a[1])[0] || null;
  const missingAmountCount = source.filter((holding) => holding.currentValueKrw === null).length;
  const dataReadyCount = items.filter((item) => item.actionCode !== "pending").length;

  return {
    assessment: "conditional-risk-screen",
    generatedAt: now.toISOString(),
    modelVersion: "etf-quant-rotation-v2.0",
    weightMode,
    totalAmountKrw: weightMode === "actual" ? totalAmount : null,
    missingAmountCount,
    dataReadyCount,
    count: items.length,
    summary: {
      expand: actionCounts.expand || 0,
      hold: actionCounts.hold || 0,
      trim: actionCounts.trim || 0,
      rotate: actionCounts.rotate || 0,
      pending: actionCounts.pending || 0,
      topTheme: topExposure ? { tag: topExposure[0], weight: round(topExposure[1], 4) } : null,
      averageQuantScore: round(average(items.map((item) => item.quantScore)), 1),
    },
    recoveryMode: recovery,
    rotationRecommendation,
    portfolioExposure: {
      current: serializeExposure(currentExposure),
      target: serializeExposure(targetExposure),
      limits: EXPOSURE_LIMITS,
      currentBreaches: exposureBreaches(currentExposure),
      targetBreaches: exposureBreaches(targetExposure),
    },
    methodology: {
      factorWeights: {
        momentum: 40,
        trendRisk: 25,
        portfolioFit: 25,
        liquidityCost: 10,
      },
      momentum: "보유 ETF 내 1개월 10점 · 3개월 12점 · 6개월 12점 · 12개월 6점 순위",
      trendRisk: "20·60·120일 추세 10점 · 52주 고점 낙폭 5점 · 6개월 수익/변동성 순위 10점",
      portfolioFit: "가중 테마 집중 10점 · 현재 비중 7점 · 90일 평균 상관 8점",
      liquidityCost: "20일 평균 거래대금 순위 6점 · 비용 데이터 미연결 중립 2/4점",
      rotation: "매수 4/7 · 매도 3/6 조건, 점수차 10점과 3개월 성과차 5%p 동시 충족",
      recovery: "포트폴리오 낙폭 -10% 이하에서 상위 절반의 단기 추세 회복 시 점수차 15점·성과차 7%p",
      corporateActionPolicy: "일일 가격변화가 거래소 가격제한폭을 넘는 구간은 분할 가능성으로 역산 조정",
      exposureSource: "상품 프로필 기반 가중 노출이며 실시간 구성종목 look-through는 아직 미반영",
    },
    dataCoverage: {
      priceMomentumTrend: "connected",
      tradedValue: "connected",
      aum: "missing",
      bidAskSpread: "missing",
      expenseRatio: "missing-neutral-score",
      constituentLookThrough: "profile-estimate",
      cashWeight: "not-configured",
    },
    limitations: [
      weightMode === "actual"
        ? "입력한 평가금액을 현재 비중으로 사용했습니다."
        : "모든 평가금액이 입력되지 않아 현재 비중은 동일비중으로 가정했습니다.",
      "AUM·호가 스프레드·총보수는 현재 데이터 원천에 연결되지 않아 비용 점수는 중립값입니다.",
      "세금·계좌 목적·현금 수요를 반영하지 않은 조건부 화면이며 회전 표시는 주문 지시가 아닙니다.",
    ],
    items: items
      .sort((a, b) => b.quantScore - a.quantScore || a.name.localeCompare(b.name))
      .map((item, index) => ({ ...item, rank: index + 1 })),
  };
}

function analyzeHoldingHistory(holding) {
  const rawRows = (Array.isArray(holding.history) ? holding.history : [])
    .map((row) => ({
      date: String(row.date || ""),
      close: Number(row.close ?? row.value),
      volume: Number(row.volume),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const { rows, adjustmentCount } = adjustCorporateActionRows(rawRows);
  const closes = rows.map((row) => row.close);
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const latest = closes.at(-1);
  const ma20 = movingAverage(closes, 20);
  const ma60 = movingAverage(closes, 60);
  const ma120 = movingAverage(closes, 120);
  const return126 = trailingReturn(closes, 126);
  const volatility126 = annualizedVolatility(returns.slice(-126));
  const high52w = closes.length ? Math.max(...closes.slice(-252)) : null;
  const drawdown52w = Number.isFinite(latest) && Number.isFinite(high52w) && high52w > 0
    ? latest / high52w - 1
    : null;
  const tradedValues = rawRows
    .slice(-20)
    .map((row) => row.close * row.volume)
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    pointCount: rows.length,
    latestDate: rows.at(-1)?.date || "",
    latestClose: latest || null,
    return21: trailingReturn(closes, 21),
    return63: trailingReturn(closes, 63),
    return126,
    return252: trailingReturn(closes, 252),
    volatility63: annualizedVolatility(returns.slice(-63)),
    volatility126,
    riskAdjusted126: Number.isFinite(return126) && Number.isFinite(volatility126) && volatility126 > 0
      ? return126 / volatility126
      : null,
    high52w: Number.isFinite(high52w) ? high52w : null,
    drawdown52w,
    ma20,
    ma60,
    ma120,
    aboveMa20: Number.isFinite(latest) && Number.isFinite(ma20) ? latest > ma20 : null,
    aboveMa60: Number.isFinite(latest) && Number.isFinite(ma60) ? latest > ma60 : null,
    aboveMa120: Number.isFinite(latest) && Number.isFinite(ma120) ? latest > ma120 : null,
    ma20Above60: Number.isFinite(ma20) && Number.isFinite(ma60) ? ma20 > ma60 : null,
    ma60Above120: Number.isFinite(ma60) && Number.isFinite(ma120) ? ma60 > ma120 : null,
    avgDailyValue: tradedValues.length ? average(tradedValues) : null,
    corporateActionAdjustments: adjustmentCount,
    returns,
  };
}

function finalizeDiagnosticItem({ item, targetWeight, now, weightMode, currentExposure, totalAmount }) {
  const staleDays = item.metrics.latestDate
    ? Math.max(0, (now.getTime() - Date.parse(`${item.metrics.latestDate}T00:00:00Z`)) / 86400000)
    : Infinity;
  const dataReady = Boolean(item.code) && item.metrics.pointCount >= MINIMUM_ACTION_HISTORY && staleDays <= 14;
  const historyCoverage = item.metrics.pointCount >= 253 ? "full" : item.metrics.pointCount >= 120 ? "partial" : "short";
  const confidenceScore =
    (historyCoverage === "full" ? 0.45 : historyCoverage === "partial" ? 0.3 : historyCoverage === "short" ? 0.15 : 0) +
    (staleDays <= 5 ? 0.2 : staleDays <= 10 ? 0.1 : 0) +
    (weightMode === "actual" ? 0.2 : 0.06) +
    (Number.isFinite(item.metrics.avgDailyValue) ? 0.1 : 0) +
    (item.profile.source === "verified-profile" ? 0.05 : 0);
  const confidence = confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.55 ? "medium" : "low";
  const deltaWeight = targetWeight - item.currentWeight;
  const exitDays10PctAdv = weightMode === "actual" && item.metrics.avgDailyValue > 0
    ? (item.currentWeight * totalAmount) / (item.metrics.avgDailyValue * 0.1)
    : null;
  let actionCode = "hold";
  if (!dataReady) actionCode = "pending";
  else if (item.sellCandidate && deltaWeight <= -0.01) actionCode = "trim";
  else if (item.buyCandidate && deltaWeight >= 0.01) actionCode = "expand";

  const dominantTheme = primaryConcentrationTheme(item.profile);
  const themeWeight = dominantTheme ? currentExposure.themes[dominantTheme] || 0 : 0;
  const reasons = [];
  if (!dataReady) {
    if (!item.code) reasons.push("종목 코드가 없어 가격 이력을 연결하지 못했습니다.");
    if (item.code && item.metrics.pointCount < MINIMUM_ACTION_HISTORY) {
      reasons.push(`가격 이력 ${item.metrics.pointCount}일로 최소 ${MINIMUM_ACTION_HISTORY}일에 미달합니다.`);
    }
    if (staleDays > 14) reasons.push("최근 가격이 14일 이상 지연돼 판단을 보류했습니다.");
  } else if (actionCode === "expand") {
    reasons.push(`매수 조건 ${item.buyConditionCount}/7개 충족 · Quant ${item.quantScore.toFixed(1)}점`);
    if (item.momentumAcceleration > 0) reasons.push("1·3개월 순위가 6개월 대비 개선되는 가속 구간입니다.");
    if (themeWeight > 0) reasons.push(`${dominantTheme} 노출 ${formatWeightPercent(themeWeight)}를 목표한도와 함께 반영했습니다.`);
  } else if (actionCode === "trim") {
    reasons.push(`매도 조건 ${item.sellConditionCount}/6개 충족 · Sell Priority ${item.sellPriority.toFixed(1)}`);
    if (item.metrics.aboveMa120 === false) reasons.push("현재 가격이 120일 이동평균 아래입니다.");
    if (Number(item.themeGap) >= 0.05) reasons.push(`동일 테마 최상위 대비 3개월 성과가 ${formatPercentagePoint(item.themeGap)} 낮습니다.`);
  } else {
    reasons.push(`매수 ${item.buyConditionCount}/7 · 매도 ${item.sellConditionCount}/6 조건으로 유지 구간입니다.`);
    if (Math.abs(deltaWeight) < 0.01) reasons.push("현재 비중과 위험조정 목표비중의 차이가 1%p 이내입니다.");
  }
  if (item.metrics.corporateActionAdjustments > 0) {
    reasons.push(`분할 가능 가격 단절 ${item.metrics.corporateActionAdjustments}건을 조정했습니다.`);
  }
  const bindingConstraint = !dataReady
    ? "data"
    : Number(exitDays10PctAdv) > 5
      ? "liquidity"
      : profileExposureBreached(item.profile, currentExposure)
        ? "theme-concentration"
        : item.currentWeight >= item.profile.maxWeight
          ? "max-position"
          : item.metrics.aboveMa120 === false
            ? "long-term-trend"
            : "risk-budget";
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    rank: item.rank,
    quantScore: round(item.quantScore, 1),
    rating: item.rating,
    buyScore: round(item.buyScore, 1),
    sellPriority: round(item.sellPriority, 1),
    buyCandidate: item.buyCandidate,
    sellCandidate: item.sellCandidate,
    currentValueKrw: item.holding.currentValueKrw === null
      ? null
      : round(Number(item.holding.currentValueKrw), 0),
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
    historyCoverage,
    bindingConstraint,
    category: item.profile.category,
    maxTargetWeight: item.profile.maxWeight,
    currentWeight: round(item.currentWeight, 4),
    targetWeight: round(targetWeight, 4),
    deltaWeight: round(deltaWeight, 4),
    exitDays10PctAdv: round(exitDays10PctAdv, 2),
    momentumAcceleration: round(item.momentumAcceleration, 3),
    averageCorrelation90d: round(item.averageCorrelation, 3),
    riskContribution: round(item.riskContribution, 4),
    buyConditionCount: item.buyConditionCount,
    sellConditionCount: item.sellConditionCount,
    buyChecks: item.buyChecks,
    sellChecks: item.sellChecks,
    reasons: reasons.slice(0, 3),
    scores: {
      momentum: round(item.scores.momentum, 1),
      trendRisk: round(item.scores.trendRisk, 1),
      portfolioFit: round(item.scores.portfolioFit, 1),
      liquidityCost: round(item.scores.liquidityCost, 1),
      detail: mapValues(item.scores.detail, (value) => round(value, 1)),
    },
    metrics: {
      return21: round(item.metrics.return21, 4),
      return63: round(item.metrics.return63, 4),
      return126: round(item.metrics.return126, 4),
      return252: round(item.metrics.return252, 4),
      volatility63: round(item.metrics.volatility63, 4),
      volatility126: round(item.metrics.volatility126, 4),
      drawdown52w: round(item.metrics.drawdown52w, 4),
      avgDailyValue: round(item.metrics.avgDailyValue, 0),
      latestDate: item.metrics.latestDate,
      pointCount: item.metrics.pointCount,
      aboveMa20: item.metrics.aboveMa20,
      aboveMa60: item.metrics.aboveMa60,
      aboveMa120: item.metrics.aboveMa120,
      corporateActionAdjustments: item.metrics.corporateActionAdjustments,
    },
  };
}

function buildRotationRecommendation(items, recovery, weightMode) {
  const buys = items
    .filter((item) => item.buyCandidate && item.actionCode === "expand")
    .sort((a, b) => b.buyScore - a.buyScore || b.quantScore - a.quantScore);
  const sells = items
    .filter((item) => item.sellCandidate && item.actionCode === "trim")
    .sort((a, b) => b.sellPriority - a.sellPriority || a.quantScore - b.quantScore);
  if (!buys.length || !sells.length) {
    return {
      status: "not-met",
      reason: "매수 4/7과 매도 3/6 조건을 동시에 충족하는 짝이 없습니다.",
    };
  }
  const buy = buys[0];
  const sell = sells.find((candidate) => candidate.id !== buy.id);
  if (!sell) return { status: "not-met", reason: "서로 다른 매수·매도 후보가 없습니다." };
  const scoreGap = buy.quantScore - sell.quantScore;
  const performanceGap = Number(buy.metrics.return63) - Number(sell.metrics.return63);
  const scoreThreshold = recovery.active ? 15 : 10;
  const performanceThreshold = recovery.active ? 0.07 : 0.05;
  const eligible = scoreGap >= scoreThreshold && performanceGap >= performanceThreshold;
  return {
    status: eligible ? "eligible" : "not-met",
    reason: eligible
      ? "점수차와 3개월 상대성과차가 모두 회전 기준을 충족했습니다."
      : `점수차 ${scoreGap.toFixed(1)}점·성과차 ${formatPercentagePoint(performanceGap)}로 최소 기준에 미달합니다.`,
    sell: { id: sell.id, name: sell.name, score: round(sell.quantScore, 1) },
    buy: { id: buy.id, name: buy.name, score: round(buy.quantScore, 1) },
    scoreGap: round(scoreGap, 1),
    performanceGap: round(performanceGap, 4),
    scoreThreshold,
    performanceThreshold,
    firstStageFraction: ROTATION_FRACTION,
    estimatedAmountKrw: eligible && weightMode === "actual"
      ? round(Number(sell.currentValueKrw) * ROTATION_FRACTION, 0)
      : null,
    readiness: weightMode === "actual" ? "conditional-with-position-values" : "equal-weight-assumption",
  };
}

function buildRecoveryMode(items, weights) {
  const eligible = items.filter((item) => item.metrics.returns.length >= 60);
  if (eligible.length !== items.length) {
    return {
      active: false,
      portfolioDrawdown: null,
      maxPortfolioDrawdown1y: null,
      recoveredTopHalf: 0,
      requiredRecovered: null,
    };
  }
  const length = Math.min(252, ...items.map((item) => item.metrics.returns.length));
  let value = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (let day = -length; day < 0; day += 1) {
    const portfolioReturn = items.reduce(
      (sum, item, index) => sum + (Math.exp(item.metrics.returns.at(day)) - 1) * weights[index],
      0,
    );
    value *= 1 + portfolioReturn;
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  const topHalf = [...items]
    .sort((a, b) => b.quantScore - a.quantScore)
    .slice(0, Math.ceil(items.length / 2));
  const recoveredTopHalf = topHalf.filter(
    (item) => item.metrics.aboveMa20 === true || item.metrics.aboveMa60 === true,
  ).length;
  const requiredRecovered = Math.ceil(topHalf.length / 2);
  const currentDrawdown = value / peak - 1;
  return {
    active: currentDrawdown < -0.1 && recoveredTopHalf >= requiredRecovered,
    portfolioDrawdown: round(currentDrawdown, 4),
    maxPortfolioDrawdown1y: round(maxDrawdown, 4),
    recoveredTopHalf,
    requiredRecovered,
  };
}

function trendConditionScore(metrics) {
  return [
    metrics.aboveMa20,
    metrics.aboveMa60,
    metrics.aboveMa120,
    metrics.ma20Above60,
    metrics.ma60Above120,
  ].reduce((score, passed) => score + (passed === true ? 2 : 0), 0);
}

function scoreDrawdown(drawdown) {
  if (!Number.isFinite(drawdown)) return 2.5;
  if (drawdown >= -0.05) return 5;
  if (drawdown >= -0.1) return 4;
  if (drawdown >= -0.15) return 3;
  if (drawdown >= -0.25) return 2;
  if (drawdown >= -0.35) return 1;
  return 0;
}

function scoreThemeFit(profileValue, exposure) {
  const relevant = Object.entries(profileValue.themes)
    .filter(([theme, weight]) => CONCENTRATION_THEMES.has(theme) && weight > 0);
  if (!relevant.length) return 10;
  const total = relevant.reduce((sum, [, weight]) => sum + weight, 0);
  const weightedExposure = relevant.reduce(
    (sum, [theme, weight]) => sum + (exposure.themes[theme] || 0) * weight,
    0,
  ) / total;
  if (weightedExposure < 0.15) return 10;
  if (weightedExposure < 0.25) return 8;
  if (weightedExposure < 0.35) return 5;
  if (weightedExposure < 0.45) return 2;
  return 0;
}

function scorePositionSize(weight) {
  if (weight < 0.05) return 7;
  if (weight < 0.08) return 6;
  if (weight < 0.1) return 4;
  if (weight < 0.12) return 2;
  return 0;
}

function scoreDiversification(correlation) {
  if (!Number.isFinite(correlation)) return 4;
  if (correlation < 0.3) return 8;
  if (correlation < 0.45) return 7;
  if (correlation < 0.6) return 5;
  if (correlation < 0.75) return 3;
  return 0;
}

function quantRating(score) {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 55) return "C";
  return "D";
}

function buildPrimaryThemeBestReturn(items) {
  const result = {};
  for (const item of items) {
    const theme = primaryConcentrationTheme(item.profile);
    if (!theme || !Number.isFinite(item.metrics.return63)) continue;
    result[theme] = Math.max(result[theme] ?? -Infinity, item.metrics.return63);
  }
  return result;
}

function primaryConcentrationTheme(profileValue) {
  return Object.entries(profileValue.themes)
    .filter(([theme]) => CONCENTRATION_THEMES.has(theme))
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function profileExposureBreached(profileValue, exposure) {
  const directThemeBreach = Object.entries(profileValue.themes).some(([theme, weight]) =>
    weight > 0 && EXPOSURE_LIMITS[theme] &&
      (exposure.themes[theme] || 0) > EXPOSURE_LIMITS[theme]
  );
  const countryBreach = Object.entries(profileValue.countries).some(([country, weight]) =>
    weight > 0 && EXPOSURE_LIMITS[country] &&
      (exposure.countries[country] || 0) > EXPOSURE_LIMITS[country]
  );
  const aiSemiExposure =
    (profileValue.themes.ai || 0) +
    (profileValue.themes.ai_infra || 0) +
    (profileValue.themes.semi || 0);
  const combinedBreach = aiSemiExposure > 0 &&
    (exposure.combined.ai_plus_semi || 0) > EXPOSURE_LIMITS.ai_plus_semi;
  return directThemeBreach || countryBreach || combinedBreach;
}

function buildExposureSummary(profiles, weights) {
  const themes = {};
  const countries = {};
  profiles.forEach((profileValue, index) => {
    for (const [theme, exposure] of Object.entries(profileValue.themes)) {
      themes[theme] = (themes[theme] || 0) + weights[index] * exposure;
    }
    for (const [country, exposure] of Object.entries(profileValue.countries)) {
      countries[country] = (countries[country] || 0) + weights[index] * exposure;
    }
  });
  return {
    themes,
    countries,
    combined: {
      ai_plus_semi: (themes.ai || 0) + (themes.ai_infra || 0) + (themes.semi || 0),
    },
  };
}

function exposureBreaches(exposure) {
  const values = { ...exposure.themes, ...exposure.countries, ...exposure.combined };
  return Object.entries(EXPOSURE_LIMITS)
    .filter(([key, limit]) => Number(values[key] || 0) > limit + 1e-6)
    .map(([key, limit]) => ({ key, weight: round(values[key], 4), limit }));
}

function serializeExposure(exposure) {
  return {
    themes: mapValues(exposure.themes, (value) => round(value, 4)),
    countries: mapValues(exposure.countries, (value) => round(value, 4)),
    combined: mapValues(exposure.combined, (value) => round(value, 4)),
  };
}

function allocateTargetsWithLimits(raw, caps, profiles) {
  let weights = cappedNormalize(raw, caps);
  const constraints = Object.entries(EXPOSURE_LIMITS).map(([key, limit]) => ({
    key,
    limit,
    vector: profiles.map((profileValue) => profileExposureForKey(profileValue, key)),
  }));
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    for (const constraint of constraints) {
      const exposure = weights.reduce(
        (sum, weight, index) => sum + weight * constraint.vector[index],
        0,
      );
      if (exposure <= constraint.limit + 1e-10) continue;
      const normSquared = constraint.vector.reduce((sum, value) => sum + value ** 2, 0);
      if (!(normSquared > 0)) continue;
      const correction = (exposure - constraint.limit) / normSquared;
      weights = weights.map(
        (weight, index) => weight - correction * constraint.vector[index],
      );
    }
    weights = projectCappedSimplex(weights, caps);
    const maxViolation = constraints.reduce((maximum, constraint) => {
      const exposure = weights.reduce(
        (sum, weight, index) => sum + weight * constraint.vector[index],
        0,
      );
      return Math.max(maximum, exposure - constraint.limit);
    }, 0);
    if (maxViolation <= 1e-8) break;
  }
  return weights;
}

function projectCappedSimplex(values, caps, totalTarget = 1) {
  const target = Math.min(totalTarget, caps.reduce((sum, value) => sum + value, 0));
  let lower = Math.min(...values.map((value, index) => value - caps[index])) - target;
  let upper = Math.max(...values) + target;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const lambda = (lower + upper) / 2;
    const sum = values.reduce(
      (total, value, index) => total + clamp(value - lambda, 0, caps[index]),
      0,
    );
    if (sum > target) lower = lambda;
    else upper = lambda;
  }
  const lambda = (lower + upper) / 2;
  return values.map((value, index) => clamp(value - lambda, 0, caps[index]));
}

function profileExposureForKey(profileValue, key) {
  if (key === "ai_plus_semi") {
    return (profileValue.themes.ai || 0) +
      (profileValue.themes.ai_infra || 0) +
      (profileValue.themes.semi || 0);
  }
  return profileValue.themes[key] || profileValue.countries[key] || 0;
}

function cappedNormalize(rawValues, capOrCaps, totalTarget = 1) {
  const values = rawValues.map((value) => Math.max(0, Number(value) || 0));
  const caps = Array.isArray(capOrCaps)
    ? capOrCaps.map((value) => Math.max(0, Number(value) || 0))
    : values.map(() => Math.max(0, Number(capOrCaps) || 0));
  const active = values.map((value, index) => value > 0 && caps[index] > 0 ? index : -1).filter((index) => index >= 0);
  if (!active.length) return values.map(() => 0);
  const target = Math.min(totalTarget, active.reduce((sum, index) => sum + caps[index], 0));
  const result = values.map(() => 0);
  let remainingIndexes = [...active];
  let remaining = target;
  while (remainingIndexes.length && remaining > 1e-10) {
    const activeTotal = remainingIndexes.reduce((sum, index) => sum + values[index], 0);
    if (!(activeTotal > 0)) break;
    const overCap = remainingIndexes.filter(
      (index) => (values[index] / activeTotal) * remaining > caps[index],
    );
    if (!overCap.length) {
      for (const index of remainingIndexes) result[index] = (values[index] / activeTotal) * remaining;
      break;
    }
    for (const index of overCap) {
      result[index] = caps[index];
      remaining -= caps[index];
    }
    const overSet = new Set(overCap);
    remainingIndexes = remainingIndexes.filter((index) => !overSet.has(index));
  }
  return result;
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

function averagePortfolioCorrelation(item, items, itemIndex) {
  const correlations = items
    .map((other, index) => index === itemIndex ? null : correlation(item.returns, other.returns, 90))
    .filter(Number.isFinite);
  return correlations.length ? average(correlations) : null;
}

function correlation(left, right, window) {
  const length = Math.min(window, left.length, right.length);
  if (length < 20) return null;
  const x = left.slice(-length);
  const y = right.slice(-length);
  const xMean = average(x);
  const yMean = average(y);
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < length; index += 1) {
    const xDiff = x[index] - xMean;
    const yDiff = y[index] - yMean;
    covariance += xDiff * yDiff;
    xVariance += xDiff ** 2;
    yVariance += yDiff ** 2;
  }
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator > 0 ? covariance / denominator : null;
}

function percentileRanks(values) {
  const numeric = values.map((value) => value === null || value === undefined ? NaN : Number(value));
  const valid = numeric.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length <= 1) return values.map(() => 0.5);
  return numeric.map((value) => {
    if (!Number.isFinite(value)) return 0.5;
    const lower = valid.findIndex((candidate) => candidate === value);
    const upper = valid.length - 1 - [...valid].reverse().findIndex((candidate) => candidate === value);
    return ((lower + upper) / 2) / (valid.length - 1);
  });
}

function adjustCorporateActionRows(rows) {
  const adjusted = rows.map((row) => ({ ...row }));
  let adjustmentCount = 0;
  for (let index = 1; index < adjusted.length; index += 1) {
    const ratio = adjusted[index].close / adjusted[index - 1].close;
    if (ratio > 1.35 || ratio < 0.65) {
      for (let previous = 0; previous < index; previous += 1) {
        adjusted[previous].close *= ratio;
      }
      adjustmentCount += 1;
    }
  }
  return { rows: adjusted, adjustmentCount };
}

function resolveHoldingProfile(holding) {
  const code = String(holding.code || "").toUpperCase();
  if (ETF_PROFILES[code]) return ETF_PROFILES[code];
  const name = String(holding.name || "").replace(/\s+/g, "").toUpperCase();
  const tags = Array.isArray(holding.tags) ? holding.tags : [];
  const themes = {};
  for (const tag of tags) {
    const mapped = {
      semi: "semi",
      ai: "ai",
      aiInfra: "ai_infra",
      cybersecurity: "cybersecurity",
      defense: "defense",
      network: "network",
      power: "power",
      bondMix: "bond",
    }[tag];
    if (mapped) themes[mapped] = 1;
  }
  if (!Object.keys(themes).length) {
    themes[/미국|글로벌/.test(name) ? "broad_us" : "broad_korea"] = 1;
  }
  const themeTotal = Object.values(themes).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(themes)) themes[key] /= themeTotal;
  const concentrated = /HBM|사이버보안|전력핵심/.test(name);
  const bondMix = /채권혼합/.test(name);
  const broad = /코스닥150|KODEX200|S&P500|나스닥100/.test(name) && !concentrated;
  const category = bondMix ? "bond_mix" : broad ? "broad" : concentrated ? "concentrated" : "theme";
  const maxWeight = category === "broad" || category === "bond_mix" ? 0.15 : category === "concentrated" ? 0.08 : 0.1;
  const countries = /미국/.test(name) ? { us: 1 } : /글로벌/.test(name) ? { global: 1 } : { korea: 1 };
  return { category, maxWeight, themes, countries, source: "inferred-profile" };
}

function profile(category, maxWeight, themes, countries) {
  return { category, maxWeight, themes, countries, source: "verified-profile" };
}

function trailingReturn(closes, days) {
  if (closes.length <= days) return null;
  const latest = closes.at(-1);
  const base = closes.at(-1 - days);
  return Number.isFinite(latest) && Number.isFinite(base) && base > 0 ? latest / base - 1 : null;
}

function movingAverage(values, period) {
  return values.length >= period ? average(values.slice(-period)) : null;
}

function annualizedVolatility(returns) {
  if (returns.length < 20) return null;
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * TRADING_DAYS);
}

function emptyDiagnostics(now) {
  return {
    assessment: "conditional-risk-screen",
    generatedAt: now.toISOString(),
    modelVersion: "etf-quant-rotation-v2.0",
    weightMode: "equal_assumption",
    missingAmountCount: 0,
    dataReadyCount: 0,
    count: 0,
    summary: { expand: 0, hold: 0, trim: 0, rotate: 0, pending: 0, topTheme: null },
    items: [],
  };
}

function trueCount(record) {
  return Object.values(record).filter(Boolean).length;
}

function countBy(items, picker) {
  return items.reduce((counts, item) => {
    const key = picker(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function mapValues(record, mapper) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapper(value)]));
}

function average(values) {
  const clean = values
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function round(value, decimals = 4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const scale = 10 ** decimals;
  return Math.round(Number(value) * scale) / scale;
}

function formatWeightPercent(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)}%`
    : "-";
}

function formatPercentagePoint(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)}%p`
    : "-";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  adjustCorporateActionRows,
  analyzeHoldingHistory,
  buildHoldingsDiagnostics,
  cappedNormalize,
  percentileRanks,
  scoreDrawdown,
};
