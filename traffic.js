const TRAFFIC_REFRESH_MS = 30 * 1000;

const trafficElements = {
  dau: document.querySelector("#trafficDau"),
  mau: document.querySelector("#trafficMau"),
  pathList: document.querySelector("#trafficPathList"),
  pv30d: document.querySelector("#trafficPv30d"),
  pvMonth: document.querySelector("#trafficPvMonth"),
  pvToday: document.querySelector("#trafficPvToday"),
  recentList: document.querySelector("#trafficRecentList"),
  updatedAt: document.querySelector("#trafficUpdatedAt"),
  windowList: document.querySelector("#trafficWindowList"),
};

loadTraffic();
window.setInterval(loadTraffic, TRAFFIC_REFRESH_MS);

async function loadTraffic() {
  try {
    const response = await fetch("/api/traffic", { cache: "no-store" });
    if (!response.ok) throw new Error("traffic request failed");
    renderTraffic(await response.json());
  } catch (error) {
    console.warn("Traffic unavailable", error);
    setText(trafficElements.updatedAt, "트래픽 집계 실패");
    if (trafficElements.windowList) {
      trafficElements.windowList.innerHTML =
        '<p class="traffic-empty">트래픽 데이터를 불러오지 못했습니다.</p>';
    }
  }
}

function renderTraffic(payload) {
  const kpi = payload?.kpi || {};
  setText(trafficElements.dau, formatNumber(kpi.dau));
  setText(trafficElements.mau, formatNumber(kpi.mau));
  setText(trafficElements.pvToday, formatNumber(kpi.pvToday));
  setText(trafficElements.pvMonth, formatNumber(kpi.pvThisMonth));
  setText(trafficElements.pv30d, formatNumber(kpi.pv30d));
  setText(
    trafficElements.updatedAt,
    `${formatDateTime(payload.generatedAt)} 갱신 · 최근 ${payload.retentionDays || 31}일 보관`,
  );
  renderWindows(payload.windows || []);
  renderPaths(payload.windows || []);
  renderRecent(payload.recent || []);
}

function renderWindows(windows) {
  if (!trafficElements.windowList) return;
  if (!windows.length) {
    trafficElements.windowList.innerHTML = '<p class="traffic-empty">집계 없음</p>';
    return;
  }
  trafficElements.windowList.innerHTML = windows
    .map(
      (item) => `
        <article class="traffic-window-card">
          <strong>${escapeHtml(item.label)}</strong>
          <div>
            <span><b>${formatNumber(item.pageViews)}</b><em>PV</em></span>
            <span><b>${formatNumber(item.uniqueVisitors)}</b><em>방문자</em></span>
            <span><b>${formatNumber(item.apiRequests)}</b><em>API</em></span>
            <span><b>${formatNumber(item.errorRequests)}</b><em>오류</em></span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderPaths(windows) {
  if (!trafficElements.pathList) return;
  const monthWindow = windows.find((item) => item.id === "30d") || windows.at(-1);
  const paths = monthWindow?.topPaths || [];
  if (!paths.length) {
    trafficElements.pathList.innerHTML = '<p class="traffic-empty">집계 없음</p>';
    return;
  }
  trafficElements.pathList.innerHTML = paths
    .map(
      (item) => `
        <div class="traffic-path-row">
          <span>${escapeHtml(item.path)}</span>
          <strong>${formatNumber(item.requests)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderRecent(items) {
  if (!trafficElements.recentList) return;
  if (!items.length) {
    trafficElements.recentList.innerHTML =
      '<tr><td colspan="5">최근 접속이력이 없습니다.</td></tr>';
    return;
  }
  trafficElements.recentList.innerHTML = items
    .slice(0, 20)
    .map(
      (item) => `
        <tr>
          <td>${formatDateTime(item.at)}</td>
          <td>${escapeHtml(formatKind(item.kind))}</td>
          <td>${escapeHtml(item.path)}</td>
          <td>${formatStatus(item.status)}</td>
          <td>${formatDuration(item.durationMs)}</td>
        </tr>
      `,
    )
    .join("");
}

function formatKind(kind) {
  return kind === "api" ? "API" : "페이지";
}

function formatStatus(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return "-";
  return String(code);
}

function formatDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("ko-KR").format(Math.round(number));
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("ko-KR").format(number);
}

function formatDateTime(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "시간 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
