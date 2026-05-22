const GOOD_WHEN_FALLING = new Set(["usdKrw", "wti", "us10y", "hySpread", "nfci"]);
const PORTFOLIO_HOLDINGS = [
  { amount: 30041571, name: "HANARO Fn K-반도체", tags: ["semi", "korea"] },
  { amount: 30003498, name: "KODEX AI전력핵심설비", tags: ["aiPower", "korea"] },
  { amount: 15064300, name: "PLUS 글로벌 HBM반도체", tags: ["semi", "global"] },
  { amount: 15032675, name: "TIGER 미국필라델피아반도체", tags: ["semi", "us"] },
  { amount: 15005736, name: "RISE 삼성전자SK하이닉스채권혼합", tags: ["semi", "bondMix", "korea"] },
  { amount: 15005730, name: "TIME 미국나스닥100채권혼합", tags: ["nasdaq", "bondMix", "us"] },
  { amount: 15002399, name: "KODEX 200 미국채혼합", tags: ["kospi", "bondMix", "korea"] },
  { amount: 10010605, name: "TIME 글로벌AI인공지능액티브", tags: ["aiPower", "global"] },
];
const PORTFOLIO_TOTAL = PORTFOLIO_HOLDINGS.reduce(
  (sum, holding) => sum + holding.amount,
  0,
);

loadIndicators();

async function loadIndicators() {
  try {
    const [marketResponse, sentimentResponse, portfolioResponse] = await Promise.all([
      fetch("/api/market-overview", { cache: "no-store" }),
      fetch("/api/market-sentiment", { cache: "no-store" }),
      fetch("/api/portfolio-metrics", { cache: "no-store" }).catch(() => null),
    ]);

    if (!marketResponse.ok || !sentimentResponse.ok) {
      throw new Error("Market data request failed");
    }

    const market = await marketResponse.json();
    const sentiment = await sentimentResponse.json();
    const portfolioMetrics = portfolioResponse?.ok
      ? await portfolioResponse.json()
      : null;

    renderMarketIndicator("kospi", market.quotes.kospi);
    renderMarketIndicator("sp500", market.quotes.sp500);
    renderMarketIndicator("nasdaq", market.quotes.nasdaq);
    renderMarketIndicator("sox", market.quotes.sox);
    renderMarketIndicator("ddr5Spot", market.quotes.ddr5Spot);
    renderMarketIndicator("serverDdr5Contract", market.quotes.serverDdr5Contract);
    renderMarketIndicator("dxi", market.quotes.dxi);
    renderMarketIndicator("usdKrw", market.quotes.usdKrw);
    renderMarketIndicator("wti", market.quotes.wti);
    renderMarketIndicator("us10y", market.quotes.us10y);
    renderMarketIndicator("hySpread", market.quotes.hySpread);
    renderMarketIndicator("nfci", market.quotes.nfci);
    renderFearGreed(sentiment.fearGreed);
    renderVix(sentiment.vix);
    renderTradingSignal(market.quotes, sentiment);
    renderPortfolioSignal(market.quotes, sentiment, portfolioMetrics);
    renderTimestamp(market.quotes);
    setText(
      "#marketSource",
      `Yahoo Finance · FRED · Naver Finance · TrendForce · DRAMeXchange · 공포·탐욕 ${formatIsoDate(sentiment.fearGreed.date)} · VIX ${formatIsoDate(sentiment.vix.date)} 기준 지연 데이터`,
    );
  } catch (error) {
    console.warn("Indicator data unavailable", error);
    renderSignalState({
      action: "판단 보류",
      className: "signal-hold",
      score: 0,
      summary: "데이터 갱신 실패",
    });
    renderPortfolioState({
      action: "판단 보류",
      checks: [],
      className: "portfolio-hold",
      score: 0,
      summary: "데이터 갱신 실패",
    });
    setText("#marketSource", "시장 데이터 갱신 실패");
  }
}

function renderTradingSignal(quotes, sentiment) {
  const signal = evaluateTradingSignal(quotes || {}, sentiment || {});
  renderSignalState(signal);
}

function renderSignalState({ action, className, confidence, score, summary }) {
  const panel = document.querySelector("#marketSignal");
  if (!panel) return;

  panel.classList.remove("signal-buy", "signal-hold", "signal-sell");
  panel.classList.add(className);
  panel.setAttribute("aria-label", `시장 신호: ${action}`);
  setText("#signalAction", action);
  setText(
    "#signalSummary",
    `${formatSignedScore(score)}점 · ${confidence || signalConfidence(className, score)} · ${summary}`,
  );
}

function renderPortfolioSignal(quotes, sentiment, portfolioMetrics) {
  renderPortfolioSnapshot();
  renderPortfolioState(
    evaluatePortfolioSignal(quotes || {}, sentiment || {}, portfolioMetrics),
  );
}

