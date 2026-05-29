const GOOD_WHEN_FALLING = new Set(["usdKrw", "wti", "us10y", "hySpread", "nfci"]);
const PORTFOLIO_HOLDINGS = [
  { amount: 30041571, benchmark: "kospi", code: "395270", id: "hanaroSemi", name: "HANARO Fn K-반도체", tags: ["semi", "korea"] },
  { amount: 30003498, benchmark: "kospi", code: "487240", id: "kodexAiPower", name: "KODEX AI전력핵심설비", tags: ["aiPower", "korea"] },
  { amount: 15064300, benchmark: "sox", code: "442580", id: "plusGlobalHbm", name: "PLUS 글로벌HBM반도체", tags: ["semi", "global"] },
  { amount: 15032675, benchmark: "sox", code: "381180", id: "tigerSox", name: "TIGER 미국필라델피아반도체", tags: ["semi", "us"] },
  { amount: 15005736, benchmark: "kospi", code: "0162Z0", id: "riseSamsungHynixBond", name: "RISE 삼성전자SK하이닉스채권혼합", tags: ["semi", "bondMix", "korea"] },
  { amount: 15005730, benchmark: "nasdaq", code: "0019K0", id: "timeNasdaqBond", name: "TIME 미국나스닥100채권혼합", tags: ["nasdaq", "bondMix", "us"] },
  { amount: 15002399, benchmark: "kospi", code: "284430", id: "kodex200Treasury", name: "KODEX 200미국채혼합", tags: ["kospi", "bondMix", "korea"] },
  { amount: 10010605, benchmark: "nasdaq", code: "456600", id: "timeGlobalAi", name: "TIME 글로벌AI인공지능액티브", tags: ["aiPower", "global"] },
  { amount: 5000440, benchmark: "kospi", code: "466930", id: "solAutoTop3", name: "SOL 자동차TOP3플러스", tags: ["auto", "korea"] },
  { amount: 5006750, benchmark: "nasdaq", code: "0183J0", id: "tigerUsSpaceTech", name: "TIGER 미국우주테크", tags: ["space", "us"] },
  { amount: 0, benchmark: "nasdaq", code: "491010", id: "tigerGlobalAiPowerInfra", name: "TIGER 글로벌AI전력인프라액티브", tags: ["aiPower", "global"] },
  { amount: 0, benchmark: "kospi", code: "367760", id: "riseNetworkInfra", name: "RISE 네트워크인프라", tags: ["network", "korea"] },
];
const PORTFOLIO_TOTAL = PORTFOLIO_HOLDINGS.reduce(
  (sum, holding) => sum + holding.amount,
  0,
);
const PORTFOLIO_HOLDING_META_BY_ID = new Map(
  PORTFOLIO_HOLDINGS.map((holding) => [holding.id, holding]),
);
const PORTFOLIO_HOLDING_META_BY_CODE = new Map(
  PORTFOLIO_HOLDINGS.map((holding) => [holding.code, holding]),
);
const DEFAULT_PORTFOLIO_EXPOSURE_CONFIG = {
  crisis: 0.5,
  crisisCap: 0.65,
  neutral: 0.8,
  riskWatch: 0.75,
  severeCrisis: 0.35,
  strongTrim: 1,
  weakRed: 0.05,
};
const RECOMMENDATION_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const RECOMMENDATION_CONFIGS = {
  domestic: {
    buttonSelector: "#recommendationRefresh",
    conditionSelector: "#recommendationCondition",
    endpoint: "/api/stock-recommendations",
    listSelector: "#recommendationList",
    loadingText: "1개월 후보 계산 중",
    progressEndpoint: "/api/recommendation-refresh-progress?market=domestic",
    progressSelector: "#recommendationProgress",
    refreshText: "최신 후보 갱신 중",
    statusSelector: "#recommendationStatus",
  },
  us: {
    buttonSelector: "#usRecommendationRefresh",
    conditionSelector: "#usRecommendationCondition",
    endpoint: "/api/us-stock-recommendations",
    listSelector: "#usRecommendationList",
    loadingText: "미국 후보 계산 중",
    progressEndpoint: "/api/recommendation-refresh-progress?market=us",
    progressSelector: "#usRecommendationProgress",
    refreshText: "미국 후보 갱신 중",
    statusSelector: "#usRecommendationStatus",
  },
};
const recommendationStates = {
  domestic: {
    loaded: false,
    loading: false,
  },
  us: {
    loaded: false,
    loading: false,
  },
};
const recommendationDetailById = new Map();
let lastRecommendationDetailTrigger = null;

initializeDashboardTabs();
initializeRecommendationActions();
initializeRecommendationDetailModal();
loadIndicators();

function initializeDashboardTabs() {
  const tabs = [...document.querySelectorAll(".dashboard-tab")];
  const panels = [...document.querySelectorAll(".tab-panel")];
  if (!tabs.length || !panels.length) return;

  const activateTab = (selectedTab, shouldFocus = false) => {
    const panelId = selectedTab.getAttribute("aria-controls");
    for (const tab of tabs) {
      const isSelected = tab === selectedTab;
      tab.classList.toggle("is-active", isSelected);
      tab.setAttribute("aria-selected", String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
    }
    for (const panel of panels) {
      const isSelected = panel.id === panelId;
      panel.classList.toggle("is-active", isSelected);
      panel.hidden = !isSelected;
    }
    if (panelId === "recommendationsPanel") loadRecommendations();
    if (panelId === "usRecommendationsPanel") loadRecommendations({ market: "us" });
    if (shouldFocus) selectedTab.focus();
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      const currentIndex = tabs.indexOf(tab);
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activateTab(tabs[nextIndex], true);
    });
  }

  activateTab(tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0]);
}

function initializeRecommendationActions() {
  const refreshButton = document.querySelector("#recommendationRefresh");
  refreshButton?.addEventListener("click", () => loadRecommendations({ force: true }));
  const usRefreshButton = document.querySelector("#usRecommendationRefresh");
  usRefreshButton?.addEventListener("click", () =>
    loadRecommendations({ force: true, market: "us" }),
  );
}

function initializeRecommendationDetailModal() {
  document.querySelectorAll("[data-recommendation-detail-close]").forEach((element) => {
    element.addEventListener("click", closeRecommendationDetail);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRecommendationDetail();
  });
}

