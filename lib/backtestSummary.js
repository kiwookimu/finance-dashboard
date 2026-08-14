const fs = require("node:fs/promises");
const path = require("node:path");
const { summarizeIndexValidation } = require("./indexValidation.js");
const { summarizeRecommendationValidation } = require("./recommendationValidation.js");
const { wilsonPercentInterval } = require("./statistics.js");

async function getBacktestSummary({ root }) {
  const screenResultsDir = path.join(root, "screen_results");
  const files = await fs.readdir(screenResultsDir).catch(() => []);
  const recommendationFile =
    pickWidestDatedFile(
      files,
      /^backtest_monthly_recommendations_both_\d{4}-\d{2}_\d{4}-\d{2}\.json$/,
    ) ||
    pickWidestDatedFile(
    files,
    /^backtest_monthly_recommendations_(?:both|kr|us)_\d{4}-\d{2}_\d{4}-\d{2}\.json$/,
    );
  const indexFile = pickWidestDatedFile(
    files,
    /^backtest_index_predictions_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/,
  );

  const validationLedger = await readJson(
    path.join(root, "validation", "recommendation-forward-validation.json"),
  ).catch(() => null);
  const [recommendation, index] = await Promise.all([
    recommendationFile
      ? readRecommendationSummary(
          path.join(screenResultsDir, recommendationFile),
          recommendationFile,
          validationLedger,
        )
      : null,
    indexFile ? readIndexSummary(path.join(screenResultsDir, indexFile), indexFile) : null,
  ]);

  const sourceGeneratedAt = latestIsoDate(
    recommendation?.generatedAt,
    index?.generatedAt,
  );
  return {
    generatedAt: sourceGeneratedAt,
    servedAt: new Date().toISOString(),
    sourceGeneratedAt,
    caveat:
      "공개 데이터 재현 기준입니다. 상장폐지 종목, 정확한 과거 시총, 과거 컨센서스는 완전히 복원하지 못할 수 있습니다.",
    index,
    recommendation,
  };
}

function pickWidestDatedFile(files, pattern) {
  return files
    .filter((file) => pattern.test(file))
    .map((file) => ({ file, ...fileDateRange(file) }))
    .sort(
      (left, right) =>
        right.spanDays - left.spanDays ||
        right.end.localeCompare(left.end) ||
        right.start.localeCompare(left.start) ||
        right.file.localeCompare(left.file),
    )[0]?.file || "";
}

function fileDateRange(file) {
  const matches = String(file).match(/(\d{4}-\d{2}(?:-\d{2})?)/g) || [];
  const start = normalizeRangeDate(matches.at(-2), false);
  const end = normalizeRangeDate(matches.at(-1), true);
  const spanDays = Math.max(0, (Date.parse(end) - Date.parse(start)) / 86_400_000);
  return { end, spanDays, start };
}

function normalizeRangeDate(value, endOfMonth) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value;
  if (!/^\d{4}-\d{2}$/.test(value || "")) return "0000-01-01";
  if (!endOfMonth) return `${value}-01`;
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function latestIsoDate(...values) {
  return values
    .filter((value) => Number.isFinite(Date.parse(value || "")))
    .sort()
    .at(-1) || "";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readRecommendationSummary(filePath, fileName, validationLedger) {
  const payload = await readJson(filePath);
  const summary = payload.summary || {};
  const rows = [
    recommendationCard("전체", "추천+관찰 전체", summary["전체"]),
    recommendationCard("국내 추천", "확정 후보", summary["kr:confirmed"] || summary.kr),
    recommendationCard("국내 관찰", "조기 관찰", summary["kr:watch"] || summary["kr:observe"]),
    recommendationCard("미국 추천", "확정 후보", summary["us:confirmed"] || summary.us),
    recommendationCard("미국 관찰", "조기 관찰", summary["us:watch"] || summary["us:observe"]),
  ].filter(Boolean);

  return {
    fileName,
    generatedAt: payload.generatedAt || "",
    range: payload.range || null,
    rows,
    validation: summarizeRecommendationValidation(payload, validationLedger),
    validationStatus:
      "기술 신호 회고검증이며, 규칙 확정 후 전향 성과는 수집 중입니다.",
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
  const validation = summarizeIndexValidation(payload.rows || []);
  const rows = [
    indexCard("KOSPI", byIndex.kospi, validation.byIndex?.kospi),
    indexCard("NASDAQ", byIndex.nasdaq, validation.byIndex?.nasdaq),
    indexCard("S&P 500", byIndex.sp500, validation.byIndex?.sp500),
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
    validation,
  };
}

function indexCard(label, item, validation) {
  if (!item) return null;
  const observations = finiteOrNull(item.observations);
  const hitRate = finiteOrNull(item.hitRate);
  const interval = wilsonPercentInterval(hitRate, observations);
  return {
    coverage: finiteOrNull(item.coverage),
    hitRate,
    hitRateLower: interval?.lower ?? null,
    hitRateUpper: interval?.upper ?? null,
    label,
    observations,
    worstYearHitRate: validation?.worstYearHitRate ?? null,
    yearly: validation?.yearly || [],
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  getBacktestSummary,
  pickWidestDatedFile,
  wilsonPercentInterval,
};