function renderPortfolioSnapshot() {
  setText("#portfolioSemiWeight", formatPercent(portfolioTagWeight("semi")));
  setText("#portfolioAiWeight", formatPercent(portfolioTagWeight("aiPower")));
  setText("#portfolioBondMixWeight", formatPercent(portfolioTagWeight("bondMix")));
}

function renderPortfolioState({ action, checks, className, confidence, score, summary }) {
  const panel = document.querySelector("#portfolioSignal");
  if (!panel) return;

  panel.classList.remove("portfolio-buy", "portfolio-hold", "portfolio-trim");
  panel.classList.add(className);
  panel.setAttribute("aria-label", `보유 포트폴리오 신호: ${action}`);
  setText("#portfolioAction", action);
  setText("#portfolioScore", `${formatSignedScore(score)}점`);
  setText("#portfolioSummary", `${confidence || signalConfidence(className, score)} · ${summary}`);

  const checksElement = document.querySelector("#portfolioChecks");
  if (!checksElement) return;
  checksElement.innerHTML = checks
    .map(
      (check) =>
        `<span class="${check.tone}"><b>${escapeHtml(check.label)}</b>${escapeHtml(check.text)}</span>`,
    )
    .join("");
}

function evaluateTradingSignal(quotes, sentiment) {
  const components = [];
  const add = (label, score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({
      label,
      score: clamp(score, -1, 1),
      weight,
      weighted: clamp(score, -1, 1) * weight,
    });
  };

  const broadScores = [
    scoreRiskAsset(quotes.sp500),
    scoreRiskAsset(quotes.nasdaq),
    scoreRiskAsset(quotes.kospi),
  ].filter(Number.isFinite);
  const broadScore = average(broadScores);
  const broadMomentumScore = average([
    scoreMultiPeriodMomentum(quotes.sp500),
    scoreMultiPeriodMomentum(quotes.nasdaq),
    scoreMultiPeriodMomentum(quotes.kospi),
  ]);
  const semiconductorCycleScore = scoreSemiconductorCycle(quotes);
  const variancePremiumScore = scoreVarianceRiskPremium(quotes, sentiment);

  add("주가지수", broadScore, 1.7);
  add("중기 모멘텀", broadMomentumScore, 1.1);
  add("반도체 사이클", semiconductorCycleScore, 1.35);
  add("DDR5", scoreMemoryPrice(quotes.ddr5Spot), 0.45);
  add("서버 DRAM", scoreServerContract(quotes.serverDdr5Contract), 0.25);
  add("공포·탐욕", scoreFearGreed(sentiment.fearGreed), 1.15);
  add("VIX", scoreVix(sentiment.vix), 1.05);
  add("변동성 프리미엄", variancePremiumScore, 0.9);
  add("미국 10년물", scoreYield(quotes.us10y), 0.85);
  add("달러/원", scoreUsdKrw(quotes.usdKrw), 0.65);
  add("WTI", scoreWti(quotes.wti), 0.45);
  add("시장 레짐", scoreMarketRegime(quotes), 1.25);
  const recoveryScore = scoreRecoveryPulse(quotes, sentiment);
  add("반등 확인", recoveryScore, 0.75);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = components.reduce((sum, item) => sum + item.weighted, 0);
  const score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;
  const vixLevel = Number(sentiment.vix?.close);
  const hasRecovery = Number.isFinite(recoveryScore) && recoveryScore >= 0.35;
  const recoveryForAction = Number.isFinite(recoveryScore) ? recoveryScore : -1;

  let action = "홀딩";
  let className = "signal-hold";
  if (
    (vixLevel >= 35 && recoveryForAction < -0.5) ||
    score <= -55 ||
    (score <= -32 && recoveryForAction < -0.45) ||
    (score <= -22 && recoveryForAction < -0.65)
  ) {
    action = "매도";
    className = "signal-sell";
  } else if (score >= 25 && broadScore > 0 && vixLevel < 28 && (hasRecovery || vixLevel < 25)) {
    action = "신규 매수";
    className = "signal-buy";
  }

  return {
    action,
    className,
    confidence: signalConfidence(className, score),
    score,
    summary: summarizeSignal(components, className),
  };
}