async function loadRecommendations({ force = false, market = "domestic" } = {}) {
  const config = RECOMMENDATION_CONFIGS[market] || RECOMMENDATION_CONFIGS.domestic;
  const state = recommendationStates[market] || recommendationStates.domestic;
  if (state.loading) return;
  if (force) {
    await refreshRecommendations(config, state);
    return;
  }
  if (state.loaded && !force) {
    await resumeRecommendationRefreshIfRunning(config, state);
    return;
  }

  state.loading = true;
  setRecommendationButtonBusy(config, true);
  renderRecommendationLoading(config, state, false);
  try {
    const response = await fetch(config.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Stock recommendation request failed");
    const payload = await response.json();
    renderRecommendations(payload, config);
    state.loaded = true;
    await resumeRecommendationRefreshIfRunning(config, state);
  } catch (error) {
    console.warn("Stock recommendations unavailable", error);
    renderRecommendationError(config);
  } finally {
    state.loading = false;
    setRecommendationButtonBusy(config, false);
  }
}

async function resumeRecommendationRefreshIfRunning(config, state) {
  const progress = await fetchRecommendationProgress(config).catch(() => null);
  if (progress?.state !== "running") return false;

  state.loading = true;
  setRecommendationButtonBusy(config, true);
  renderRecommendationLoading(config, state, true);
  renderRecommendationProgress(config, progress);
  try {
    const finalProgress = await waitForRecommendationRefresh(config);
    if (finalProgress.state === "failed") {
      throw new Error(finalProgress.detail || "Stock recommendation refresh failed");
    }
    const response = await fetch(config.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Stock recommendation request failed");
    renderRecommendations(await response.json(), config);
    state.loaded = true;
    return true;
  } catch (error) {
    console.warn("Stock recommendations unavailable", error);
    renderRecommendationError(config);
    return false;
  } finally {
    state.loading = false;
    setRecommendationButtonBusy(config, false);
  }
}

async function refreshRecommendations(config, state) {
  state.loading = true;
  setRecommendationButtonBusy(config, true);
  renderRecommendationLoading(config, state, true);
  try {
    const startResponse = await fetch(`${config.endpoint}?refresh=1&async=1`, {
      cache: "no-store",
    });
    if (!startResponse.ok) throw new Error("Stock recommendation refresh failed");
    const startPayload = await startResponse.json();
    if (startPayload?.refreshBlocked) {
      renderRecommendations(startPayload, config);
      state.loaded = true;
      return;
    }

    const finalProgress = await waitForRecommendationRefresh(config);
    if (finalProgress.state === "failed") {
      throw new Error(finalProgress.detail || "Stock recommendation refresh failed");
    }

    renderRecommendationProgress(config, {
      detail: "새 후보 목록을 화면에 반영합니다.",
      message: "갱신 완료",
      percent: 100,
      state: "succeeded",
    });
    const response = await fetch(config.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Stock recommendation request failed");
    renderRecommendations(await response.json(), config);
    state.loaded = true;
  } catch (error) {
    console.warn("Stock recommendations unavailable", error);
    renderRecommendationError(config);
  } finally {
    state.loading = false;
    setRecommendationButtonBusy(config, false);
  }
}

function renderRecommendationLoading(config, state, force) {
  setText(
    config.statusSelector,
    force ? config.refreshText : config.loadingText,
  );
  if (force) setRecommendationRefreshVisibility(config, false);
  const list = document.querySelector(config.listSelector);
  if (force) {
    renderRecommendationProgress(config, {
      detail: "스크리너를 실행하고 후보군을 다시 계산합니다.",
      message: "갱신 요청 중",
      percent: 3,
      state: "running",
    });
  } else {
    hideRecommendationProgress(config);
  }
  const hasRenderedCards = Boolean(list?.querySelector(".recommendation-card"));
  if (list && (!state.loaded || force) && !hasRenderedCards) {
    list.innerHTML = `<p class="recommendation-empty">후보 계산 중</p>`;
  }
  list?.classList.toggle("is-refreshing", Boolean(force && hasRenderedCards));
}

function renderRecommendationError(config) {
  setText(config.statusSelector, "후보 갱신 실패");
  setRecommendationRefreshVisibility(config, true);
  renderRecommendationProgress(config, {
    detail: "네트워크 또는 데이터 소스 응답 문제로 갱신하지 못했습니다.",
    message: "갱신 실패",
    percent: 100,
    state: "failed",
  });
  const list = document.querySelector(config.listSelector);
  if (list) {
    list.innerHTML = `<p class="recommendation-empty">데이터 갱신 실패</p>`;
    list.classList.remove("is-refreshing");
  }
}

async function waitForRecommendationRefresh(config) {
  const startedAt = Date.now();
  let failureCount = 0;

  while (Date.now() - startedAt < 20 * 60 * 1000) {
    try {
      const progress = await fetchRecommendationProgress(config);
      failureCount = 0;
      renderRecommendationProgress(config, progress);
      if (["succeeded", "failed"].includes(progress.state)) {
        return progress;
      }
    } catch (error) {
      failureCount += 1;
      if (failureCount >= 2) {
        renderRecommendationProgress(config, {
          detail: "서버 진행 상태를 읽는 중입니다. 계산 요청은 계속 유지됩니다.",
          message: "진행 상태 확인 중",
          percent: 12,
          state: "running",
        });
      }
    }
    await delay(1200);
  }

  throw new Error("Recommendation refresh progress timed out");
}

async function fetchRecommendationProgress(config) {
  const response = await fetch(config.progressEndpoint, { cache: "no-store" });
  if (!response.ok) throw new Error("Progress request failed");
  return response.json();
}

function renderRecommendationProgress(config, progress) {
  const element = document.querySelector(config.progressSelector);
  if (!element) return;

  const percent = clamp(Math.round(Number(progress?.percent) || 0), 0, 100);
  const completed = Number(progress?.completed);
  const total = Number(progress?.total);
  const checkedText =
    Number.isFinite(completed) && completed > 0 && Number.isFinite(total) && total > 0
      ? `${completed.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}개`
      : "";
  const elapsedText = Number(progress?.elapsedSeconds)
    ? `${Number(progress.elapsedSeconds).toLocaleString("ko-KR")}초 경과`
    : "";
  const detailText = progress?.detail || checkedText;
  const detail = [detailText, elapsedText].filter(Boolean).join(" · ");

  element.hidden = false;
  element.dataset.state = progress?.state || "running";
  element.style.setProperty("--recommendation-progress", `${percent}%`);
  element.querySelector(".recommendation-progress-title").textContent =
    progress?.message || "후보 계산 중";
  element.querySelector(".recommendation-progress-percent").textContent = `${percent}%`;
  element.querySelector(".recommendation-progress-detail").textContent =
    detail || "진행 상태를 확인하는 중입니다.";
}

function hideRecommendationProgress(config) {
  const element = document.querySelector(config.progressSelector);
  if (!element) return;
  element.hidden = true;
  element.dataset.state = "idle";
  element.style.setProperty("--recommendation-progress", "0%");
}

function setRecommendationButtonBusy(config, isBusy) {
  const button = document.querySelector(config.buttonSelector);
  if (!button) return;
  button.disabled = isBusy;
  button.setAttribute("aria-busy", String(isBusy));
}

function setRecommendationRefreshVisibility(config, isVisible) {
  const button = document.querySelector(config.buttonSelector);
  if (!button) return;
  button.hidden = !isVisible;
  button.setAttribute("aria-hidden", String(!isVisible));
}

function renderRecommendations(payload, config = RECOMMENDATION_CONFIGS.domestic) {
  const rawResults = payload?.logicOutdated
    ? []
    : (payload?.results || payload?.topResults || []).filter(
        (item) => !item.recommendationInvalidated,
      );
  const results = rawResults
    .map((item) => ({
      item,
      priorityScore: recommendationPriorityScore(item),
    }))
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        Number(b.item.relativeReturn) - Number(a.item.relativeReturn) ||
        Number(b.item.volumeRatio) - Number(a.item.volumeRatio),
    )
    .slice(0, 12);
  const matchCount = payload?.logicOutdated
    ? 0
    : Number(payload?.matchCount ?? rawResults.length);
  const generatedAtText = formatDateTime(payload?.generatedAt);
  const invalidatedCount = Number(payload?.invalidatedCount);
  const showCurrentStatus = !payload?.logicOutdated;
  const showInvalidatedCount = !payload?.logicOutdated && invalidatedCount > 0;
  const showMatchCount =
    !payload?.logicOutdated && Number.isFinite(matchCount) && matchCount > 0;
  const statusParts = [
    showCurrentStatus ? payload?.marketMonth : "",
    showCurrentStatus ? generatedAtText : "",
    showMatchCount ? `${matchCount}개` : "",
    showInvalidatedCount ? `무효화 ${invalidatedCount}개 제외` : "",
    payload?.refreshed ? "갱신됨" : "",
    recommendationCooldownText(payload),
  ].filter(Boolean);
  setText(
    config.statusSelector,
    statusParts.join(" · ") || (payload?.logicOutdated ? "" : "후보 없음"),
  );
  hideRecommendationProgress(config);
  setRecommendationRefreshVisibility(config, canRefreshRecommendations(payload));
  setText(
    config.conditionSelector,
    [
      formatMarketFilter(payload?.condition?.marketFilter),
      formatMarketCapCondition(payload?.condition?.minimumMarketCapKrw),
      `21일 거래량 ${formatConditionNumber(payload?.condition?.volumeRatio)}`,
      payload?.condition?.recentVolumeRatio
        ? `5일 거래량 ${formatConditionNumber(payload.condition.recentVolumeRatio)}`
        : "",
      `MFI ${formatConditionNumber(payload?.condition?.dailyMfi)}`,
      formatDrawdownCondition(payload?.condition?.monthHighDrawdown),
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const list = document.querySelector(config.listSelector);
  if (!list) return;
  list.classList.remove("is-refreshing");
  const detailPrefix = config.listSelector.replace(/\W/g, "");
  for (const key of recommendationDetailById.keys()) {
    if (key.startsWith(`${detailPrefix}-`)) recommendationDetailById.delete(key);
  }

  if (!results.length) {
    list.innerHTML = `<p class="recommendation-empty">${
      payload?.logicOutdated ? "새 기준으로 다시 계산해 주세요" : "조건 충족 종목 없음"
    }</p>`;
    return;
  }

  list.innerHTML = results
    .map(({ item, priorityScore }, index) => {
      const ticker = item.code || item.symbol || item.rawSymbol;
      const setup = buildRecommendationSetup(item);
      const detailId = `${detailPrefix}-${index}`;
      recommendationDetailById.set(detailId, { item, priorityScore, setup });
      const marketCapText = formatKoreanMarketCap(item.marketCapKrw);
      const detail = [
        item.marketType || item.exchange,
        ticker,
        marketCapText !== "-" ? marketCapText : "",
      ].filter(Boolean);
      const reason = [
        `상대강도 ${formatSignedNumber(Number(item.relativeReturn), 1)}%p`,
        `21일 거래량 ${formatNumber(Number(item.volumeRatio), 2)}배`,
        Number.isFinite(Number(item.recentVolumeRatio))
          ? `5일 거래량 ${formatNumber(Number(item.recentVolumeRatio), 2)}배`
          : "",
        `MFI ${formatNumber(Number(item.mfi), 1)}`,
        Number.isFinite(Number(item.monthHighDrawdown))
          ? `고점낙폭 ${formatSignedNumber(Number(item.monthHighDrawdown), 1)}%`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="recommendation-card" role="button" tabindex="0" data-recommendation-detail-id="${escapeHtml(detailId)}" aria-label="${escapeHtml(item.name)} 상세 정보 보기">
          <span class="recommendation-rank">${index + 1}</span>
          <div class="recommendation-copy">
            <div class="recommendation-title">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.signal || "1개월 상승 후보")}</span>
            </div>
            <small>${escapeHtml(detail.join(" · "))}</small>
            <div class="recommendation-metrics" aria-label="${escapeHtml(item.name)} 핵심 지표">
              <span><b>${formatSignedNumber(Number(item.monthlyReturn), 1)}%</b><em>1개월</em></span>
              <span><b>${formatNumber(Number(item.volumeRatio), 2)}x</b><em>21일 거래량</em></span>
            </div>
            <p>${escapeHtml(reason)}</p>
          </div>
          <span class="recommendation-score">우선 ${priorityScore}점</span>
          <div class="recommendation-insight">
            <span>${escapeHtml(setup.label)}</span>
            <p>${escapeHtml(setup.summary)}</p>
            <div class="recommendation-tags">
              ${setup.tags.map((tag) => `<b>${escapeHtml(tag)}</b>`).join("")}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  bindRecommendationDetailCards(list);
}

function bindRecommendationDetailCards(list) {
  list.querySelectorAll(".recommendation-card[data-recommendation-detail-id]").forEach((card) => {
    const open = () => {
      lastRecommendationDetailTrigger = card;
      openRecommendationDetail(card.dataset.recommendationDetailId);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  });
}

function openRecommendationDetail(detailId) {
  const detail = recommendationDetailById.get(detailId);
  const modal = document.querySelector("#recommendationDetailModal");
  const title = document.querySelector("#recommendationDetailTitle");
  const signal = document.querySelector("#recommendationDetailSignal");
  const body = document.querySelector("#recommendationDetailBody");
  if (!detail || !modal || !title || !signal || !body) return;

  const { item, priorityScore, setup } = detail;
  title.textContent = item.name || "추천주 상세";
  signal.textContent = item.signal || "1개월 상승 후보";
  body.innerHTML = buildRecommendationDetailMarkup(item, priorityScore, setup);
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".recommendation-modal-close")?.focus();
}

function closeRecommendationDetail() {
  const modal = document.querySelector("#recommendationDetailModal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  lastRecommendationDetailTrigger?.focus?.();
  lastRecommendationDetailTrigger = null;
}

function buildRecommendationDetailMarkup(item, priorityScore, setup) {
  const ticker = item.code || item.symbol || item.rawSymbol || "-";
  const externalUrl = recommendationExternalUrl(item);
  const marketCapText = formatKoreanMarketCap(item.marketCapKrw);
  const detailRows = [
    ["시장", [item.marketType || item.exchange, ticker].filter(Boolean).join(" · ")],
    ["시가총액", marketCapText],
    ["추천 기준일", formatIsoDate(item.lastDate || "") || "-"],
    ["종가", formatRecommendationPrice(item.lastClose, item)],
    ["21거래일 전 종가", formatRecommendationPrice(item.previousMonthClose, item)],
    ["직전 21일 종가 고점", formatRecommendationPrice(item.previousCloseHigh, item)],
    ["최근 21일 고점", formatRecommendationPrice(item.monthHigh, item)],
    ["최근 21일 고점 대비", formatRecommendationPercent(item.monthHighDrawdown)],
    ["최근 21일 상승률", formatRecommendationPercent(item.monthlyReturn)],
    ["시장 대비 상대강도", `${formatSignedNumber(Number(item.relativeReturn), 1)}%p`],
    ["21일 거래량 배수", `${formatNumber(Number(item.volumeRatio), 2)}x`],
    Number.isFinite(Number(item.recentVolumeRatio))
      ? ["5일 거래량 배수", `${formatNumber(Number(item.recentVolumeRatio), 2)}x`]
      : null,
    ["MFI", formatNumber(Number(item.mfi), 1)],
    ["최근 21일 거래량", formatInteger(item.targetMonthVolume)],
    ["직전 5개 21일 평균 거래량", formatInteger(item.previousAverageVolume)],
    ["최근 최악 일간 수익률", formatRecommendationPercent(item.recentWorstDailyReturn)],
  ].filter((row) => row && row[1] && row[1] !== "-");

  return `
    <div class="recommendation-detail-summary">
      <span>우선 ${priorityScore}점</span>
      <strong>${escapeHtml(setup.label)}</strong>
      <p>${escapeHtml(setup.summary)}</p>
      <div class="recommendation-tags">
        ${setup.tags.map((tag) => `<b>${escapeHtml(tag)}</b>`).join("")}
      </div>
    </div>
    <dl class="recommendation-detail-grid">
      ${detailRows
        .map(
          ([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
    ${
      externalUrl
        ? `<a class="recommendation-detail-link" href="${escapeHtml(externalUrl)}" target="_blank" rel="noreferrer">외부 상세 페이지 열기</a>`
        : ""
    }
  `;
}

function recommendationExternalUrl(item) {
  const code = String(item.code || "").trim();
  if (/^\d{6}$/.test(code)) {
    return `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`;
  }
  const symbol = String(item.symbol || item.rawSymbol || "").trim();
  if (symbol) return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
  return "";
}

function formatRecommendationPrice(value, item) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const code = String(item.code || "").trim();
  if (/^\d{6}$/.test(code)) return `${formatNumber(number, 0)}원`;
  const decimals = number >= 100 ? 2 : 3;
  return `$${formatNumber(number, decimals)}`;
}

function formatRecommendationPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${formatSignedNumber(number, 1)}%`;
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Math.round(number).toLocaleString("ko-KR");
}

function recommendationPriorityScore(item) {
  const volumeRatio = Number(item.volumeRatio);
  const recentVolumeRatio = Number(item.recentVolumeRatio);
  const mfi = Number(item.mfi);
  const relativeReturn = Number(item.relativeReturn);
  const monthlyReturn = Number(item.monthlyReturn);
  const monthHighDrawdown = Number(item.monthHighDrawdown);
  const marketCapKrw = Number(item.marketCapKrw);
  let score = 0;

  if (Number.isFinite(volumeRatio)) {
    score += 8 + scaleBetween(Math.log(volumeRatio), Math.log(1.8), Math.log(8), 16);
  }
  if (Number.isFinite(recentVolumeRatio)) {
    score += 4 + scaleBetween(Math.log(recentVolumeRatio), Math.log(1.8), Math.log(6), 8);
  }
  if (Number.isFinite(mfi)) {
    score += 6 + scaleBetween(mfi, 70, 90, 12);
  }
  if (Number.isFinite(relativeReturn)) {
    score += 6 + scaleBetween(relativeReturn, 8, 60, 16);
  }
  if (Number.isFinite(monthlyReturn)) {
    score += 4 + scaleBetween(monthlyReturn, 15, 90, 12);
  }
  if (Number.isFinite(marketCapKrw) && marketCapKrw > 0) {
    if (marketCapKrw < 3_000_000_000_000) score += 12;
    else if (marketCapKrw < 10_000_000_000_000) score += 9;
    else if (marketCapKrw < 30_000_000_000_000) score += 6;
    else score += 3;
  }
  if (item.breakout) score += 8;
  if (item.aboveTrailing3Average) score += 5;
  if (item.recommendationStage === "watch") score -= 4;

  if (mfi > 94) score -= scaleBetween(mfi, 94, 100, 4);
  if (monthlyReturn > 100) score -= scaleBetween(monthlyReturn, 100, 150, 4);
  if (volumeRatio > 15) score -= scaleBetween(volumeRatio, 15, 30, 2);
  if (monthHighDrawdown < -10) {
    score -= scaleBetween(Math.abs(monthHighDrawdown), 10, 20, 10);
  }
  return clamp(Math.round(score), 0, 99);
}

function scaleBetween(value, min, max, points) {
  if (!Number.isFinite(value) || max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1) * points;
}

function buildRecommendationSetup(item) {
  const volumeRatio = Number(item.volumeRatio);
  const recentVolumeRatio = Number(item.recentVolumeRatio);
  const mfi = Number(item.mfi);
  const relativeReturn = Number(item.relativeReturn);
  const monthlyReturn = Number(item.monthlyReturn);
  const monthHighDrawdown = Number(item.monthHighDrawdown);
  const marketCapKrw = Number(item.marketCapKrw);
  const tags = [
    recommendationVolumeTag(volumeRatio),
    recommendationRecentVolumeTag(recentVolumeRatio),
    recommendationMfiTag(mfi),
    recommendationRelativeTag(relativeReturn),
    recommendationMonthlyTag(monthlyReturn),
    recommendationMarketCapTag(marketCapKrw),
    recommendationDrawdownTag(monthHighDrawdown),
    item.breakout ? "1개월 고점 돌파" : "",
    item.recommendationStage === "watch" ? "초기 관찰" : "",
  ]
    .filter(Boolean)
    .slice(0, 5);

  return {
    label: `${formatIsoDate(item.lastDate || "") || "추천 시점"} 기준`,
    summary: recommendationSetupSummary({
      mfi,
      monthHighDrawdown,
      monthlyReturn,
      recentVolumeRatio,
      recommendationStage: item.recommendationStage,
      relativeReturn,
      volumeRatio,
    }),
    tags,
  };
}

function recommendationSetupSummary({
  mfi,
  monthHighDrawdown,
  monthlyReturn,
  recentVolumeRatio,
  recommendationStage,
  relativeReturn,
  volumeRatio,
}) {
  if (monthHighDrawdown <= -10) {
    return `1개월 조건은 통과했지만 고점 대비 ${formatSignedNumber(monthHighDrawdown, 1)}% 밀려 있어 추격 매수보다 재돌파 확인이 필요해.`;
  }
  if (recommendationStage === "watch") {
    return `21일 거래량은 확인 전이지만 최근 5일 거래량이 ${formatNumber(recentVolumeRatio, 2)}배로 먼저 붙어 초기 관찰 후보로 분류됐어.`;
  }
  if (volumeRatio >= 8) {
    return `최근 21일 거래량이 과거 5개 21일 평균의 ${formatNumber(volumeRatio, 2)}배로 폭발했고, 상대강도도 ${formatSignedNumber(relativeReturn, 1)}%p라 수급 쏠림이 강했어.`;
  }
  if (mfi >= 90) {
    return `MFI가 ${formatNumber(mfi, 1)}로 90을 넘어 추천 시점부터 자금 유입 강도가 가장 두드러졌어.`;
  }
  if (relativeReturn >= 50) {
    return `최근 1개월 상승률 ${formatSignedNumber(monthlyReturn, 1)}%, 상대강도 ${formatSignedNumber(relativeReturn, 1)}%p로 시장 대비 탄력이 매우 컸어.`;
  }
  if (volumeRatio >= 3) {
    return `최근 21일 거래량이 평균의 ${formatNumber(volumeRatio, 2)}배까지 늘어 가격 돌파가 거래량으로 확인됐어.`;
  }
  return `최근 1개월 가격, 거래량, MFI, 상대강도가 모두 기준을 넘은 추천 시점 신호야.`;
}

function recommendationVolumeTag(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 8) return "거래량 폭발형";
  if (value >= 3) return "거래량 급증";
  if (value >= 1.8) return "21일 거래량 통과";
  return "";
}

function recommendationRecentVolumeTag(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 3) return "5일 거래량 급증";
  if (value >= 1.8) return "5일 거래량 통과";
  return "";
}

function recommendationMfiTag(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 90) return "MFI 90+";
  if (value >= 80) return "MFI 80+";
  return "";
}

function recommendationRelativeTag(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 50) return "상대강도 최상위";
  if (value >= 30) return "시장 대비 강세";
  if (value >= 8) return "상대강도 통과";
  return "";
}

function recommendationMonthlyTag(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 70) return "1개월 초강세";
  if (value >= 40) return "1개월 강세";
  if (value >= 15) return "1개월 돌파";
  return "";
}

function recommendationMarketCapTag(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 3_000_000_000_000) return "중소형 탄력";
  if (value >= 30_000_000_000_000) return "대형주";
  return "중형주";
}

function recommendationDrawdownTag(value) {
  if (!Number.isFinite(value)) return "";
  if (value <= -15) return "고점이탈 주의";
  if (value <= -10) return "고점낙폭 점검";
  return "고점 방어";
}

async function loadIndicators() {
  try {
    const [marketResponse, sentimentResponse] = await Promise.all([
      fetch("/api/market-overview", { cache: "no-store" }),
      fetch("/api/market-sentiment", { cache: "no-store" }),
    ]);

    if (!marketResponse.ok || !sentimentResponse.ok) {
      throw new Error("Market data request failed");
    }

    const market = await marketResponse.json();
    const sentiment = await sentimentResponse.json();

    renderMarketIndicator("kospi", market.quotes.kospi);
    renderMarketIndicator("sp500", market.quotes.sp500);
    renderMarketIndicator("nasdaq", market.quotes.nasdaq);
    renderMarketIndicator("sox", market.quotes.sox);
    renderMarketIndicator("nikkei", market.quotes.nikkei);
    renderMarketIndicator("nasdaqBreadth", market.quotes.nasdaqBreadth);
    renderMarketIndicator("sp500Breadth", market.quotes.sp500Breadth);
    renderMarketIndicator("semiBreadth", market.quotes.semiBreadth);
    renderMarketIndicator("semiLeadership", market.quotes.semiLeadership);
    renderMarketIndicator("ddr5Spot", market.quotes.ddr5Spot);
    renderMarketIndicator("usdKrw", market.quotes.usdKrw);
    renderMarketIndicator("wti", market.quotes.wti);
    renderMarketIndicator("us10y", market.quotes.us10y);
    renderMarketIndicator("hySpread", market.quotes.hySpread);
    renderMarketIndicator("nfci", market.quotes.nfci);
    renderFearGreed(sentiment.fearGreed);
    renderVix(sentiment.vix);
    renderMarketIndicator("vixTerm", buildVixTermQuote(market.quotes.vix3m, sentiment.vix));
    renderTradingSignal(market.quotes, sentiment);
    setText(
      "#marketSource",
      `Yahoo Finance · FRED · TrendForce · 공포·탐욕 ${formatIsoDate(sentiment.fearGreed.date)} · VIX ${formatIsoDate(sentiment.vix.date)} 기준 지연 데이터`,
    );
  } catch (error) {
    console.warn("Indicator data unavailable", error);
    renderSignalState({
      action: "중립",
      className: "signal-hold",
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

function renderSignalState({
  action,
  className,
  confidence,
  downProbability,
  eventSignal,
  regime,
  score,
  summary,
  upProbability,
}) {
  const panel = document.querySelector("#marketSignal");
  if (!panel) return;

  panel.classList.remove("signal-buy", "signal-hold", "signal-sell");
  panel.classList.add(className);
  panel.setAttribute("aria-label", `시장 추세: ${action}`);
  const scoreText = Number.isFinite(Number(score)) ? `${formatSignedScore(score)}점` : "";
  setText("#signalAction", scoreText ? `${action}(${scoreText})` : action);
  renderMarketScoreRange(score);
  const probabilityText = signalProbabilityText(action, upProbability, downProbability);
  const convictionText = signalConvictionText({
    action,
    downProbability,
    regime,
    upProbability,
  });
  const regimeText = signalRegimeLabel(regime);
  setText(
    "#signalSummary",
    [
      eventSignal,
      visibleSignalConfidence(confidence || signalConfidence(className, score)),
      probabilityText,
      convictionText,
      regimeText,
      summary,
    ]
      .filter(Boolean)
      .join(" · "),
  );
}

function renderMarketScoreRange(score) {
  const range = document.querySelector("#marketScoreRange");
  if (!range) return;
  const value = Number(score);
  if (!Number.isFinite(value)) {
    range.hidden = true;
    return;
  }

  const boundedScore = clamp(value, -100, 100);
  const position = ((boundedScore + 100) / 200) * 100;
  range.hidden = false;
  range.style.setProperty("--score-position", `${position}%`);
  range.setAttribute(
    "aria-label",
    `시장 추세 점수 구간: 하락 -100점부터 -45점, 중립 -44점부터 +49점, 상승 +50점부터 +100점. 현재 ${formatSignedScore(value)}점`,
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
  setText("#portfolioAiWeight", formatPercent(portfolioGrowthThemeWeight()));
  setText("#portfolioBondMixWeight", formatPercent(portfolioTagWeight("bondMix")));
}

function renderPortfolioState({
  action,
  allocation,
  checks,
  className,
  confidence,
  downProbability,
  eventSignal,
  holdingSignals,
  regime,
  score,
  summary,
  upProbability,
}) {
  const panel = document.querySelector("#portfolioSignal");
  if (!panel) return;

  panel.classList.remove("portfolio-buy", "portfolio-hold", "portfolio-trim");
  panel.classList.add(className);
  panel.setAttribute("aria-label", `보유 포트폴리오 신호: ${action}`);
  setText("#portfolioAction", action);
  setText("#portfolioScore", `${formatSignedScore(score)}점`);
  const allocationText = Number.isFinite(allocation)
    ? `권장비중 ${formatPercent(allocation * 100)}`
    : "권장비중 산정중";
  const probabilityText = signalProbabilityText(action, upProbability, downProbability);
  const convictionText = signalConvictionText({
    action,
    downProbability,
    regime,
    upProbability,
  });
  const regimeText = signalRegimeLabel(regime);
  setText(
    "#portfolioSummary",
    [
      allocationText,
      eventSignal,
      visibleSignalConfidence(confidence || signalConfidence(className, score)),
      probabilityText,
      convictionText,
      regimeText,
      summary,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const checksElement = document.querySelector("#portfolioChecks");
  if (!checksElement) return;
  checksElement.innerHTML = checks
    .map(
      (check) =>
        `<span class="${check.tone}"><b>${escapeHtml(check.label)}</b>${escapeHtml(check.text)}</span>`,
    )
    .join("");
  renderHoldingSignals(holdingSignals || []);
}

function renderHoldingSignals(signals) {
  const element = document.querySelector("#holdingSignals");
  if (!element) return;

  const sortedSignals = [...signals].sort(
    (a, b) => Number(b.score) - Number(a.score),
  );

  if (!sortedSignals.length) {
    element.innerHTML = `<p class="holding-empty">종목 데이터 수집 중</p>`;
    return;
  }

  element.innerHTML = sortedSignals
    .map((signal) => {
      const detail = [
        `${formatSignedScore(signal.score)}점`,
        visibleSignalConfidence(signal.confidence),
        signal.summary,
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" · ");
      return `
        <article class="holding-signal ${signal.className}">
          <span class="holding-lamps" aria-hidden="true">
            <i class="holding-green"></i>
            <i class="holding-yellow"></i>
            <i class="holding-red"></i>
          </span>
          <div class="holding-copy">
            <strong>${escapeHtml(signal.name)}</strong>
            <small>${detail}</small>
          </div>
          <span class="holding-action">${escapeHtml(signal.action)}</span>
        </article>
      `;
    })
    .join("");
}

function buildVixTermQuote(vix3mQuote, vixData) {
  const vix3mSeries = vix3mQuote?.history || [];
  const vixByDate = new Map(
    (vixData?.series || []).map((point) => [point.date, Number(point.value)]),
  );
  const history = vix3mSeries
    .map((point) => {
      const vix = vixByDate.get(point.date);
      const vix3m = Number(point.value);
      if (!Number.isFinite(vix) || !Number.isFinite(vix3m)) return null;
      return { date: point.date, value: vix3m - vix };
    })
    .filter(Boolean);
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!latest) return null;

  const change = previous ? latest.value - previous.value : 0;
  return {
    change,
    changePercent: change,
    changeText: `${vixTermTone(latest.value)} · ${formatSignedNumber(change, 2)}p`,
    changeUnit: "p",
    decimals: 2,
    history,
    id: "vixTerm",
    label: "VIX 기간구조",
    marketTime: vix3mQuote?.marketTime || `${latest.date}T00:00:00Z`,
    price: latest.value,
    valueSuffix: "p",
  };
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
  const marketBreadthScore = scoreMarketBreadth(quotes);
  const vixTermScore = scoreVixTermStructure(quotes.vix3m, sentiment.vix);
  const rateScore = scoreYield(quotes.us10y);
  const regimeScore = scoreMarketRegime(quotes);
  const crisisMode = detectPortfolioCrisisMode(quotes, sentiment);
  const geopoliticalReliefScore = scoreGeopoliticalRelief(quotes, sentiment);
  const shortTermEventScore = scoreShortTermEventImpulse(quotes, sentiment);
  add("주가지수", broadScore, 2.1);
  add("반도체", scoreRiskAsset(quotes.sox), 1.3);
  add("지정학 완화", geopoliticalReliefScore, 0.65);
  add("시장 폭", marketBreadthScore, 1.15);
  add("VIX 구조", vixTermScore, 0.8);
  add("DDR5", scoreMemoryPrice(quotes.ddr5Spot), 0.45);
  add("공포·탐욕", scoreFearGreed(sentiment.fearGreed), 1.15);
  add("VIX", scoreVix(sentiment.vix), 1.45);
  add("미국 10년물", rateScore, 0.85);
  add("달러/원", scoreUsdKrw(quotes.usdKrw), 0.65);
  add("WTI", scoreWti(quotes.wti), 0.45);
  add("시장 레짐", regimeScore, 1.25);
  const recoveryScore = scoreRecoveryPulse(quotes, sentiment);
  add("반등 확인", recoveryScore, 0.75);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = components.reduce((sum, item) => sum + item.weighted, 0);
  let score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;
  score = clamp(Math.round(score + shortTermEventScoreAdjustment(shortTermEventScore)), -100, 100);
  const vixLevel = Number(sentiment.vix?.close);
  const hasRecovery = Number.isFinite(recoveryScore) && recoveryScore >= 0.35;
  const recoveryForAction = Number.isFinite(recoveryScore) ? recoveryScore : -1;
  const slowMarketDownRisk =
    score <= -45 && recoveryForAction >= -0.6 && recoveryForAction <= -0.35;
  const probability = evaluateSignalProbability({
    broadScore,
    crisisMode,
    marketBreadthScore,
    geopoliticalReliefScore,
    rateScore,
    recoveryScore,
    regimeScore,
    score,
    shortTermEventScore,
    vixLevel,
    vixTermScore,
  });

  let action = "중립";
  let className = "signal-hold";
  if (slowMarketDownRisk) {
    action = "하락";
    className = "signal-sell";
  } else if (
    score >= Math.max(50, probability.buyScoreThreshold) &&
    probability.upProbability >= probability.buyProbabilityThreshold &&
    broadScore > 0 &&
    (!Number.isFinite(vixLevel) || vixLevel < 28) &&
    (hasRecovery || !Number.isFinite(vixLevel) || vixLevel < 25)
  ) {
    action = "상승";
    className = "signal-buy";
  }

  return {
    action,
    className,
    confidence: signalConfidence(className, score),
    downProbability: probability.downProbability,
    eventSignal: shortTermEventLabel(shortTermEventScore),
    regime: probability.regime,
    score,
    summary: summarizeSignal(components, className),
    upProbability: probability.upProbability,
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
  const marketBreadthScore = scoreMarketBreadth(quotes);
  const vixTermScore = scoreVixTermStructure(quotes.vix3m, sentiment.vix);
  const highProximityScore = scorePortfolioHighProximity(portfolioMetrics);
  const variancePremiumScore = scoreVarianceRiskPremium(quotes, sentiment);
  const crisisMode = detectPortfolioCrisisMode(quotes, sentiment);
  const geopoliticalReliefScore = scoreGeopoliticalRelief(quotes, sentiment);
  const shortTermEventScore = scoreShortTermEventImpulse(quotes, sentiment);

  add("SOX", semiScore, 2.4);
  add("NASDAQ", nasdaqScore, 1.25);
  add("KOSPI", kospiScore, 0.75);
  add("지정학 완화", geopoliticalReliefScore, 0.5);
  add("상대강도", relativeScore, 1.35);
  add("장기 상대강도", multiRelativeScore, 1.1);
  add("50/200일선", movingAverageScore, 1.15);
  add("외국인·기관", investorFlowScore, 0.9);
  add("시장 레짐", regimeScore, 1.35);
  add("반도체 사이클", semiconductorCycleScore, 1.25);
  add("시장 폭", marketBreadthScore, 1.05);
  add("52주 고점", highProximityScore, 0.85);
  add("DDR5", scoreMemoryPrice(quotes.ddr5Spot), 0.95);
  add("미국 10년물", rateScore, 1.2);
  add("달러/원", usdKrwScore, 0.85);
  add("VIX", vixScore, 1.05);
  add("VIX 구조", vixTermScore, 0.75);
  add("변동성 프리미엄", variancePremiumScore, 0.85);
  add("공포·탐욕", scoreFearGreed(sentiment.fearGreed), 0.65);
  add("WTI", scoreWti(quotes.wti), 0.2);
  add("반등 확인", recoveryScore, 0.8);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = components.reduce((sum, item) => sum + item.weighted, 0);
  let score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;
  score += Math.round(shortTermEventScoreAdjustment(shortTermEventScore) * 0.65);

  const vixLevel = Number(sentiment.vix?.close);
  const concentration = portfolioRiskThemeWeight();
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
  if (crisisMode.tailRisk) score -= crisisMode.severity === "severe" ? 18 : 12;
  score = clamp(Math.round(score), -100, 100);
  const slowPortfolioDownRisk =
    score <= -10 && recoveryForAction >= -0.1 && recoveryForAction < 0.2;
  const probability = evaluateSignalProbability({
    broadScore: nasdaqScore,
    concentration,
    crisisMode,
    highProximityScore,
    geopoliticalReliefScore,
    marketBreadthScore,
    rateScore,
    recoveryScore,
    regimeScore,
    score,
    semiconductorCycleScore,
    semiScore,
    shortTermEventScore,
    variancePremiumScore,
    vixLevel,
    vixTermScore,
  });

  let action = "중립";
  let className = "portfolio-hold";
  if (slowPortfolioDownRisk) {
    action = "하락";
    className = "portfolio-trim";
  } else if (
    score >= Math.max(40, probability.buyScoreThreshold) &&
    probability.upProbability >= probability.buyProbabilityThreshold &&
    semiScore > 0 &&
    semiconductorCycleScore > -0.2 &&
    regimeScore > -0.25 &&
    rateScore > -0.35 &&
    !crisisMode.active &&
    vixLevel < 28 &&
    (!Number.isFinite(variancePremiumScore) || variancePremiumScore > -0.6) &&
    (!Number.isFinite(recoveryScore) || recoveryScore > -0.2)
  ) {
    action = "상승";
    className = "portfolio-buy";
  }

  const confidence = signalConfidence(className, score);

  return {
    action,
    allocation: targetPortfolioExposure(
      score,
      action,
      confidence,
      crisisMode,
      DEFAULT_PORTFOLIO_EXPOSURE_CONFIG,
      probability.upProbability,
      probability.downProbability,
      probability.regime,
    ),
    checks: buildPortfolioChecks({
      crisisMode,
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
      highProximityScore,
      marketBreadthScore,
      semiScore,
      vixTermScore,
      vixScore,
    }),
    className,
    confidence,
    crisisMode,
    downProbability: probability.downProbability,
    eventSignal: shortTermEventLabel(shortTermEventScore),
    holdingSignals: evaluateHoldingSignals(
      portfolioMetrics?.holdings || [],
      quotes,
      sentiment,
      crisisMode,
    ),
    regime: probability.regime,
    score,
    summary: summarizePortfolioSignal(components, className, concentration, crisisMode),
    upProbability: probability.upProbability,
  };
}

function evaluateSignalProbability({
  broadScore,
  concentration = 0,
  crisisMode,
  geopoliticalReliefScore,
  highProximityScore,
  marketBreadthScore,
  rateScore,
  recoveryScore,
  regimeScore,
  score,
  semiconductorCycleScore,
  semiScore,
  shortTermEventScore,
  variancePremiumScore,
  vixLevel,
  vixTermScore,
}) {
  const cleanScore = Number(score);
  const breadth = cleanSignalScore(marketBreadthScore);
  const vixTerm = cleanSignalScore(vixTermScore);
  const rate = cleanSignalScore(rateScore);
  const recovery = cleanSignalScore(recoveryScore);
  const regimeScoreValue = cleanSignalScore(regimeScore);
  const variancePremium = cleanSignalScore(variancePremiumScore);
  const geopoliticalRelief = cleanSignalScore(geopoliticalReliefScore);
  const shortTermEvent = cleanSignalScore(shortTermEventScore);
  const semiCycle = cleanSignalScore(semiconductorCycleScore);
  const highProximity = cleanSignalScore(highProximityScore);
  const broad = cleanSignalScore(broadScore);
  const semi = cleanSignalScore(semiScore);
  const regime = classifySignalRegime({
    concentration,
    crisisMode,
    marketBreadthScore: breadth,
    rateScore: rate,
    vixLevel,
    vixTermScore: vixTerm,
  });

  const crisisPenalty =
    (crisisMode?.active ? 0.45 : 0) + (crisisMode?.tailRisk ? 0.55 : 0);
  const vixPenalty = Number.isFinite(vixLevel) && vixLevel >= 28 ? 0.28 : 0;
  const upLogit =
    -0.1 +
    cleanScore / 36 +
    positivePart(broad) * 0.35 +
    breadth * 0.7 +
    vixTerm * 0.45 +
    regimeScoreValue * 0.3 +
    recovery * 0.35 +
    geopoliticalRelief * 0.35 +
    shortTermEvent * 0.3 +
    semiCycle * 0.4 +
    highProximity * 0.22 +
    positivePart(semi) * 0.25 -
    negativePart(rate) * 0.35 -
    negativePart(variancePremium) * 0.35 -
    crisisPenalty -
    vixPenalty;
  const downLogit =
    -0.85 -
    cleanScore / 36 +
    negativePart(broad) * 0.35 +
    negativePart(breadth) * 0.8 +
    negativePart(vixTerm) * 0.65 +
    negativePart(rate) * 0.25 +
    negativePart(variancePremium) * 0.35 +
    negativePart(recovery) * 0.35 +
    negativePart(geopoliticalRelief) * 0.25 +
    negativePart(shortTermEvent) * 0.25 +
    (crisisMode?.active ? 0.45 : 0) +
    (crisisMode?.tailRisk ? 0.65 : 0) +
    (Number.isFinite(vixLevel) && vixLevel >= 32 ? 0.35 : 0);

  const thresholds = probabilityThresholdsForRegime(regime);
  return {
    ...thresholds,
    downProbability: Math.round(clamp(calibratedSignalProbability(downLogit), 1, 99)),
    regime,
    upProbability: Math.round(clamp(calibratedSignalProbability(upLogit), 1, 99)),
  };
}

function classifySignalRegime({
  concentration,
  crisisMode,
  marketBreadthScore,
  rateScore,
  vixLevel,
  vixTermScore,
}) {
  if (
    crisisMode?.tailRisk ||
    (Number.isFinite(vixLevel) && vixLevel >= 32) ||
    vixTermScore <= -0.45 ||
    ((Number.isFinite(vixLevel) && vixLevel >= 28) && marketBreadthScore < 0)
  ) {
    return "stress";
  }
  if (rateScore <= -0.35 && concentration >= 70) return "ratePressure";
  if (
    marketBreadthScore >= 0.25 &&
    vixTermScore >= 0.2 &&
    (!Number.isFinite(vixLevel) || vixLevel < 25)
  ) {
    return "trend";
  }
  return "balanced";
}

function probabilityThresholdsForRegime(regime) {
  if (regime === "trend") {
    return {
      buyProbabilityThreshold: 62,
      buyScoreThreshold: 38,
      sellProbabilityThreshold: 66,
    };
  }
  if (regime === "ratePressure") {
    return {
      buyProbabilityThreshold: 70,
      buyScoreThreshold: 48,
      sellProbabilityThreshold: 60,
    };
  }
  if (regime === "stress") {
    return {
      buyProbabilityThreshold: 74,
      buyScoreThreshold: 58,
      sellProbabilityThreshold: 58,
    };
  }
  return {
    buyProbabilityThreshold: 66,
    buyScoreThreshold: 42,
    sellProbabilityThreshold: 62,
  };
}

function signalProbabilityText(action, upProbability, downProbability) {
  const up = Number(upProbability);
  const down = Number(downProbability);
  if (!Number.isFinite(up) && !Number.isFinite(down)) return "";
  const showDown = action === "하락" || (action === "중립" && down > up);
  const value = showDown ? down : up;
  if (!Number.isFinite(value)) return "";
  return `${showDown ? "하락확률" : "상승확률"} ${Math.round(value)}%`;
}

function signalConvictionText({ action, upProbability, downProbability, regime }) {
  const up = Number(upProbability);
  const down = Number(downProbability);
  if (action === "상승") {
    if (up >= 75) return "고확신 상승";
    if (up >= 68) return "상승 확인";
    return "약한 상승";
  }
  if (action === "하락") {
    if (down >= 65) return "고확신 하락";
    return "약한 하락";
  }
  if (Number.isFinite(up) && up >= 75 && regime === "ratePressure") {
    return "금리 확인 대기";
  }
  if (Number.isFinite(up) && up >= 70) return "상승 우위";
  if (Number.isFinite(down) && down >= 62) return "방어 대기";
  return "";
}

function signalRegimeLabel(regime) {
  return (
    {
      balanced: "균형장",
      ratePressure: "금리부담",
      stress: "스트레스장",
      trend: "추세장",
    }[regime] || ""
  );
}

function shortTermEventLabel(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "";
  if (value >= 0.75) return "단기 급등 신호";
  if (value >= 0.4) return "단기 상승 강화";
  if (value <= -0.55) return "단기 위험 확대";
  return "";
}

function shortTermEventScoreAdjustment(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  if (value >= 0.75) return value * 12;
  if (value >= 0.4) return value * 10;
  if (value <= -0.55) return value * 10;
  return 0;
}

function visibleSignalConfidence(confidence) {
  return confidence === "녹색 대기" ? "" : confidence || "";
}

function cleanSignalScore(value) {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

function positivePart(value) {
  return Math.max(0, cleanSignalScore(value));
}

function negativePart(value) {
  return Math.max(0, -cleanSignalScore(value));
}

function logisticProbability(logit) {
  return 1 / (1 + Math.exp(-logit));
}

function calibratedSignalProbability(logit) {
  return 50 + (logisticProbability(logit) - 0.5) * 60;
}

function evaluateHoldingSignals(holdings, quotes, sentiment, crisisMode) {
  return holdings
    .map((holding) => evaluateHoldingSignal(holding, quotes, sentiment, crisisMode))
    .filter(Boolean);
}

function evaluateHoldingSignal(holding, quotes, sentiment, crisisMode) {
  const meta = portfolioHoldingMeta(holding);
  const benchmarkQuote = quotes?.[holding.benchmark || meta?.benchmark];
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

  const relativeScore = scoreSingleHoldingRelativeStrength(holding, benchmarkQuote);
  const multiRelativeScore = scoreRelativeMomentum(
    { analysisHistory: holding.analysisHistory, history: holding.history },
    benchmarkQuote,
  );
  const movingAverageScore = scoreHoldingMovingAverage(holding);
  const investorFlowScore = Number(holding.flow?.score);
  const benchmarkScore = scoreRiskAsset(benchmarkQuote);
  const sectorScore = scoreHoldingSector(meta, quotes, sentiment);
  const regimeScore = scoreMarketRegime(quotes);
  const vixScore = scoreVix(sentiment?.vix);

  add("상대강도", relativeScore, 1.45);
  add("장기상대", multiRelativeScore, 1.15);
  add("50/200일선", movingAverageScore, 1.25);
  add("수급", investorFlowScore, 0.85);
  add("벤치마크", benchmarkScore, 0.9);
  add("섹터", sectorScore, 1);
  add("시장레짐", regimeScore, 0.75);
  add("VIX", vixScore, 0.55);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return null;
  let score = Math.round(
    (components.reduce((sum, item) => sum + item.weighted, 0) / totalWeight) * 100,
  );

  if (crisisMode?.tailRisk) score -= 12;
  if (movingAverageScore < -0.25 && relativeScore < -0.25) score -= 6;
  if (sectorScore < -0.35 && hasAnyTag(meta, ["semi", "aiPower", "nasdaq", "cyber", "network", "space", "quantum", "auto"])) {
    score -= 5;
  }
  score = clamp(score, -100, 100);

  let action = "중립";
  let className = "holding-hold";
  if (
    crisisMode?.tailRisk ||
    score <= -45 ||
    (score <= -25 && movingAverageScore <= -0.35) ||
    (score <= -18 && relativeScore <= -0.55 && movingAverageScore < 0)
  ) {
    action = "하락";
    className = "holding-trim";
  } else if (
    score >= 32 &&
    movingAverageScore > 0 &&
    relativeScore > -0.2 &&
    benchmarkScore > -0.25 &&
    !crisisMode?.active
  ) {
    action = "상승";
    className = "holding-buy";
  }

  return {
    action,
    className,
    confidence: signalConfidence(className, score),
    name: compactHoldingName(meta?.name || holding.name || holding.id),
    score,
    summary: summarizeHoldingSignal(components, className),
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

function summarizePortfolioSignal(components, className, concentration, crisisMode) {
  const positives = components
    .filter((item) => item.weighted > 0.09)
    .sort((a, b) => b.weighted - a.weighted)
    .map((item) => `${item.label} 양호`);
  const negatives = components
    .filter((item) => item.weighted < -0.09)
    .sort((a, b) => a.weighted - b.weighted)
    .map((item) => `${item.label} 부담`);
  const concentrationText = `반도체·성장테마 노출 ${formatPercent(concentration)}`;
  const crisisText = crisisMode?.active
    ? `${crisisMode.severity === "severe" ? "위기모드" : "위험경계"}`
    : "";

  if (className === "portfolio-trim") {
    return `${[crisisText, ...(negatives.length ? negatives : ["위험 신호 우세"]).slice(0, 2), concentrationText].filter(Boolean).join(" · ")}`;
  }

  if (className === "portfolio-buy") {
    return `${(positives.length ? positives : ["성장주 환경 양호"]).slice(0, 2).join(" · ")} · 상승 우세`;
  }

  return `${[...positives.slice(0, 1), ...negatives.slice(0, 1)].join(" · ") || "중립 구간"} · ${concentrationText}`;
}

function summarizeHoldingSignal(components, className) {
  const positives = components
    .filter((item) => item.weighted > 0.08)
    .sort((a, b) => b.weighted - a.weighted)
    .map((item) => `${item.label} 양호`);
  const negatives = components
    .filter((item) => item.weighted < -0.08)
    .sort((a, b) => a.weighted - b.weighted)
    .map((item) => `${item.label} 부담`);

  if (className === "holding-buy") {
    return (positives.length ? positives : ["가격 흐름 양호"]).slice(0, 2).join(" · ");
  }
  if (className === "holding-trim") {
    return (negatives.length ? negatives : ["위험 신호 우세"]).slice(0, 2).join(" · ");
  }
  return [...positives.slice(0, 1), ...negatives.slice(0, 1)].join(" · ") || "중립";
}

function buildPortfolioChecks({
  crisisMode,
  highProximityScore,
  investorFlowScore,
  marketBreadthScore,
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
  vixTermScore,
  vixScore,
}) {
  return [
    portfolioCrisisCheck(crisisMode),
    portfolioCheck("상대강도", relativeScore, "벤치마크 대비"),
    portfolioCheck("장기상대", multiRelativeScore, "1/3/6/12개월"),
    portfolioCheck("50/200일선", movingAverageScore, "추세 확인"),
    portfolioCheck("외국인·기관", investorFlowScore, "수급 확인"),
    portfolioCheck("시장레짐", regimeScore, "신용·금융상황"),
    portfolioCheck("시장폭", marketBreadthScore, "동일가중 상대"),
    portfolioCheck("반도체", semiconductorCycleScore, "사이클 확인"),
    portfolioCheck("52주고점", highProximityScore, "고점 근접도"),
    portfolioCheck("반등확인", recoveryScore, "재진입 확인"),
    portfolioCheck("SOX", semiScore, "반도체 ETF 핵심"),
    portfolioCheck("NASDAQ", nasdaqScore, "AI 성장주"),
    portfolioCheck("VRP", variancePremiumScore, "변동성 프리미엄"),
    portfolioCheck("VIX구조", vixTermScore, "기간구조"),
    portfolioCheck("금리", rateScore, "채권혼합·성장주"),
    portfolioCheck("VIX", vixScore, "변동성"),
  ];
}

function portfolioCrisisCheck(crisisMode) {
  if (!crisisMode?.active) {
    return { label: "위기모드", text: "정상", tone: "good" };
  }
  return {
    label: "위기모드",
    text: crisisMode.severity === "severe" ? "위기" : "경계",
    tone: "bad",
  };
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
  add(scoreRelativeBreadth(quotes?.semiLeadership), 0.75);
  add(scoreSemiconductorBreadth(quotes?.semiBreadth), 0.75);
  add(scoreMemoryPrice(quotes?.ddr5Spot), 0.75);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : NaN;
}

function scoreMarketBreadth(quotes) {
  return average([
    scoreRelativeBreadth(quotes?.nasdaqBreadth),
    scoreRelativeBreadth(quotes?.sp500Breadth),
    scoreRelativeBreadth(quotes?.semiLeadership),
    scoreSemiconductorBreadth(quotes?.semiBreadth),
  ]);
}

function scoreRelativeBreadth(quote) {
  const relativeTrend = Number(quote?.price);
  if (!Number.isFinite(relativeTrend)) return NaN;
  if (relativeTrend >= 2.5) return 0.75;
  if (relativeTrend >= 0.75) return 0.4;
  if (relativeTrend > -0.75) return 0.05;
  if (relativeTrend > -2.5) return -0.4;
  return -0.75;
}

function scoreSemiconductorBreadth(quote) {
  const value = Number(quote?.price);
  const change = Number(quote?.change);
  if (!Number.isFinite(value)) return NaN;
  let score = 0;
  if (value >= 75) score = 0.75;
  else if (value >= 55) score = 0.35;
  else if (value >= 40) score = 0.05;
  else if (value >= 25) score = -0.35;
  else score = -0.75;
  if (change >= 14) score += 0.15;
  if (change <= -14) score -= 0.15;
  return clamp(score, -1, 1);
}

function scoreVixTermStructure(vix3mQuote, vixData) {
  const vix3m = Number(vix3mQuote?.price);
  const vix = Number(vixData?.close);
  if (!Number.isFinite(vix3m) || !Number.isFinite(vix)) return NaN;
  const spread = vix3m - vix;
  let score = 0;
  if (spread >= 4) score = 0.7;
  else if (spread >= 1.5) score = 0.35;
  else if (spread >= 0) score = 0.05;
  else if (spread >= -2) score = -0.4;
  else score = -0.8;
  const trend = pointChange(buildVixTermQuote(vix3mQuote, vixData)?.history);
  if (trend >= 1) score += 0.1;
  if (trend <= -1) score -= 0.1;
  return clamp(score, -1, 1);
}

function scorePortfolioHighProximity(portfolioMetrics) {
  return weightedPortfolioScore(portfolioMetrics, (holding) => {
    const proximity = Number(holding.highProximity);
    if (!Number.isFinite(proximity)) return NaN;
    if (proximity >= 97) return 0.85;
    if (proximity >= 92) return 0.55;
    if (proximity >= 85) return 0.15;
    if (proximity >= 75) return -0.35;
    return -0.75;
  });
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

function scoreShortTermEventImpulse(quotes, sentiment) {
  const signals = [];
  const add = (value, weight) => {
    if (!Number.isFinite(value)) return;
    signals.push({ value, weight });
  };

  const nasdaqFutureChange = Number(quotes?.nasdaqFutures?.changePercent);
  if (nasdaqFutureChange >= 1.5) add(1, 1.35);
  else if (nasdaqFutureChange >= 0.8) add(0.7, 1.35);
  else if (nasdaqFutureChange >= 0.35) add(0.35, 1.35);
  else if (nasdaqFutureChange <= -1) add(-0.7, 1.35);

  const spFutureChange = Number(quotes?.sp500Futures?.changePercent);
  if (spFutureChange >= 1.2) add(0.85, 1);
  else if (spFutureChange >= 0.6) add(0.55, 1);
  else if (spFutureChange >= 0.25) add(0.25, 1);
  else if (spFutureChange <= -0.8) add(-0.55, 1);

  const nikkeiChange = Number(quotes?.nikkei?.changePercent);
  if (nikkeiChange >= 2) add(0.85, 1);
  else if (nikkeiChange >= 1.2) add(0.55, 1);
  else if (nikkeiChange <= -1) add(-0.45, 1);

  const oilChange = Number(quotes?.wti?.changePercent);
  if (oilChange <= -3) add(0.75, 0.8);
  else if (oilChange <= -1.2) add(0.35, 0.8);
  else if (oilChange >= 2) add(-0.45, 0.8);

  const vixChange = Number(sentiment?.vix?.change);
  const vixLevel = Number(sentiment?.vix?.close);
  if (Number.isFinite(vixChange) && Number.isFinite(vixLevel)) {
    if (vixChange <= -2 || (vixChange <= 0 && vixLevel < 22)) add(0.35, 0.55);
    else if (vixChange >= 2 || vixLevel >= 28) add(-0.45, 0.55);
  }

  const usdKrwChange = Number(quotes?.usdKrw?.changePercent);
  if (usdKrwChange <= -0.3) add(0.25, 0.45);
  else if (usdKrwChange >= 0.6) add(-0.3, 0.45);

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (!totalWeight) return NaN;
  const score =
    signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) /
    totalWeight;
  return Math.abs(score) >= 0.2 ? clamp(score, -1, 1) : NaN;
}

function scoreGeopoliticalRelief(quotes, sentiment) {
  const signals = [];
  const add = (value, weight) => {
    if (!Number.isFinite(value)) return;
    signals.push({ value, weight });
  };

  const nikkeiChange = Number(quotes?.nikkei?.changePercent);
  if (nikkeiChange >= 1.5) add(1, 1.15);
  else if (nikkeiChange >= 0.7) add(0.45, 1.15);
  else if (nikkeiChange <= -1) add(-0.45, 1.15);

  const oilChange = Number(quotes?.wti?.changePercent);
  const oilTrend = trendPercent(quotes?.wti?.history);
  if (oilChange <= -2) add(0.9, 1);
  else if (oilChange <= -0.7 || oilTrend <= -4) add(0.45, 1);
  else if (oilChange >= 2 || oilTrend >= 5) add(-0.55, 1);

  const vixChange = Number(sentiment?.vix?.change);
  const vixLevel = Number(sentiment?.vix?.close);
  if (Number.isFinite(vixChange) && Number.isFinite(vixLevel)) {
    if (vixChange <= -1 || (vixChange <= 0 && vixLevel < 22)) add(0.6, 0.85);
    else if (vixChange >= 2) add(-0.6, 0.85);
  }

  const usdKrwChange = Number(quotes?.usdKrw?.changePercent);
  if (usdKrwChange <= -0.25) add(0.45, 0.75);
  else if (usdKrwChange <= 0.3) add(0.2, 0.75);
  else if (usdKrwChange >= 0.7) add(-0.55, 0.75);

  const semiRisk = average([
    Number(quotes?.sox?.changePercent),
    Number(quotes?.semiLeadership?.changePercent),
    Number(quotes?.nasdaq?.changePercent),
  ]);
  if (semiRisk >= 1) add(0.75, 0.8);
  else if (semiRisk >= 0.35) add(0.35, 0.8);
  else if (semiRisk <= -1) add(-0.45, 0.8);

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (!totalWeight) return NaN;
  const score =
    signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) /
    totalWeight;
  return Math.abs(score) >= 0.18 ? clamp(score, -1, 1) : NaN;
}

function scoreRecoveryPulse(quotes, sentiment, portfolioMetrics = null) {
  const components = [];
  const add = (score, weight) => {
    if (!Number.isFinite(score)) return;
    components.push({ score: clamp(score, -1, 1), weight });
  };

  add(scoreVixRelief(sentiment?.vix), 1.2);
  add(scoreCapitulationRelief(quotes, sentiment), 0.75);
  add(scoreGeopoliticalRelief(quotes, sentiment), 0.65);
  add(scoreShortTermEventImpulse(quotes, sentiment), 0.45);
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

function scoreSingleHoldingRelativeStrength(holding, benchmarkQuote) {
  const ownTrend = Number(holding?.trend28);
  const benchmarkTrend = trendPercent(benchmarkQuote?.history);
  if (!Number.isFinite(ownTrend) || !Number.isFinite(benchmarkTrend)) {
    return NaN;
  }

  const spread = ownTrend - benchmarkTrend;
  if (spread >= 8) return 0.9;
  if (spread >= 3) return 0.55;
  if (spread > -3) return 0.05;
  if (spread > -8) return -0.55;
  return -0.9;
}

function scoreHoldingSector(meta, quotes, sentiment) {
  const tags = meta?.tags || [];
  if (tags.includes("semi")) {
    return scoreSemiconductorCycle(quotes);
  }
  if (tags.includes("auto")) {
    return average([
      scoreRiskAsset(quotes?.kospi),
      scoreMarketRegime(quotes),
      scoreUsdKrw(quotes?.usdKrw),
      scoreWti(quotes?.wti),
    ]);
  }
  if (hasAnyTag(meta, ["aiPower", "nasdaq", "cyber", "network", "space", "quantum"])) {
    return average([
      scoreRiskAsset(quotes?.nasdaq),
      scoreRiskAsset(quotes?.sp500),
      scoreMarketRegime(quotes),
      scoreVix(sentiment?.vix),
    ]);
  }
  if (tags.includes("bondMix")) {
    return average([
      scoreYield(quotes?.us10y),
      scoreMarketRegime(quotes),
      scoreVix(sentiment?.vix),
    ]);
  }
  return NaN;
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

function pointChangeOverPeriod(series, period) {
  const points = numericSeries(series);
  if (points.length < 2) return NaN;
  const windowPoints = points.slice(-Math.min(period + 1, points.length));
  return windowPoints.at(-1) - windowPoints[0];
}

function isBelowMovingAverage(quote, period) {
  const points = numericSeries(quote?.analysisHistory || quote?.history);
  if (points.length < period) return false;
  const latest = points.at(-1);
  const movingAverageValue = average(points.slice(-period));
  return Number.isFinite(latest) &&
    Number.isFinite(movingAverageValue) &&
    latest < movingAverageValue;
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

function portfolioHoldingMeta(holding) {
  return (
    PORTFOLIO_HOLDING_META_BY_ID.get(holding?.id) ||
    PORTFOLIO_HOLDING_META_BY_CODE.get(holding?.code) ||
    null
  );
}

function compactHoldingName(name) {
  return String(name || "")
    .replace(/액티브$/u, "")
    .replace(/50$/u, "")
    .replace(/나스닥$/u, "")
    .trim();
}

function portfolioTagWeight(tag) {
  const taggedAmount = PORTFOLIO_HOLDINGS
    .filter((holding) => holding.tags.includes(tag))
    .reduce((sum, holding) => sum + holding.amount, 0);
  return PORTFOLIO_TOTAL ? (taggedAmount / PORTFOLIO_TOTAL) * 100 : 0;
}

function portfolioGrowthThemeWeight() {
  return portfolioAnyTagWeight(["aiPower", "nasdaq", "cyber", "network", "space", "quantum"]);
}

function portfolioRiskThemeWeight() {
  return portfolioAnyTagWeight(["semi", "aiPower", "nasdaq", "cyber", "network", "space", "quantum"]);
}

function portfolioAnyTagWeight(tags) {
  const taggedAmount = PORTFOLIO_HOLDINGS
    .filter((holding) => tags.some((tag) => holding.tags.includes(tag)))
    .reduce((sum, holding) => sum + holding.amount, 0);
  return PORTFOLIO_TOTAL ? (taggedAmount / PORTFOLIO_TOTAL) * 100 : 0;
}

function hasAnyTag(meta, tags) {
  const holdingTags = meta?.tags || [];
  return tags.some((tag) => holdingTags.includes(tag));
}

function signalConfidence(className, score) {
  const value = Math.abs(Number(score));
  if (
    className === "signal-buy" ||
    className === "portfolio-buy" ||
    className === "holding-buy"
  ) {
    return value >= 45 ? "강한 녹색" : "약한 녹색";
  }
  if (
    className === "signal-sell" ||
    className === "portfolio-trim" ||
    className === "holding-trim"
  ) {
    return value >= 55 ? "강한 빨간색" : "약한 빨간색";
  }
  if (value <= 12) return "중립";
  return score > 0 ? "녹색 대기" : "위험 경계";
}

function targetPortfolioExposure(
  score,
  action,
  confidence = "",
  crisisMode = null,
  config = DEFAULT_PORTFOLIO_EXPOSURE_CONFIG,
  upProbability = NaN,
  downProbability = NaN,
  regime = "",
) {
  const cleanScore = Number(score);
  if (!Number.isFinite(cleanScore)) return NaN;
  let exposure = 1;
  if (confidence === "약한 빨간색") exposure = config.weakRed;
  else if (confidence === "위험 경계") exposure = config.riskWatch;
  else if (confidence === "중립") exposure = config.neutral;
  else if (action === "하락") exposure = config.strongTrim;

  if (crisisMode?.tailRisk) {
    const crisisExposure =
      crisisMode.severity === "severe" ? config.severeCrisis : config.crisis;
    const crisisCap =
      crisisMode.severity === "severe" ? config.severeCrisis : config.crisisCap;
    if (action === "하락" || confidence.includes("빨간색")) {
      return Math.min(exposure, crisisExposure);
    }
    return Math.min(exposure, crisisCap);
  }
  return applyProbabilityExposureCap(
    exposure,
    action,
    upProbability,
    downProbability,
    regime,
  );
}

function applyProbabilityExposureCap(
  exposure,
  action,
  upProbability,
  downProbability,
  regime,
) {
  let adjusted = exposure;
  const up = Number(upProbability);
  const down = Number(downProbability);
  if (action === "상승" && Number.isFinite(up) && up < 70) {
    adjusted = Math.min(adjusted, 0.95);
  }
  if (action === "중립") {
    if (regime === "ratePressure") adjusted = Math.min(adjusted, 0.9);
    if (Number.isFinite(up) && up < 60) adjusted = Math.min(adjusted, 0.85);
    if (Number.isFinite(down) && down >= 65) adjusted = Math.min(adjusted, 0.75);
  }
  if (action === "하락" && Number.isFinite(down) && down >= 65) {
    adjusted = Math.min(adjusted, 0.5);
  }
  return adjusted;
}

function detectPortfolioCrisisMode(quotes, sentiment) {
  const vixLevel = Number(sentiment?.vix?.close);
  const vixChange = Number(sentiment?.vix?.change);
  const vixTrend = trendPercent(sentiment?.vix?.series || sentiment?.vix?.analysisSeries);
  const spreadLevel = Number(quotes?.hySpread?.price);
  const spreadMove = pointChangeOverPeriod(
    quotes?.hySpread?.analysisHistory || quotes?.hySpread?.history,
    63,
  );
  const nasdaqBelow200 = isBelowMovingAverage(quotes?.nasdaq, 200);
  const soxBelow200 = isBelowMovingAverage(quotes?.sox, 200);
  const riskMove = average([
    Number(quotes?.sox?.changePercent),
    Number(quotes?.nasdaq?.changePercent),
    Number(quotes?.kospi?.changePercent),
  ]);
  const vixStress =
    vixLevel >= 32 ||
    (vixLevel >= 28 && vixChange >= 3) ||
    (vixLevel >= 25 && vixTrend >= 20);
  const spreadStress = spreadLevel >= 5.5 || spreadMove >= 0.5;
  const trendStress = nasdaqBelow200 || soxBelow200;
  const active =
    (vixStress && spreadStress && trendStress) ||
    (vixLevel >= 35 && trendStress) ||
    (spreadLevel >= 7 && vixLevel >= 25);
  const severe =
    active &&
    ((vixLevel >= 35 && spreadLevel >= 6) ||
      (vixLevel >= 32 && spreadStress && nasdaqBelow200 && soxBelow200));
  const shock =
    active &&
    ((Number.isFinite(vixChange) &&
      Number.isFinite(riskMove) &&
      vixChange >= 5 &&
      riskMove <= -1) ||
      (Number.isFinite(vixChange) &&
        Number.isFinite(riskMove) &&
        vixChange >= 2 &&
        riskMove <= -3.5));
  const tailRisk =
    active &&
    ((vixLevel >= 40 && spreadLevel >= 6.5 && trendStress) ||
      (vixLevel >= 35 && spreadLevel >= 7 && nasdaqBelow200 && soxBelow200));

  return {
    active,
    nasdaqBelow200,
    shock,
    severity: severe ? "severe" : active ? "elevated" : "normal",
    soxBelow200,
    spreadLevel: roundFinite(spreadLevel, 2),
    spreadMove: roundFinite(spreadMove, 2),
    tailRisk,
    vixLevel: roundFinite(vixLevel, 2),
  };
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

function vixTermTone(spread) {
  if (spread < 0) return "백워데이션";
  if (spread < 1.5) return "평탄";
  return "콘탱고";
}

function formatIsoDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${year}.${month}.${day}`;
}

function formatTime(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "지연";
  const timeText = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
  return `${timeText} KST`;
}

function formatDateTime(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const dateTimeText = new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
  return `${dateTimeText} KST`;
}

function canRefreshRecommendations(payload) {
  const availableAt = recommendationRefreshAvailableAt(payload);
  return !availableAt || Date.now() >= availableAt.getTime();
}

function recommendationCooldownText(payload) {
  const availableAt = recommendationRefreshAvailableAt(payload);
  if (!availableAt || Date.now() >= availableAt.getTime()) return "";
  return `다음 갱신 ${formatTime(availableAt.toISOString())}`;
}

function recommendationRefreshAvailableAt(payload) {
  if (!payload?.generatedAt || payload.logicOutdated) return null;
  const generatedAt = new Date(payload.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) return null;
  return new Date(generatedAt + RECOMMENDATION_REFRESH_COOLDOWN_MS);
}

function formatNumber(value, decimals) {
  if (!Number.isFinite(Number(value))) return "-";
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

function formatSignedNumber(value, decimals = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number >= 0 ? "+" : ""}${number.toFixed(decimals)}`;
}

function formatKoreanMarketCap(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  const trillion = number / 1_000_000_000_000;
  if (trillion >= 1) {
    const decimals = trillion >= 10 ? 1 : 2;
    return `${formatCompactDecimal(trillion, decimals)}조`;
  }
  return `${Math.round(number / 100_000_000).toLocaleString("ko-KR")}억`;
}

function formatCompactDecimal(value, decimals) {
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}

function formatMarketCapCondition(value) {
  const text = formatKoreanMarketCap(value);
  return text === "-" ? "" : `시총 ${text} 이상`;
}

function formatConditionNumber(value) {
  const text = String(value || "");
  const number = text.match(/>=\s*([\d.]+)/)?.[1];
  if (!number) return "";
  if (text.includes("x")) return `${number}배 이상`;
  return `${number} 이상`;
}

function formatDrawdownCondition(value) {
  const text = String(value || "");
  const number = text.match(/>=\s*(-?[\d.]+)%/)?.[1];
  if (!number) return "";
  return `고점낙폭 ${number}% 이내`;
}

function formatMarketFilter(value) {
  const markets = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((market) => market.trim())
        .filter(Boolean);
  if (!markets.length) return "";
  return `시장 ${markets.join("·")}`;
}

function roundFinite(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
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

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
