const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function createTrafficStore({ filePath, limit, retentionMs }) {
  const loaded = loadTrafficFile(filePath);
  const events = sanitizeEvents(loaded.events || []);
  let persistTimer = null;
  let writing = false;
  const startedAt = loaded.startedAt || new Date().toISOString();

  function add(event) {
    events.push(event);
    prune();
    schedulePersist();
  }

  function prune() {
    const cutoff = Date.now() - retentionMs;
    while (
      events.length > limit ||
      (events.length && Date.parse(events[0].at) < cutoff)
    ) {
      events.shift();
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persist().catch((error) => {
        console.warn("Traffic persistence failed", error);
      });
    }, 1000);
    persistTimer.unref?.();
  }

  async function persist() {
    if (writing) return;
    writing = true;
    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(
        filePath,
        `${JSON.stringify(
          {
            events,
            startedAt,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      writing = false;
    }
  }

  return {
    add,
    events,
    filePath,
    persist,
    prune,
    startedAt,
  };
}

function loadTrafficFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return payload && typeof payload === "object" ? payload : {};
  } catch (error) {
    console.warn("Traffic persistence load failed", error);
    return {};
  }
}

function sanitizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event && Number.isFinite(Date.parse(event.at)))
    .map((event) => ({
      at: String(event.at),
      durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : 0,
      ip: String(event.ip || "-"),
      kind: event.kind === "api" ? "api" : "page",
      method: String(event.method || "GET"),
      path: String(event.path || "/"),
      status: Number.isFinite(Number(event.status)) ? Number(event.status) : 0,
      visitorId: String(event.visitorId || ""),
    }));
}

module.exports = { createTrafficStore };