function evaluatePortfolioSignal(quotes, sentiment, portfolioMetrics) {
  const components = [];
  const add = (label, score, weight) => {
    if (!Number.isFinite(score)) return;
    const cleanScore = clamp(score, -1, 1);
    components.push({
      label,
      score: cleanScore,
      weight,
      weighted: cleanScore * weight,
    });
  };

  const semiScore = scoreRiskAsset(quotes.sox);
  const nasdaqScore = scoreRiskAsset(quotes.nasdaq);
  const kospiScore = scoreRiskAsset(quotes.kospi);
  const rateScore = scoreYield(quotes.us10y);
  const usdKrwScore = scoreUsdKrw(quotes.usdKrw);
  const vixScore = scoreVix(sentiment.vix);
  const relativeScore = scorePortfolioRelativeStrength(portfolioMetrics, quotes);
  const multiRelativeScore = scorePortfolioMultiPeriodRelativeStrength(portfolioMetrics, quotes);
  const movingAverageScore = scorePortfolioMovingAverage(portfolioMetrics);
  const investorFlowScore = scorePortfolioInvestorFlow(portfolioMetrics);
  const regimeScore = scoreMarketRegime(quotes);
  const recoveryScore = scoreRecoveryPulse(quotes, sentiment, portfolioMetrics);
  const semiconductorCycleScore = scoreSemiconductorCycle(quotes);
  const variancePremiumScore = scoreVarianceRiskPremium(quotes, sentiment);

  add("SOX", semiScore, 2.4);
  add("NASDAQ", nasdaqScore, 1.25);
  add("KOSPI", kospiScore, 0.75);
  add("상대강도", relativeScore, 1.35);
  add("장기 상대강도", multiRelativeScore, 1.1);
  add("50/200일선", movingAverageScore, 1.15);
  add("외국인·기관", investorFlowScore, 0.9);
  add("시장 레짐", regimeScore, 1.35);
  add("반도체 사이클", semiconductorCycleScore, 1.25);
  add("DDR5", scoreMemoryPrice(quotes.ddr5Spot), 0.95);
  add("서버 DRAM", scoreServerContract(quotes.serverDdr5Contract), 0.35);
  add("미국 10년물", rateScore, 1.2);
  add("달러/원", usdKrwScore, 0.85);
  add("VIX", vixScore, 1.05);
  add("변동성 프리미엄", variancePremiumScore, 0.85);
  add("공포·탐욕", scoreFearGreed(sentiment.fearGreed), 0.65);
  add("WTI", scoreWti(quotes.wti), 0.2);
  add("반등 확인", recoveryScore, 0.8);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = components.reduce((sum, item) => sum + item.weighted, 0);
  let score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;

  const vixLevel = Number(sentiment.vix?.close);
  const concentration = portfolioTagWeight("semi") + portfolioTagWeight("aiPower");
  if (concentration >= 75 && (semiScore < 0 || nasdaqScore < 0)) score -= 8;
  const hasRecovery = Number.isFinite(recoveryScore) && recoveryScore >= 0.35;
  const recoveryForPenalty = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  const recoveryForAction = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  if (vixLevel >= 25 && recoveryForPenalty < 0.25) score -= 8;
  if (vixLevel >= 25 && hasRecovery) score += 4;
  if (rateScore < -0.35 && semiScore < 0.2) score -= 6;
  if (relativeScore < -0.25 && movingAverageScore < 0) score -= 6;
  if (multiRelativeScore < -0.35 && semiconductorCycleScore < 0) score -= 5;
  if (variancePremiumScore < -0.55 && recoveryForPenalty < 0.25) score -= 4;
  if (investorFlowScore < -0.25 && semiScore < 0.25) score -= 4;
  if (semiconductorCycleScore > 0.45 && scoreMemoryPrice(quotes.ddr5Spot) > 0) score += 4;
  score = clamp(Math.round(score), -100, 100);

  let action = "보유";
  let className = "portfolio-hold";
  if (
    (vixLevel >= 35 && recoveryForAction < -0.5) ||
    score <= -60 ||
    (score <= -35 && recoveryForAction < -0.5) ||
    (score <= -24 && recoveryForAction < -0.65)
  ) {
    action = "비중 축소";
    className = "portfolio-trim";
  } else if (
    score >= 30 &&
    semiScore > 0 &&
    semiconductorCycleScore > -0.2 &&
    regimeScore > -0.25 &&
    rateScore > -0.35 &&
    vixLevel < 28 &&
    (!Number.isFinite(variancePremiumScore) || variancePremiumScore > -0.6) &&
    (!Number.isFinite(recoveryScore) || recoveryScore > -0.2)
  ) {
    action = "분할 매수";
    className = "portfolio-buy";
  }

  return {
    action,
    checks: buildPortfolioChecks({
      semiconductorCycleScore,
      investorFlowScore,
      multiRelativeScore,
      movingAverageScore,
      nasdaqScore,
      rateScore,
      recoveryScore,
      regimeScore,
      relativeScore,
      variancePremiumScore,
      semiScore,
      vixScore,
    }),
    className,
    confidence: signalConfidence(className, score),
    score,
    summary: summarizePortfolioSignal(components, className, concentration),
  };
}

function summarizeSignal(components, className) {
  const positives = components
    .filter((item) => item.weighted > 0.08)
    .sort((a, b) => b.weighted - a.weighted)
    .map((item) => `${item.label} 양호`);
  const negatives = components
    .filter((item) => item.weighted < -0.08)
    .sort((a, b) => a.weighted - b.weighted)
    .map((item) => `${item.label} 부담`);

  if (className === "signal-sell") {
    return (negatives.length ? negatives : ["위험 신호 우세"]).slice(0, 2).join(" · ");
  }

  if (className === "signal-buy") {
    return (positives.length ? positives : ["위험자산 우세"]).slice(0, 2).join(" · ");
  }

  return [...positives.slice(0, 1), ...negatives.slice(0, 1)].join(" · ") || "중립 구간";
}

