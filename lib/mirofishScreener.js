const MIROFISH_MARKET_SYMBOLS = {
  kospi: "^KS11",
  kosdaq: "^KQ11",
  nasdaq: "^IXIC",
  sp500: "^GSPC",
  sox: "^SOX",
  nikkei: "^N225",
  vix: "^VIX",
  vix3m: "^VIX3M",
  us10y: "^TNX",
  usdKrw: "KRW=X",
  wti: "CL=F",
  qqq: "QQQ",
  qqqe: "QQQE",
  spy: "SPY",
  rsp: "RSP",
};

function buildMirofishSimulationFromHistories(histories = {}, targetDate) {
  const quotes = Object.fromEntries(
    Object.keys(MIROFISH_MARKET_SYMBOLS).map((id) => [
      id,
      quoteAtOrBefore(histories[id], targetDate),
    ]),
  );
  quotes.nasdaqBreadth = relativeQuote(quotes.qqqe, quotes.qqq);
  quotes.sp500Breadth = relativeQuote(quotes.rsp, quotes.spy);
  quotes.semiLeadership = relativeQuote(quotes.sox, quotes.qqq || quotes.nasdaq);
  quotes.semiBreadth = quoteFromScores([
    scoreRiskAsset(quotes.sox),
    scoreRelativeBreadth(quotes.semiLeadership),
  ]);

  const vixTermQuote = vixTermSpread(quotes.vix3m, quotes.vix);
  const agentSpecs = [
    {
      id: "macro",
      name: "매크로",
      weight: 1,
      components: [
        { score: scoreYield(quotes.us10y), weight: 0.9 },
        { score: scoreUsdKrw(quotes.usdKrw), weight: 0.7 },
        { score: scoreWti(quotes.wti), weight: 0.45 },
        { score: scoreVixTermStructure(vixTermQuote), weight: 0.75 },
      ],
    },
    {
      id: "growth",
      name: "성장주",
      weight: 1.15,
      components: [
        { score: scoreRiskAsset(quotes.nasdaq), weight: 0.95 },
        { score: scoreRiskAsset(quotes.sp500), weight: 0.65 },
        { score: scoreRelativeBreadth(quotes.nasdaqBreadth), weight: 0.85 },
        { score: scoreVix(quotes.vix), weight: 0.7 },
        { score: scoreVixTermStructure(vixTermQuote), weight: 0.45 },
      ],
    },
    {
      id: "semiconductor",
      name: "반도체",
      weight: 1.2,
      components: [
        { score: scoreRiskAsset(quotes.sox), weight: 1 },
        { score: scoreRelativeBreadth(quotes.semiLeadership), weight: 0.75 },
        { score: scoreRiskAsset(quotes.nasdaq), weight: 0.35 },
        { score: scoreVix(quotes.vix), weight: 0.35 },
      ],
    },
    {
      id: "korea",
      name: "한국 위험선호",
      weight: 0.95,
      components: [
        { score: scoreRiskAsset(quotes.kospi), weight: 0.9 },
        { score: scoreRiskAsset(quotes.kosdaq), weight: 0.65 },
        { score: scoreOneDayMove(quotes.nikkei), weight: 0.55 },
        { score: scoreUsdKrw(quotes.usdKrw), weight: 0.55 },
        {
          score: average([
            scoreOneDayMove(quotes.nasdaq),
            scoreOneDayMove(quotes.sp500),
          ]),
          weight: 0.5,
        },
      ],
    },
    {
      id: "risk",
      name: "리스크",
      weight: 1.05,
      components: [
        { score: scoreVix(quotes.vix), weight: 0.95 },
        { score: scoreMarketRegime(quotes, vixTermQuote), weight: 0.9 },
        { score: scoreMarketBreadth(quotes), weight: 0.8 },
        { score: scoreVixTermStructure(vixTermQuote), weight: 0.6 },
      ],
    },
  ];

  const agents = agentSpecs.map(buildMirofishAgent).filter(Boolean);
  const weightedScore = agents.reduce((sum, agent) => sum + agent.rawScore * agent.weight, 0);
  const totalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
  const score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;
  const tone = score >= 30 ? "up" : score <= -30 ? "down" : "neutral";
  return {
    agents,
    marketAsOf: targetDate,
    score,
    tone,
  };
}

