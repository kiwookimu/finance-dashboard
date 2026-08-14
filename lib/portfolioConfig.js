const crypto = require("node:crypto");
const source = require("../portfolio-holdings.json");

function canonicalPortfolioPayload(payload = source) {
  return {
    asOf: String(payload.asOf || ""),
    holdings: (payload.holdings || []).map((holding) => ({
      amount: Number(holding.amount) || 0,
      benchmark: String(holding.benchmark || ""),
      code: String(holding.code || ""),
      id: String(holding.id || ""),
      name: String(holding.name || ""),
      tags: Array.isArray(holding.tags) ? holding.tags.map(String) : [],
    })),
    version: Number(payload.version) || 1,
  };
}

function portfolioHash(payload = source) {
  const canonical = canonicalPortfolioPayload(payload);
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")}`;
}

function getPortfolioConfig(payload = source) {
  const canonical = canonicalPortfolioPayload(payload);
  return {
    ...canonical,
    investedCount: canonical.holdings.filter((holding) => holding.amount > 0).length,
    portfolioHash: portfolioHash(canonical),
    totalAmount: canonical.holdings.reduce((sum, holding) => sum + holding.amount, 0),
  };
}

module.exports = {
  canonicalPortfolioPayload,
  getPortfolioConfig,
  portfolioHash,
};