function summarizePortfolioSignal(components, className, concentration) {
  const positives = components
    .filter((item) => item.weighted > 0.09)
    .sort((a, b) => b.weighted - a.weighted)
    .map((item) => `${item.label} 양호`);
  const negatives = components
    .filter((item) => item.weighted < -0.09)
    .sort((a, b) => a.weighted - b.weighted)
    .map((item) => `${item.label} 부담`);
  const concentrationText = `반도체·AI 노출 ${formatPercent(concentration)}`;

  if (className === "portfolio-trim") {
    return `${(negatives.length ? negatives : ["위험 신호 우세"]).slice(0, 2).join(" · ")} · ${concentrationText}`;
  }

  if (className === "portfolio-buy") {
    return `${(positives.length ? positives : ["성장주 환경 양호"]).slice(0, 2).join(" · ")} · 분할 접근`;
  }

  return `${[...positives.slice(0, 1), ...negatives.slice(0, 1)].join(" · ") || "중립 구간"} · ${concentrationText}`;
}

function buildPortfolioChecks({
  investorFlowScore,
  multiRelativeScore,
  movingAverageScore,
  nasdaqScore,
  rateScore,
  recoveryScore,
  regimeScore,
  relativeScore,
  semiconductorCycleScore,
  semiScore,
  variancePremiumScore,
  vixScore,
}) {
  return [
    portfolioCheck("상대강도", relativeScore, "벤치마크 대비"),
    portfolioCheck("장기상대", multiRelativeScore, "1/3/6/12개월"),
    portfolioCheck("50/200일선", movingAverageScore, "추세 확인"),
    portfolioCheck("외국인·기관", investorFlowScore, "수급 확인"),
    portfolioCheck("시장레짐", regimeScore, "신용·금융상황"),
    portfolioCheck("반도체", semiconductorCycleScore, "사이클 확인"),
    portfolioCheck("반등확인", recoveryScore, "재진입 확인"),
    portfolioCheck("SOX", semiScore, "반도체 ETF 핵심"),
    portfolioCheck("NASDAQ", nasdaqScore, "AI 성장주"),
    portfolioCheck("VRP", variancePremiumScore, "변동성 프리미엄"),
    portfolioCheck("금리", rateScore, "채권혼합·성장주"),
    portfolioCheck("VIX", vixScore, "변동성"),
  ];
}

function portfolioCheck(label, score, fallback) {
  if (!Number.isFinite(score)) {
    return { label, text: fallback, tone: "neutral" };
  }
  if (score >= 0.25) {
    return { label, text: "양호", tone: "good" };
  }
  if (score <= -0.25) {
    return { label, text: "부담", tone: "bad" };
  }
  return { label, text: "중립", tone: "neutral" };
}

function renderMarketIndicator(id, quote) {
  if (!quote) return;

  const decimals = Number.isFinite(quote.decimals) ? quote.decimals : 2;
  const hasNumericPrice = Number.isFinite(quote.price);
  const change = Number.isFinite(quote.change) ? quote.change : 0;
  const changePercent = Number.isFinite(quote.changePercent) ? quote.changePercent : 0;
  const trendInverts = GOOD_WHEN_FALLING.has(id);
  const valueText = quote.valueText || (
    hasNumericPrice
      ? `${quote.valuePrefix || ""}${formatNumber(quote.price, decimals)}${quote.valueSuffix || ""}`
      : "비공개"
  );
  const changeValue = `${change >= 0 ? "+" : ""}${change.toFixed(decimals)}${quote.changeUnit || ""}`;
  const changeText = quote.changeText
    ? quote.changeText
    : quote.changeUnit
      ? changeValue
      : `${changeValue} · ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
  const changeClass = quote.changeClass || getDirectionalClass(change, trendInverts);

  renderIndicator({
    changeClass,
    changeSelector: `#${id}Change`,
    changeText,
    decimals,
    rowSelector: `[data-indicator="${id}"]`,
    series: quote.history,
    sparklineSelector: `#${id}Sparkline`,
    sparklineText: quote.sparklineText,
    trendInverts,
    value: quote.price,
    valueText,
    valueSelector: `#${id}Value`,
  });
}

function renderFearGreed(data) {
  const score = clamp(data.score, 0, 100);
  const label = getKoreanFearGreedRating(data.rating || getFearGreedRating(score));
  const change = Number(data.change || 0);
  const changeText = `${label} · ${change >= 0 ? "+" : ""}${change.toFixed(1)}p`;
  const changeClass = change >= 0 ? "positive" : "negative";

  renderIndicator({
    changeClass,
    changeSelector: "#fearGreedChange",
    changeText,
    decimals: 0,
    rowSelector: '[data-indicator="fearGreed"]',
    series: data.series,
    sparklineSelector: "#fearGreedSparkline",
    value: score,
    valueSelector: "#fearGreedValue",
  });
}

