function selectLatestRecommendationSnapshot(snapshotModules) {
  return Object.values(snapshotModules || {})
    .map((value) => value?.default || value)
    .filter((value) => value && typeof value === "object")
    .sort((left, right) => recommendationSnapshotTime(right) - recommendationSnapshotTime(left))[0] || null;
}

function recommendationSnapshotTime(payload) {
  const generatedAt = new Date(payload?.generatedAt || "").getTime();
  if (Number.isFinite(generatedAt)) return generatedAt;
  const marketMonth = new Date(`${payload?.marketMonth || ""}-01T00:00:00Z`).getTime();
  return Number.isFinite(marketMonth) ? marketMonth : 0;
}

function withSitesRecommendationMetadata(payload, { refreshRequested = false } = {}) {
  return {
    ...payload,
    refreshBlocked: Boolean(refreshRequested),
    refreshMessage: "추천 데이터는 검증된 저장본을 배포할 때 갱신됩니다.",
    refreshMode: "bundled-snapshot",
    refreshSupported: false,
    servedAt: new Date().toISOString(),
  };
}

function createSitesRecommendationProgress(market) {
  return {
    completed: 0,
    detail: "추천 데이터는 검증된 저장본을 표시하고 있습니다.",
    elapsedSeconds: 0,
    market,
    message: "저장 데이터 기준",
    percent: 0,
    refreshSupported: false,
    startedAt: "",
    state: "idle",
    total: 0,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  createSitesRecommendationProgress,
  selectLatestRecommendationSnapshot,
  withSitesRecommendationMetadata,
};
