import dashboardScript from "../app.js?raw";
import dashboardHtml from "../index.html?raw";
import dashboardStyles from "../styles.css?raw";
import trafficHtml from "../traffic.html?raw";
import trafficScript from "../traffic.js?raw";
import backtestSnapshot from "./backtest-snapshot.json";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
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

async function handleApi(url: URL) {
  if (url.pathname === "/api/health") {
    return jsonResponse({ ok: true, service: "finance-dashboard-sites" });
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
  if (url.pathname === "/api/stock-recommendations") {
    return jsonResponse(
      await finance.getStockRecommendations({ asyncRefresh: false, forceRefresh: false }),
    );
  }
  if (url.pathname === "/api/us-stock-recommendations") {
    return jsonResponse(
      await finance.getUsStockRecommendations({ asyncRefresh: false, forceRefresh: false }),
    );
  }
  if (url.pathname === "/api/recommendation-refresh-progress") {
    return jsonResponse(
      finance.getRecommendationRefreshProgress(
        url.searchParams.get("market") === "us" ? "us" : "domestic",
      ),
    );
  }
  if (url.pathname === "/api/backtest-summary") {
    return jsonResponse({ ...backtestSnapshot, generatedAt: new Date().toISOString() });
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

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(url);
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