function renderVix(data) {
  const change = Number(data.change || 0);
  const changeText = `${change >= 0 ? "+" : ""}${change.toFixed(2)} · ${getVixTone(data.close)}`;
  const changeClass = change > 0 ? "negative" : change < 0 ? "positive" : "";

  renderIndicator({
    changeClass,
    changeSelector: "#vixChange",
    changeText,
    decimals: 1,
    rowSelector: '[data-indicator="vix"]',
    series: data.series,
    sparklineSelector: "#vixSparkline",
    trendInverts: true,
    value: data.close,
    valueSelector: "#vixValue",
  });
}

function renderIndicator({
  changeClass,
  changeSelector,
  changeText,
  decimals,
  rowSelector,
  series,
  sparklineSelector,
  sparklineText,
  trendInverts = false,
  value,
  valueText,
  valueSelector,
}) {
  setText(valueSelector, valueText || formatNumber(value, decimals));
  setText(changeSelector, changeText);
  setClass(changeSelector, ["positive", "negative"], changeClass);
  renderSparkline(sparklineSelector, series || [], sparklineText);

  const row = document.querySelector(rowSelector);
  if (!row) return;

  const first = series?.[0]?.value;
  const last = series?.at(-1)?.value;
  const direction =
    Number.isFinite(first) && Number.isFinite(last)
      ? Math.sign(last - first)
      : 0;
  const className =
    direction === 0 ? "flat" : direction > 0 !== trendInverts ? "up" : "down";
  row.classList.remove("up", "down", "flat");
  row.classList.add(className);
}

