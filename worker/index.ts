import dashboardScript from "../app.js?raw";
import dashboardHtml from "../index.html?raw";
import dashboardStyles from "../styles.css?raw";
import trafficHtml from "../traffic.html?raw";
import trafficScript from "../traffic.js?raw";
import backtestSnapshot from "./backtest-snapshot.json";
import handler from "vinext/server/app-router-entry";
import portfolioConfigLib from "../lib/portfolioConfig.js";
import sitesRecommendation from "../lib/sitesRecommendation.js";
import {
  createManagedHoldingsStore,
  isHoldingId,
  normalizeHoldingName,
  type D1DatabaseLike,
} from "./holdings-store";

const portfolioConfig = portfolioConfigLib.getPortfolioConfig();

type RecommendationSnapshot = Record<string, unknown> & {
  generatedAt?: string;
  marketMonth?: string;
};

const domesticRecommendationSnapshots = import.meta.glob(
  "../screen_results/kr_monthly_breakout_*.json",
  { eager: true, import: "default" },
) as Record<string, RecommendationSnapshot>;
const usRecommendationSnapshots = import.meta.glob(
  "../screen_results/us_monthly_breakout_*.json",
  { eager: true, import: "default" },
) as Record<string, RecommendationSnapshot>;
const domesticRecommendationSnapshot = sitesRecommendation.selectLatestRecommendationSnapshot(
  domesticRecommendationSnapshots,
);
const usRecommendationSnapshot = sitesRecommendation.selectLatestRecommendationSnapshot(
  usRecommendationSnapshots,
);

interface Env {
  ASSETS: Fetcher;
  DB?: D1DatabaseLike;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type FinanceModule = typeof import("../server.js")["default"];
let financeModulePromise: Promise<FinanceModule> | null = null;

function loadFinanceModule() {
  process.env.FINANCE_SITES_MODE = "1";
  financeModulePromise ??= import("../server.js").then((module) => module.default);
  return financeModulePromise;
}

function textResponse(body: string, contentType: string) {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    },
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function handleApi(request: Request, url: URL, env?: Env) {
  if (url.pathname === "/api/health") {
    return jsonResponse({ ok: true, service: "finance-dashboard-sites" });
  }

  if (url.pathname === "/api/holdings" || url.pathname.startsWith("/api/holdings/")) {
    return handleHoldingsApi(request, url, env);
  }

  const finance = await loadFinanceModule();
  if (url.pathname === "/api/market-overview") {
    return jsonResponse(await finance.getMarketOverview());
  }
  if (url.pathname === "/api/market-sentiment") {
    return jsonResponse(await finance.getMarketSentiment());
  }
  if (url.pathname === "/api/portfolio-metrics") {
    return jsonResponse(await finance.getPortfolioMetrics());
  }
  if (url.pathname === "/api/portfolio-config") {
    return jsonResponse(portfolioConfig);
  }
  if (url.pathname === "/api/stock-recommendations") {
    const payload = domesticRecommendationSnapshot
      ? await finance.getBundledStockRecommendations(domesticRecommendationSnapshot, {
          market: "domestic",
        })
      : await finance.getStockRecommendations({ asyncRefresh: false, forceRefresh: false });
    return jsonResponse(
      sitesRecommendation.withSitesRecommendationMetadata(payload, {
        refreshRequested: url.searchParams.get("refresh") === "1",
      }),
    );
  }
  if (url.pathname === "/api/us-stock-recommendations") {
    const payload = usRecommendationSnapshot
      ? await finance.getBundledStockRecommendations(usRecommendationSnapshot, { market: "us" })
      : await finance.getUsStockRecommendations({ asyncRefresh: false, forceRefresh: false });
    return jsonResponse(
      sitesRecommendation.withSitesRecommendationMetadata(payload, {
        refreshRequested: url.searchParams.get("refresh") === "1",
      }),
    );
  }
  if (url.pathname === "/api/recommendation-refresh-progress") {
    return jsonResponse(
      sitesRecommendation.createSitesRecommendationProgress(
        url.searchParams.get("market") === "us" ? "us" : "domestic",
      ),
    );
  }
  if (url.pathname === "/api/backtest-summary") {
    return jsonResponse({ ...backtestSnapshot, servedAt: new Date().toISOString() });
  }
  if (url.pathname === "/api/traffic") {
    return jsonResponse(finance.getTrafficSummary());
  }
  if (url.pathname === "/api/stock-search") {
    return jsonResponse(await finance.getStockSearchResults(url.searchParams.get("q")));
  }
  if (url.pathname === "/api/stock-evaluation") {
    return jsonResponse(
      await finance.getStockEvaluation({
        code: url.searchParams.get("code"),
        market: url.searchParams.get("market"),
        symbol: url.searchParams.get("symbol"),
      }),
    );
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleHoldingsApi(request: Request, url: URL, env?: Env) {
  const store = createManagedHoldingsStore(env?.DB);
  const idMatch = url.pathname.match(/^\/api\/holdings\/([^/]+)$/);
  const id = idMatch ? decodeURIComponent(idMatch[1]) : "";

  try {
    if (url.pathname === "/api/holdings" && request.method === "GET") {
      const holdings = await store.list();
      return jsonResponse({
        count: holdings.length,
        holdings,
        storage: env?.DB ? "d1" : "memory",
      });
    }

    if (url.pathname === "/api/holdings" && request.method === "POST") {
      const name = normalizeHoldingName((await readJsonBody(request)).name);
      if (!name) return jsonResponse({ error: "name_required" }, 400);
      const holding = await store.create(name);
      return jsonResponse({ holding }, 201);
    }

    if (idMatch && request.method === "PATCH") {
      if (!isHoldingId(id)) return jsonResponse({ error: "invalid_id" }, 400);
      const name = normalizeHoldingName((await readJsonBody(request)).name);
      if (!name) return jsonResponse({ error: "name_required" }, 400);
      const holding = await store.update(id, name);
      return jsonResponse({ holding });
    }

    if (idMatch && request.method === "DELETE") {
      if (!isHoldingId(id)) return jsonResponse({ error: "invalid_id" }, 400);
      await store.remove(id);
      return jsonResponse({ deleted: true, id });
    }

    return jsonResponse({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    const code = String((error as { code?: string })?.code || "holdings_unavailable");
    return jsonResponse({ error: code }, status);
  }
}

async function readJsonBody(request: Request) {
  try {
    const payload = await request.json();
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, url, env);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return textResponse(dashboardHtml, "text/html; charset=utf-8");
      }
      if (url.pathname === "/app.js") {
        return textResponse(dashboardScript, "text/javascript; charset=utf-8");
      }
      if (url.pathname === "/styles.css") {
        return textResponse(dashboardStyles, "text/css; charset=utf-8");
      }
      if (url.pathname === "/traffic" || url.pathname === "/traffic/" || url.pathname === "/traffic.html") {
        return textResponse(trafficHtml, "text/html; charset=utf-8");
      }
      if (url.pathname === "/traffic.js") {
        return textResponse(trafficScript, "text/javascript; charset=utf-8");
      }
    } catch (error) {
      return jsonResponse(
        {
          error: "market_data_unavailable",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