function scoreRecommendationWithMirofish(item, options = {}) {
  const simulation = options.simulation;
  if (!simulation?.agents?.length) return null;
  const baseMarket = options.baseMarket || "domestic";
  const agentById = new Map(simulation.agents.map((agent) => [agent.id, agent]));
  const exposures = [];
  const addAgent = (id, weight, label) => {
    const agent = agentById.get(id);
    const cleanWeight = Number(weight);
    if (!agent || !Number.isFinite(agent.rawScore) || !Number.isFinite(cleanWeight)) return;
    exposures.push({
      id,
      label: label || agent.name,
      score: clamp(agent.rawScore, -1, 1),
      weight: cleanWeight,
    });
  };

  const text = [
    item?.name,
    item?.businessDescription,
    item?.companyDescription,
    item?.description,
    item?.sector,
    item?.industry,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const isDomestic = baseMarket === "domestic" || /^\d{6}$/.test(String(item?.code || ""));

  addAgent(isDomestic ? "korea" : "growth", 0.9, isDomestic ? "한국 위험선호" : "미국 성장주");
  addAgent("risk", 0.35, "리스크");

  if (/(반도체|hbm|ddr|dram|nand|메모리|semiconductor|chip|memory|micron|마이크론|sandisk|샌디스크|nvidia|엔비디아)/i.test(text)) {
    addAgent("semiconductor", 1.15, "반도체");
    addAgent("growth", 0.45, "성장주");
  }
  if (/(ai|인공지능|전력|전력인프라|데이터센터|전자|전기|전자부품|mlcc|콘덴서|capacitor|component|electronics|cloud|software|cyber|quantum|network|통신|광통신|로봇|robot)/i.test(text)) {
    addAgent("growth", 0.85, "성장주");
  }
  if (/(자동차|전기차|battery|배터리|2차전지|ev|mobility)/i.test(text)) {
    addAgent("korea", isDomestic ? 0.55 : 0.25, "국내 순환매");
    addAgent("growth", 0.35, "성장주");
  }
  if (/(금융|은행|보험|증권|카드|캐피탈|financial|bank|insurance|capital)/i.test(text)) {
    addAgent("macro", 0.75, "매크로");
    addAgent("risk", 0.45, "리스크");
  }
  if (/(에너지|정유|석유|가스|oil|gas|energy|화학|chemical)/i.test(text)) {
    addAgent("macro", 0.65, "매크로");
  }

  if (Number.isFinite(Number(simulation.score))) {
    exposures.push({
      id: "consensus",
      label: "전체 합의",
      score: clamp(Number(simulation.score) / 100, -1, 1),
      weight: 0.45,
    });
  }

  const totalWeight = exposures.reduce((sum, exposure) => sum + exposure.weight, 0);
  if (!totalWeight) return null;
  const score =
    exposures.reduce((sum, exposure) => sum + exposure.score * exposure.weight, 0) /
    totalWeight;
  const drivers = exposures
    .filter((exposure) => Math.abs(exposure.score) >= 0.1)
    .sort((a, b) => Math.abs(b.score) * b.weight - Math.abs(a.score) * a.weight)
    .slice(0, 2)
    .map((exposure) => exposure.label);
  const bonus = mirofishSetupBonus(score);
  return {
    bonus,
    drivers,
    label: score >= 0.35 ? "순풍" : score <= -0.25 ? "역풍" : "중립",
    score: round(score, 4),
    tone: score >= 0.35 ? "tailwind" : score <= -0.25 ? "headwind" : "neutral",
  };
}

function applyMirofishSetupScore(setupScore, fit) {
  const score = Number(setupScore);
  if (!Number.isFinite(score)) return setupScore;
  return clamp(Math.round(score + mirofishSetupBonus(fit?.score)), 0, 100);
}

function mirofishSetupBonus(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  if (value >= 0.45) return 10;
  if (value >= 0.25) return 6;
  if (value >= 0.1) return 3;
  if (value <= -0.45) return -12;
  if (value <= -0.25) return -8;
  if (value <= -0.1) return -4;
  return 0;
}

function quoteAtOrBefore(rows = [], targetDate) {
  const sortedRows = Array.isArray(rows)
    ? rows.filter((row) => row?.date && Number.isFinite(Number(row.close)))
    : [];
  let index = sortedRows.length - 1;
  while (index >= 0 && sortedRows[index].date > targetDate) index -= 1;
  if (index < 0) return null;
  const row = sortedRows[index];
  const previous = sortedRows[index - 1];
  const fiveBack = sortedRows[Math.max(0, index - 5)];
  const twentyBack = sortedRows[Math.max(0, index - 20)];
  return {
    date: row.date,
    price: Number(row.close),
    changePercent: previous ? percentChange(row.close, previous.close) : NaN,
    momentum5: fiveBack ? percentChange(row.close, fiveBack.close) : NaN,
    momentum20: twentyBack ? percentChange(row.close, twentyBack.close) : NaN,
  };
}

function relativeQuote(numerator, denominator) {
  if (!numerator || !denominator) return null;
  return {
    changePercent: finiteDiff(numerator.changePercent, denominator.changePercent),
    momentum20: finiteDiff(numerator.momentum20, denominator.momentum20),
    price: finiteDiff(numerator.momentum20, denominator.momentum20),
  };
}

function quoteFromScores(scores) {
  const score = average(scores);
  if (!Number.isFinite(score)) return null;
  return {
    changePercent: score * 2,
    momentum20: score * 8,
    price: score * 10,
  };
}

function vixTermSpread(vix3m, vix) {
  const spread = finiteDiff(vix3m?.price, vix?.price);
  if (!Number.isFinite(spread)) return null;
  return { price: spread };
}

function buildMirofishAgent(spec) {
  const components = spec.components
    .map((component) => ({
      score: Number(component.score),
      weight: Number(component.weight),
    }))
    .filter((component) => Number.isFinite(component.score) && Number.isFinite(component.weight));
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  if (!totalWeight) return null;
  const rawScore =
    components.reduce(
      (sum, component) => sum + clamp(component.score, -1, 1) * component.weight,
      0,
    ) / totalWeight;
  return {
    id: spec.id,
    name: spec.name,
    rawScore,
    tone: rawScore >= 0.35 ? "up" : rawScore <= -0.35 ? "down" : "neutral",
    vote: rawScore >= 0.35 ? "상승" : rawScore <= -0.35 ? "하락" : "중립",
    weight: spec.weight,
  };
}

function scoreRiskAsset(quote) {
  if (!quote) return NaN;
  return average([
    normalize(quote.changePercent, 2.2),
    normalize(quote.momentum5, 5),
    normalize(quote.momentum20, 8),
  ]);
}

function scoreOneDayMove(quote) {
  return quote ? normalize(quote.changePercent, 2.2) : NaN;
}

function scoreRelativeBreadth(quote) {
  if (!quote) return NaN;
  return average([normalize(quote.price, 8), normalize(quote.momentum20, 8)]);
}

function scoreVix(quote) {
  if (!quote) return NaN;
  const level = Number(quote.price);
  const levelScore = Number.isFinite(level) ? clamp((22 - level) / 10, -1, 1) : NaN;
  return average([levelScore, -normalize(quote.changePercent, 8)]);
}

function scoreVixTermStructure(quote) {
  return quote ? normalize(quote.price, 5) : NaN;
}

function scoreYield(quote) {
  if (!quote) return NaN;
  const rawYield = Number(quote.price);
  const yieldPercent = rawYield > 15 ? rawYield / 10 : rawYield;
  const levelScore = Number.isFinite(yieldPercent)
    ? clamp((4.4 - yieldPercent) / 1.2, -1, 1)
    : NaN;
  return average([levelScore, -normalize(quote.changePercent, 1.2)]);
}

function scoreUsdKrw(quote) {
  return quote ? -average([normalize(quote.changePercent, 1.5), normalize(quote.momentum5, 3)]) : NaN;
}

function scoreWti(quote) {
  return quote ? -average([normalize(quote.changePercent, 3), normalize(quote.momentum5, 8)]) : NaN;
}

function scoreMarketRegime(quotes, vixTermQuote) {
  return average([
    scoreRiskAsset(quotes.sp500),
    scoreRiskAsset(quotes.nasdaq),
    scoreRiskAsset(quotes.kospi),
    scoreVix(quotes.vix),
    scoreVixTermStructure(vixTermQuote),
  ]);
}

function scoreMarketBreadth(quotes) {
  return average([
    scoreRelativeBreadth(quotes.nasdaqBreadth),
    scoreRelativeBreadth(quotes.sp500Breadth),
    scoreRelativeBreadth(quotes.semiLeadership),
  ]);
}

function normalize(value, scale) {
  const number = Number(value);
  const divisor = Number(scale);
  if (!Number.isFinite(number) || !Number.isFinite(divisor) || divisor === 0) return NaN;
  return clamp(number / divisor, -1, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percentChange(current, previous) {
  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber) || previousNumber === 0) {
    return NaN;
  }
  return ((currentNumber - previousNumber) / previousNumber) * 100;
}

function finiteDiff(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : NaN;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

module.exports = {
  MIROFISH_MARKET_SYMBOLS,
  applyMirofishSetupScore,
  buildMirofishSimulationFromHistories,
  scoreRecommendationWithMirofish,
};