function renderSparkline(selector, series, fallbackText = "현재값만 공개") {
  const svg = document.querySelector(selector);
  if (!svg) return;

  const points = series
    .map((point) => Number(point.value))
    .filter((value) => Number.isFinite(value));

  if (points.length < 2) {
    svg.innerHTML = `<text x="66" y="29" text-anchor="middle">${escapeHtml(fallbackText)}</text>`;
    return;
  }

  const width = 132;
  const height = 52;
  const pad = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const coordinates = points.map((point, index) => {
    const x = pad + step * index;
    const y = height - pad - ((point - min) / spread) * (height - pad * 2);
    return [x, y];
  });
  const line = coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${coordinates.at(-1)[0].toFixed(2)} ${height - pad} L${coordinates[0][0].toFixed(2)} ${height - pad} Z`;
  const [lastX, lastY] = coordinates.at(-1);

  svg.innerHTML = `
    <path class="area" d="${area}"></path>
    <path class="line" d="${line}"></path>
    <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="3"></circle>
  `;
}

function renderTimestamp(quotes) {
  const latestIso = Object.values(quotes || {})
    .map((quote) => quote.marketTime)
    .filter(Boolean)
    .sort()
    .at(-1);

  setText("#marketTimestamp", latestIso ? formatTime(latestIso) : "지연");
}

function scoreRiskAsset(quote) {
  const trend = trendPercent(quote?.history);
  if (!Number.isFinite(trend)) return NaN;

  let score = scoreTrendPercent(trend);
  const daily = Number(quote.changePercent);
  if (daily >= 1) score += 0.15;
  if (daily <= -1) score -= 0.15;
  return clamp(score, -1, 1);
}

function scoreMultiPeriodMomentum(quote) {
  const series = quote?.analysisHistory || quote?.history;
  const periods = [
    { days: 21, threshold: 4, weight: 0.25 },
    { days: 63, threshold: 8, weight: 0.3 },
    { days: 126, threshold: 14, weight: 0.25 },
    { days: 252, threshold: 22, weight: 0.2 },
  ];
  const scores = periods
    .map(({ days, threshold, weight }) => {
      const trend = trendPercentOverPeriod(series, days);
      return Number.isFinite(trend)
        ? { score: clamp(trend / threshold, -1, 1), weight }
        : null;
    })
    .filter(Boolean);
  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? scores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreRelativeMomentum(assetQuote, benchmarkQuote) {
  const assetSeries = assetQuote?.analysisHistory || assetQuote?.history;
  const benchmarkSeries = benchmarkQuote?.analysisHistory || benchmarkQuote?.history;
  const periods = [
    { days: 21, threshold: 3, weight: 0.25 },
    { days: 63, threshold: 6, weight: 0.3 },
    { days: 126, threshold: 9, weight: 0.25 },
    { days: 252, threshold: 14, weight: 0.2 },
  ];
  const scores = periods
    .map(({ days, threshold, weight }) => {
      const assetTrend = trendPercentOverPeriod(assetSeries, days);
      const benchmarkTrend = trendPercentOverPeriod(benchmarkSeries, days);
      if (!Number.isFinite(assetTrend) || !Number.isFinite(benchmarkTrend)) return null;
      return { score: clamp((assetTrend - benchmarkTrend) / threshold, -1, 1), weight };
    })
    .filter(Boolean);
  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? scores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreVarianceRiskPremium(quotes, sentiment) {
  const vix = Number(sentiment?.vix?.close);
  const realizedVol = realizedVolatility(quotes?.sp500?.analysisHistory || quotes?.sp500?.history, 22);
  if (!Number.isFinite(vix) || !Number.isFinite(realizedVol)) return NaN;

  const premium = vix - realizedVol;
  let score = 0;
  if (premium < 2) score = 0.35;
  else if (premium < 6) score = 0.1;
  else if (premium < 12) score = -0.25;
  else score = -0.65;

  const vixChange = Number(sentiment?.vix?.change);
  if (vixChange <= -2) score += 0.15;
  if (vixChange >= 2) score -= 0.15;
  return clamp(score, -1, 1);
}

function scoreSemiconductorCycle(quotes) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ score: clamp(score, -1, 1), weight });
  };

  add(scoreRiskAsset(quotes?.sox), 1.15);
  add(scoreMultiPeriodMomentum(quotes?.sox), 1.1);
  add(scoreRelativeMomentum(quotes?.sox, quotes?.nasdaq), 0.9);
  add(scoreMemoryPrice(quotes?.ddr5Spot), 0.75);
  add(scoreServerContract(quotes?.serverDdr5Contract), 0.35);
  add(scoreRiskAsset(quotes?.dxi), 0.35);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreMemoryPrice(quote) {
  const change = Number(quote?.changePercent);
  if (!Number.isFinite(change)) return NaN;
  if (change >= 1) return 0.45;
  if (change > 0) return 0.25;
  if (change <= -1) return -0.45;
  if (change < 0) return -0.25;
  return 0;
}

function scoreServerContract(quote) {
  const text = `${quote?.changeText || ""} ${quote?.summary || ""}`.toLowerCase();
  if (!text.trim()) return NaN;
  if (text.includes("상승") || text.includes("bullish") || text.includes("upward")) {
    return 0.25;
  }
  if (text.includes("하락") || text.includes("bearish") || text.includes("downward")) {
    return -0.25;
  }
  return 0;
}

function scoreFearGreed(data) {
  const score = Number(data?.score);
  if (!Number.isFinite(score)) return NaN;

  let result = 0;
  if (score >= 45 && score <= 70) result = 0.8;
  else if (score >= 35 && score < 45) result = 0.25;
  else if (score > 70 && score <= 80) result = 0.1;
  else if (score >= 25 && score < 35) result = -0.4;
  else if (score < 25) result = -0.9;
  else result = -0.6;

  const change = Number(data.change);
  if (change >= 3 && score <= 80) result += 0.1;
  if (change <= -3) result -= 0.1;
  return clamp(result, -1, 1);
}

function scoreVix(data) {
  const value = Number(data?.close);
  if (!Number.isFinite(value)) return NaN;

  let score = 0;
  if (value < 15) score = 0.85;
  else if (value < 20) score = 0.55;
  else if (value < 25) score = 0.05;
  else if (value < 30) score = -0.55;
  else score = -1;

  const trend = trendPercent(data.series);
  if (trend <= -10) score += 0.2;
  if (trend >= 10) score -= 0.2;
  return clamp(score, -1, 1);
}

function scoreYield(quote) {
  const move = pointChange(quote?.history);
  if (!Number.isFinite(move)) return NaN;

  let score = 0;
  if (move <= -0.2) score = 0.6;
  else if (move <= 0.05) score = 0.15;
  else if (move <= 0.2) score = -0.15;
  else score = -0.6;

  const daily = Number(quote.change);
  if (daily <= -0.05) score += 0.1;
  if (daily >= 0.05) score -= 0.1;
  return clamp(score, -1, 1);
}

function scoreUsdKrw(quote) {
  const trend = trendPercent(quote?.history);
  if (!Number.isFinite(trend)) return NaN;

  let score = 0;
  if (trend <= -1) score = 0.5;
  else if (trend <= 0) score = 0.15;
  else if (trend <= 1) score = -0.15;
  else score = -0.5;

  const daily = Number(quote.changePercent);
  if (daily <= -0.5) score += 0.1;
  if (daily >= 0.5) score -= 0.1;
  return clamp(score, -1, 1);
}

function scoreMarketRegime(quotes) {
  return average([
    scoreHySpread(quotes?.hySpread),
    scoreNfci(quotes?.nfci),
  ]);
}

function scoreRecoveryPulse(quotes, sentiment, portfolioMetrics = null) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ score: clamp(score, -1, 1), weight });
  };

  add(scoreVixRelief(sentiment?.vix), 1.2);
  add(scoreCapitulationRelief(quotes, sentiment), 0.75);
  add(scoreRiskAsset(quotes?.sox), 1.1);
  add(scoreRiskAsset(quotes?.nasdaq), 0.95);
  add(scoreRiskAsset(quotes?.sp500), 0.55);
  add(scoreRiskAsset(quotes?.kospi), 0.35);
  add(scoreMarketRegime(quotes), 0.65);

  if (portfolioMetrics) {
    add(scorePortfolioRelativeStrength(portfolioMetrics, quotes), 0.65);
    add(scorePortfolioMovingAverage(portfolioMetrics), 0.45);
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return NaN;
  return components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
}

function scoreVixRelief(data) {
  const value = Number(data?.close);
  const trend = trendPercent(data?.series);
  if (!Number.isFinite(value) || !Number.isFinite(trend)) return NaN;

  let score = 0;
  if (trend <= -15) score = 0.9;
  else if (trend <= -7) score = 0.55;
  else if (trend <= 2) score = 0.1;
  else if (trend <= 10) score = -0.35;
  else score = -0.8;

  if (value < 22 && trend <= 0) score += 0.1;
  if (value >= 32 && trend > -10) score -= 0.2;
  const daily = Number(data.change);
  if (daily <= -4) score += 0.35;
  else if (daily <= -2) score += 0.25;
  else if (daily >= 5) score -= 0.35;
  else if (daily >= 3) score -= 0.25;
  return clamp(score, -1, 1);
}

function scoreCapitulationRelief(quotes, sentiment) {
  const fear = Number(sentiment?.fearGreed?.score);
  const vix = Number(sentiment?.vix?.close);
  if (!Number.isFinite(fear) || !Number.isFinite(vix) || vix < 25 || fear > 35) {
    return NaN;
  }

  const vixChange = Number(sentiment?.vix?.change);
  const dailyRisk = average([
    Number(quotes?.sox?.changePercent),
    Number(quotes?.nasdaq?.changePercent),
    Number(quotes?.kospi?.changePercent),
  ]);

  let score = vix >= 30 && fear <= 25 ? -0.25 : -0.05;
  if (Number.isFinite(vixChange) && vixChange <= -3) score += 0.55;
  else if (Number.isFinite(vixChange) && vixChange <= -1.5) score += 0.35;
  if (Number.isFinite(dailyRisk) && dailyRisk >= 1) score += 0.35;
  else if (Number.isFinite(dailyRisk) && dailyRisk >= 0.3) score += 0.2;
  if (
    vix >= 32 &&
    Number.isFinite(vixChange) &&
    vixChange >= 3 &&
    Number.isFinite(dailyRisk) &&
    dailyRisk <= -1
  ) {
    score -= 0.55;
  }
  return clamp(score, -1, 1);
}

function scoreHySpread(quote) {
  const value = Number(quote?.price);
  if (!Number.isFinite(value)) return NaN;

  let score = 0;
  if (value < 3.5) score = 0.75;
  else if (value < 4.5) score = 0.35;
  else if (value < 5.5) score = -0.15;
  else if (value < 7) score = -0.55;
  else score = -0.95;

  const move = pointChange(quote.history);
  if (move <= -0.3) score += 0.15;
  if (move >= 0.4) score -= 0.2;
  return clamp(score, -1, 1);
}

function scoreNfci(quote) {
  const value = Number(quote?.price);
  if (!Number.isFinite(value)) return NaN;

  let score = 0;
  if (value <= -0.4) score = 0.75;
  else if (value <= -0.15) score = 0.35;
  else if (value <= 0.15) score = -0.05;
  else if (value <= 0.5) score = -0.5;
  else score = -0.9;

  const move = pointChange(quote.history);
  if (move <= -0.05) score += 0.1;
  if (move >= 0.08) score -= 0.15;
  return clamp(score, -1, 1);
}

function scorePortfolioRelativeStrength(portfolioMetrics, quotes) {
  return weightedPortfolioScore(portfolioMetrics, (holding) => {
    const ownTrend = Number(holding.trend28);
    const benchmarkTrend = trendPercent(quotes?.[holding.benchmark]?.history);
    if (!Number.isFinite(ownTrend) || !Number.isFinite(benchmarkTrend)) {
      return NaN;
    }

    const spread = ownTrend - benchmarkTrend;
    if (spread >= 8) return 0.9;
    if (spread >= 3) return 0.55;
    if (spread > -3) return 0.05;
    if (spread > -8) return -0.55;
    return -0.9;
  });
}

function scorePortfolioMultiPeriodRelativeStrength(portfolioMetrics, quotes) {
  return weightedPortfolioScore(portfolioMetrics, (holding) =>
    scoreRelativeMomentum(
      { analysisHistory: holding.analysisHistory, history: holding.history },
      quotes?.[holding.benchmark],
    ),
  );
}

function scorePortfolioMovingAverage(portfolioMetrics) {
  return weightedPortfolioScore(portfolioMetrics, scoreHoldingMovingAverage);
}

function scoreHoldingMovingAverage(holding) {
  const price = Number(holding.latestClose);
  const ma50 = Number(holding.ma50);
  const ma200 = Number(holding.ma200);
  if (!Number.isFinite(price) || !Number.isFinite(ma50)) return NaN;

  if (Number.isFinite(ma200)) {
    if (price > ma50 && price > ma200 && ma50 > ma200) return 0.9;
    if (price > ma50 && price > ma200) return 0.55;
    if (price > ma50) return 0.2;
    if (price < ma200) return -0.8;
    return -0.35;
  }

  return price > ma50 ? 0.35 : -0.35;
}

function scorePortfolioInvestorFlow(portfolioMetrics) {
  return weightedPortfolioScore(portfolioMetrics, (holding) =>
    Number(holding.flow?.score),
  );
}

function scoreWti(quote) {
  const price = Number(quote?.price);
  const trend = trendPercent(quote?.history);
  if (!Number.isFinite(price) && !Number.isFinite(trend)) return NaN;

  let score = 0;
  if (Number.isFinite(price)) {
    if (price < 70) score += 0.2;
    if (price > 85) score -= 0.25;
  }
  if (Number.isFinite(trend)) {
    if (trend <= -8) score += 0.25;
    if (trend >= 8) score -= 0.35;
  }
  return clamp(score, -1, 1);
}

function scoreTrendPercent(percent) {
  if (percent >= 4) return 0.85;
  if (percent >= 1) return 0.45;
  if (percent > -1) return 0.05;
  if (percent > -4) return -0.45;
  return -0.85;
}

function trendPercent(series) {
  const points = numericSeries(series);
  if (points.length < 2 || points[0] === 0) return NaN;
  return ((points.at(-1) - points[0]) / points[0]) * 100;
}

function trendPercentOverPeriod(series, period) {
  const points = numericSeries(series);
  const start = points.at(-period - 1);
  if (points.length < period + 1 || !Number.isFinite(start) || start === 0) return NaN;
  return ((points.at(-1) - start) / start) * 100;
}

function realizedVolatility(series, period) {
  const points = numericSeries(series).slice(-(period + 1));
  if (points.length < period + 1) return NaN;
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1] > 0 && points[index] > 0) {
      returns.push(Math.log(points[index] / points[index - 1]));
    }
  }
  if (returns.length < period) return NaN;
  return standardDeviation(returns) * Math.sqrt(252) * 100;
}

function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return NaN;
  const mean = average(clean);
  const variance = average(clean.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function pointChange(series) {
  const points = numericSeries(series);
  if (points.length < 2) return NaN;
  return points.at(-1) - points[0];
}

function numericSeries(series) {
  return (series || [])
    .map((point) => Number(point.value))
    .filter((value) => Number.isFinite(value));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function weightedPortfolioScore(portfolioMetrics, scoreForHolding) {
  const holdings = portfolioMetrics?.holdings || [];
  const totalAmount = Number(portfolioMetrics?.totalAmount) || PORTFOLIO_TOTAL;
  let weighted = 0;
  let weight = 0;

  for (const holding of holdings) {
    const score = scoreForHolding(holding);
    const holdingWeight = totalAmount ? Number(holding.amount) / totalAmount : 0;
    if (!Number.isFinite(score) || !Number.isFinite(holdingWeight)) continue;
    weighted += clamp(score, -1, 1) * holdingWeight;
    weight += holdingWeight;
  }

  return weight ? weighted / weight : NaN;
}

function portfolioTagWeight(tag) {
  const taggedAmount = PORTFOLIO_HOLDINGS
    .filter((holding) => holding.tags.includes(tag))
    .reduce((sum, holding) => sum + holding.amount, 0);
  return PORTFOLIO_TOTAL ? (taggedAmount / PORTFOLIO_TOTAL) * 100 : 0;
}

function signalConfidence(className, score) {
  const value = Math.abs(Number(score));
  if (className === "signal-buy" || className === "portfolio-buy") {
    return value >= 45 ? "강한 녹색" : "약한 녹색";
  }
  if (className === "signal-sell" || className === "portfolio-trim") {
    return value >= 55 ? "강한 빨간색" : "약한 빨간색";
  }
  if (value <= 12) return "중립";
  return score > 0 ? "녹색 대기" : "위험 경계";
}

function getFearGreedRating(score) {
  if (score < 25) return "extreme fear";
  if (score < 45) return "fear";
  if (score < 55) return "neutral";
  if (score < 75) return "greed";
  return "extreme greed";
}

function getKoreanFearGreedRating(rating) {
  return (
    {
      "extreme fear": "극단적 공포",
      fear: "공포",
      neutral: "중립",
      greed: "탐욕",
      "extreme greed": "극단적 탐욕",
    }[rating.toLowerCase()] || "중립"
  );
}

function getVixTone(value) {
  if (value >= 30) return "고변동성 경계";
  if (value >= 20) return "변동성 주의";
  if (value >= 13) return "보통 변동성";
  return "낮은 변동성";
}

function formatIsoDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${year}.${month}.${day}`;
}

function formatTime(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "지연";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function formatNumber(value, decimals) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function formatSignedScore(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function getDirectionalClass(change, trendInverts = false) {
  if (!Number.isFinite(change) || change === 0) return "";
  const isFavorable = trendInverts ? change < 0 : change > 0;
  return isFavorable ? "positive" : "negative";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function setClass(selector, classes, activeClass) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.classList.remove(...classes);
  if (activeClass) element.classList.add(activeClass);
}
