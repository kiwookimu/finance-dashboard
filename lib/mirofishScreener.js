const fs = require("node:fs");
const path = require("node:path");

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

const DEFAULT_MIROFISH_AGENT_PERFORMANCE_PATH = path.join(
  process.cwd(),
  "screen_results",
  "mirofish_agent_performance.json",
);
const MIROFISH_AGENT_IDS = ["macro", "growth", "semiconductor", "korea", "risk"];

function buildMirofishSimulationFromHistories(histories = {}, targetDate, options = {}) {
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

  const agentPerformance = normalizeMirofishAgentPerformance(options.agentPerformance);
  const agents = evolveMirofishAgents(
    applyMirofishAgentPerformance(agentSpecs, agentPerformance)
      .map(buildMirofishAgent)
      .filter(Boolean),
  );
  const weightedScore = agents.reduce((sum, agent) => sum + agent.rawScore * agent.weight, 0);
  const totalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
  const score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;
  const tone = score >= 30 ? "up" : score <= -30 ? "down" : "neutral";
  const consensus = mirofishConsensusMetrics(agents, score);
  return {
    agents,
    agentPerformance: summarizeMirofishAgentPerformance(agentPerformance),
    confidence: consensus.confidence,
    consensusStrength: consensus.consensusStrength,
    disagreement: consensus.disagreement,
    marketAsOf: targetDate,
    roundCount: consensus.roundCount,
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
      weight: 0.55,
    });
  }
  if (Number.isFinite(Number(simulation.consensusStrength))) {
    exposures.push({
      id: "swarm",
      label: "합의 안정성",
      score: clamp(Number(simulation.consensusStrength), -1, 1),
      weight: 0.25,
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
  const confidence = Number.isFinite(Number(simulation.confidence))
    ? clamp(Number(simulation.confidence), 0, 1)
    : NaN;
  const bonus = mirofishSetupBonus(score, confidence);
  return {
    bonus,
    confidence: Number.isFinite(confidence) ? round(confidence, 4) : null,
    consensusStrength: round(simulation.consensusStrength, 4),
    disagreement: round(simulation.disagreement, 4),
    drivers,
    label: score >= 0.35 ? "순풍" : score <= -0.25 ? "역풍" : "중립",
    score: round(score, 4),
    tone: score >= 0.35 ? "tailwind" : score <= -0.25 ? "headwind" : "neutral",
  };
}

function applyMirofishSetupScore(setupScore, fit) {
  const score = Number(setupScore);
  if (!Number.isFinite(score)) return setupScore;
  return clamp(Math.round(score + mirofishSetupBonus(fit?.score, fit?.confidence)), 0, 100);
}

function mirofishSetupBonus(score, confidence = 0.5) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  let base = 0;
  if (value >= 0.45) base = 10;
  else if (value >= 0.25) base = 6;
  else if (value >= 0.1) base = 3;
  else if (value <= -0.45) base = -12;
  else if (value <= -0.25) base = -8;
  else if (value <= -0.1) base = -4;
  if (!base) return 0;
  const cleanConfidence = Number(confidence);
  const multiplier = Number.isFinite(cleanConfidence)
    ? 0.75 + clamp(cleanConfidence, 0, 1) * 0.5
    : 1;
  return Math.round(base * multiplier);
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
    baseScore: rawScore,
    id: spec.id,
    name: spec.name,
    performanceAverageExcess: spec.performance?.averageAlignedExcess ?? null,
    performanceHitRate: spec.performance?.hitRate ?? null,
    performanceObservationCount: spec.performance?.observationCount ?? null,
    performanceWeightMultiplier: spec.performance?.weightMultiplier ?? 1,
    rawScore,
    tone: rawScore >= 0.35 ? "up" : rawScore <= -0.35 ? "down" : "neutral",
    vote: rawScore >= 0.35 ? "상승" : rawScore <= -0.35 ? "하락" : "중립",
    weight: spec.weight,
  };
}

function applyMirofishAgentPerformance(agentSpecs, profile) {
  const agents = profile?.agents || {};
  return agentSpecs.map((spec) => {
    const performance = normalizeMirofishAgentRecord(agents[spec.id]);
    if (!performance) return spec;
    return {
      ...spec,
      performance,
      weight: round(Number(spec.weight) * performance.weightMultiplier, 4),
    };
  });
}

