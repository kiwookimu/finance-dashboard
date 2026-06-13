const fs = require("node:fs/promises");
const path = require("node:path");

async function getBacktestSummary({ root }) {
  const screenResultsDir = path.join(root, "screen_results");
  const files = await fs.readdir(screenResultsDir).catch(() => []);
  const recommendationFile =
    pickLatestFile(
      files,
      /^backtest_monthly_recommendations_both_\d{4}-\d{2}_\d{4}-\d{2}\.json$/,
    ) ||
    pickLatestFile(
    files,
    /^backtest_monthly_recommendations_(?:both|kr|us)_\d{4}-\d{2}_\d{4}-\d{2}\.json$/,
    );
  const indexFile = pickLatestFile(
    files,
    /^backtest_index_predictions_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/,
  );

  const [recommendation, index] = await Promise.all([
    recommendationFile
      ? readRecommendationSummary(path.join(screenResultsDir, recommendationFile), recommendationFile)
      : null,
    indexFile ? readIndexSummary(path.join(screenResultsDir, indexFile), indexFile) : null,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    caveat:
      "공개 데이터 재현 기준입니다. 상장폐지 종목, 정확한 과거 시총, 과거 컨센서스는 완전히 복원하지 못할 수 있습니다.",
    index,
    recommendation,
  };
}

function pickLatestFile(files, pattern) {
  return files.filter((file) => pattern.test(file)).sort().at(-1) || "";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readRecommendationSummary(filePath, fileName) {
  const payload = await readJson(filePath);
  const summary = payload.summary || {};
  const rows = [
    recommendationCard("전체", "추천+관찰 전체", summary["전체"]),
    recommendationCard("국내 추천", "확정 후보", summary["kr:confirmed"] || summary.kr),
    recommendationCard("국내 관찰", "조기 관찰", summary["kr:observe"]),
    recommendationCard("미국 추천", "확정 후보", summary["us:confirmed"] || summary.us),
    recommendationCard("미국 관찰", "조기 관찰", summary["us:observe"]),
  ].filter(Boolean);

  return {
    fileName,
    generatedAt: payload.generatedAt || "",
    range: payload.range || null,
    rows,
  };
}

function recommendationCard(label, subtitle, item) {
  if (!item || !Number.isFinite(Number(item.count))) return null;
  const oneMonth = item.horizons?.["1개월"] || {};
  const threeMonth = item.horizons?.["3개월"] || {};
  return {
    count: Number(item.count),
    label,
    oneMonthAverage: finiteOrNull(oneMonth.average),
    oneMonthHitRate: finiteOrNull(oneMonth.hitRate),
    oneMonthSample: finiteOrNull(oneMonth.sample),
    subtitle,
    threeMonthAverage: finiteOrNull(threeMonth.average),
    threeMonthHitRate: finiteOrNull(threeMonth.hitRate),
    threeMonthSample: finiteOrNull(threeMonth.sample),
  };
}

async function readIndexSummary(filePath, fileName) {
  const payload = await readJson(filePath);
  const highConfidence = payload.summary?.highConfidenceRules || {};
  const byIndex = highConfidence.byIndex || {};
  const rows = [
    indexCard("KOSPI", byIndex.kospi),
    indexCard("NASDAQ", byIndex.nasdaq),
    indexCard("S&P 500", byIndex.sp500),
  ].filter(Boolean);

  return {
    fileName,
    generatedAt: payload.generatedAt || "",
    range: payload.range || null,
    rows,
    total: highConfidence.all
      ? {
          coverage: finiteOrNull(highConfidence.all.coverage),
          hitRate: finiteOrNull(highConfidence.all.hitRate),
          observations: finiteOrNull(highConfidence.all.observations),
        }
      : null,
  };
}

function indexCard(label, item) {
  if (!item) return null;
  return {
    coverage: finiteOrNull(item.coverage),
    hitRate: finiteOrNull(item.hitRate),
    label,
    observations: finiteOrNull(item.observations),
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = { getBacktestSummary };