function evolveMirofishAgents(baseAgents) {
  if (!baseAgents.length) return [];
  let agents = baseAgents.map((agent) => ({
    ...agent,
    history: [round(agent.rawScore, 4)],
    influenceScore: 0,
  }));

  for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
    const consensus = weightedAgentScore(agents);
    const leaders = agents
      .slice()
      .sort((a, b) => Math.abs(b.rawScore) * b.weight - Math.abs(a.rawScore) * a.weight)
      .slice(0, 2);
    const leaderScore = weightedAgentScore(leaders);
    agents = agents.map((agent) => {
      const conviction = clamp(Math.abs(agent.baseScore), 0.15, 0.85);
      const peerInfluence = (consensus - agent.rawScore) * (0.18 + (1 - conviction) * 0.1);
      const leaderInfluence = Number.isFinite(leaderScore)
        ? (leaderScore - agent.rawScore) * 0.08
        : 0;
      const selfAnchor = (agent.baseScore - agent.rawScore) * conviction * 0.1;
      const nextScore = clamp(agent.rawScore + peerInfluence + leaderInfluence + selfAnchor, -1, 1);
      return {
        ...agent,
        history: [...agent.history, round(nextScore, 4)],
        influenceScore: nextScore - agent.baseScore,
        rawScore: nextScore,
        tone: nextScore >= 0.35 ? "up" : nextScore <= -0.35 ? "down" : "neutral",
        vote: nextScore >= 0.35 ? "상승" : nextScore <= -0.35 ? "하락" : "중립",
      };
    });
  }

  return agents.map((agent) => ({
    ...agent,
    influenceScore: round(agent.influenceScore, 4),
    stability: round(agentStability(agent.history), 4),
  }));
}

function weightedAgentScore(agents) {
  const validAgents = agents.filter(
    (agent) => Number.isFinite(agent.rawScore) && Number.isFinite(agent.weight),
  );
  const totalWeight = validAgents.reduce((sum, agent) => sum + agent.weight, 0);
  if (!totalWeight) return NaN;
  return validAgents.reduce((sum, agent) => sum + agent.rawScore * agent.weight, 0) / totalWeight;
}

function agentStability(history = []) {
  if (history.length < 2) return 1;
  const maxMove = history.slice(1).reduce((max, value, index) => {
    const previous = history[index];
    return Math.max(max, Math.abs(value - previous));
  }, 0);
  return clamp(1 - maxMove / 0.35, 0, 1);
}

function mirofishConsensusMetrics(agents, score) {
  const consensusScore = Number(score) / 100;
  const disagreement = average(
    agents.map((agent) => Math.abs(Number(agent.rawScore) - consensusScore)),
  );
  const stability = average(agents.map((agent) => Number(agent.stability)));
  const agreement = Number.isFinite(disagreement) ? clamp(1 - disagreement / 0.75, 0, 1) : NaN;
  const directionStrength = clamp(Math.abs(consensusScore) / 0.65, 0, 1);
  return {
    confidence: round(average([agreement, stability, directionStrength * 0.85]), 4),
    consensusStrength: round(average([agreement, directionStrength, stability]), 4),
    disagreement: round(disagreement, 4),
    roundCount: agents.reduce((max, agent) => Math.max(max, agent.history?.length || 0), 0),
  };
}

function mirofishAgentScores(simulation) {
  if (!simulation?.agents?.length) return {};
  return Object.fromEntries(
    simulation.agents.map((agent) => [agent.id, round(Number(agent.rawScore), 4)]),
  );
}

function buildMirofishAgentPerformance(rows = [], options = {}) {
  const horizonKey = options.horizonKey || "next1mReturnExcess";
  const fallbackHorizonKey = options.fallbackHorizonKey || "next1mReturn";
  const minSignal = Number.isFinite(Number(options.minSignal)) ? Number(options.minSignal) : 0.1;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const observations = Object.fromEntries(
    MIROFISH_AGENT_IDS.map((id) => [
      id,
      {
        items: [],
      },
    ]),
  );

  for (const row of rows) {
    const outcome = Number.isFinite(Number(row?.[horizonKey]))
      ? Number(row[horizonKey])
      : Number(row?.[fallbackHorizonKey]);
    if (!Number.isFinite(outcome)) continue;
    const scores =
      row?.mirofishAgentScores && typeof row.mirofishAgentScores === "object"
        ? row.mirofishAgentScores
        : {};
    for (const id of MIROFISH_AGENT_IDS) {
      const score = Number(scores[id]);
      if (!Number.isFinite(score) || Math.abs(score) < minSignal) continue;
      observations[id].items.push({ outcome, score });
    }
  }

  const agents = Object.fromEntries(
    Object.entries(observations).map(([id, stats]) => {
      const record = summarizeMirofishAgentPerformanceItems(stats.items);
      return [id, record];
    }),
  );

  return {
    basis:
      "Agent score is evaluated as a cross-sectional ranker of subsequent 1-month excess return; stronger rank skill increases future agent weight.",
    generatedAt,
    horizonKey,
    minSignal,
    agents,
  };
}

function summarizeMirofishAgentPerformanceItems(items = []) {
  const cleanItems = items.filter(
    (item) => Number.isFinite(item.score) && Number.isFinite(item.outcome),
  );
  const observationCount = cleanItems.length;
  const averageSignal = average(cleanItems.map((item) => Math.abs(item.score)));
  const sorted = cleanItems.slice().sort((a, b) => b.score - a.score);
  const bucketSize = Math.max(3, Math.floor(sorted.length * 0.3));
  const topBucket = sorted.slice(0, bucketSize);
  const bottomBucket = sorted.slice(-bucketSize);
  const topAverage = average(topBucket.map((item) => item.outcome));
  const bottomAverage = average(bottomBucket.map((item) => item.outcome));
  const topBottomExcessSpread =
    Number.isFinite(topAverage) && Number.isFinite(bottomAverage)
      ? topAverage - bottomAverage
      : NaN;
  const pairwise = mirofishPairwiseRankHitRate(cleanItems);
  const weightMultiplier = mirofishPerformanceWeightMultiplier({
    averageAlignedExcess: topBottomExcessSpread,
    hitRate: pairwise.hitRate,
    observationCount,
  });

  return {
    averageAlignedExcess: round(topBottomExcessSpread, 2),
    averageSignal: round(averageSignal, 4),
    hitRate: round(pairwise.hitRate, 1),
    observationCount: round(observationCount, 1),
    pairCount: pairwise.pairCount,
    topBottomExcessSpread: round(topBottomExcessSpread, 2),
    weightMultiplier,
  };
}

function mirofishPairwiseRankHitRate(items = []) {
  let hitCount = 0;
  let pairCount = 0;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const scoreDiff = items[leftIndex].score - items[rightIndex].score;
      const outcomeDiff = items[leftIndex].outcome - items[rightIndex].outcome;
      if (Math.abs(scoreDiff) < 0.04 || Math.abs(outcomeDiff) < 0.5) continue;
      pairCount += 1;
      if (scoreDiff * outcomeDiff > 0) hitCount += 1;
    }
  }
  return {
    hitRate: pairCount ? (hitCount / pairCount) * 100 : null,
    pairCount,
  };
}

function loadMirofishAgentPerformance(filePath = DEFAULT_MIROFISH_AGENT_PERFORMANCE_PATH) {
  try {
    return normalizeMirofishAgentPerformance(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
  } catch {
    return null;
  }
}

function normalizeMirofishAgentPerformance(profile) {
  if (!profile || typeof profile !== "object") return null;
  const sourceAgents = profile.agents || profile.agentPerformance?.agents;
  if (!sourceAgents || typeof sourceAgents !== "object") return null;
  const agents = {};
  for (const id of MIROFISH_AGENT_IDS) {
    const record = normalizeMirofishAgentRecord(sourceAgents[id]);
    if (record) agents[id] = record;
  }
  return Object.keys(agents).length
    ? {
        basis: profile.basis || profile.agentPerformance?.basis || "",
        generatedAt: profile.generatedAt || profile.agentPerformance?.generatedAt || "",
        horizonKey: profile.horizonKey || profile.agentPerformance?.horizonKey || "",
        minSignal: Number(profile.minSignal ?? profile.agentPerformance?.minSignal) || 0.1,
        agents,
      }
    : null;
}

function normalizeMirofishAgentRecord(record) {
  if (!record || typeof record !== "object") return null;
  const observationCount = Number(record.observationCount);
  const hitRate = Number(record.hitRate);
  const averageAlignedExcess = Number(record.averageAlignedExcess);
  const averageSignal = Number(record.averageSignal);
  const pairCount = Number(record.pairCount);
  const topBottomExcessSpread = Number(record.topBottomExcessSpread);
  const weightMultiplier = Number.isFinite(Number(record.weightMultiplier))
    ? clamp(Number(record.weightMultiplier), 0.82, 1.22)
    : mirofishPerformanceWeightMultiplier({
        averageAlignedExcess,
        hitRate,
        observationCount,
      });
  if (!Number.isFinite(weightMultiplier)) return null;
  return {
    averageAlignedExcess: round(averageAlignedExcess, 2),
    averageSignal: round(averageSignal, 4),
    hitRate: round(hitRate, 1),
    observationCount: round(observationCount, 1),
    pairCount: round(pairCount, 0),
    topBottomExcessSpread: round(topBottomExcessSpread, 2),
    weightMultiplier: round(weightMultiplier, 4),
  };
}

function summarizeMirofishAgentPerformance(profile) {
  if (!profile?.agents) return null;
  return {
    generatedAt: profile.generatedAt || "",
    horizonKey: profile.horizonKey || "",
    agents: Object.fromEntries(
      Object.entries(profile.agents).map(([id, record]) => [
        id,
        {
          hitRate: record.hitRate,
          observationCount: record.observationCount,
          weightMultiplier: record.weightMultiplier,
        },
      ]),
    ),
  };
}

function mirofishPerformanceWeightMultiplier({
  averageAlignedExcess,
  hitRate,
  observationCount,
}) {
  const count = Number(observationCount);
  if (!Number.isFinite(count) || count < 8) return 1;
  const hitSkill = Number.isFinite(hitRate) ? (hitRate - 50) / 25 : 0;
  const excessSkill = Number.isFinite(averageAlignedExcess) ? averageAlignedExcess / 12 : 0;
  const skill = clamp(average([hitSkill, excessSkill]), -1, 1);
  const reliability = clamp((count - 8) / 40, 0, 1);
  return round(clamp(1 + skill * reliability * 0.22, 0.82, 1.22), 4);
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
  buildMirofishAgentPerformance,
  buildMirofishSimulationFromHistories,
  loadMirofishAgentPerformance,
  mirofishAgentScores,
  scoreRecommendationWithMirofish,
};
