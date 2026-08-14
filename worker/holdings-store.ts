import seedSource from "../managed-holdings.json";

export type ManagedHoldingPosition = {
  code: string;
  market: string;
  symbol: string;
  currentValueKrw: number | null;
  benchmark: string;
  tags: string[];
};

export type ManagedHolding = ManagedHoldingPosition & {
  id: string;
  name: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ManagedHoldingPositionInput = Partial<ManagedHoldingPosition>;

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run(): Promise<unknown>;
};

export type D1DatabaseLike = {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
  prepare(sql: string): D1PreparedStatementLike;
};

type HoldingRow = Omit<ManagedHolding, "tags"> & { tagsJson?: string };

const SEED_VERSION_KEY = "managed_holdings_seed_version";
const POSITION_SEED_VERSION_KEY = "holding_positions_seed_version";
const seedHoldings: ManagedHolding[] = seedSource.holdings.map((holding) => ({
  id: String(holding.id),
  name: String(holding.name),
  sortOrder: Number(holding.sortOrder),
  ...normalizePosition(holding),
}));

let memoryHoldings = seedHoldings.map(cloneHolding);
let initializationPromise: Promise<void> | null = null;

export function normalizeHoldingName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function normalizeHoldingPosition(
  value: Record<string, unknown> = {},
  fallback: ManagedHoldingPositionInput = {},
): ManagedHoldingPosition {
  return normalizePosition({ ...fallback, ...value });
}

export function isHoldingId(value: unknown) {
  return /^[a-zA-Z0-9-]{1,80}$/.test(String(value ?? ""));
}

export function createManagedHoldingsStore(db?: D1DatabaseLike) {
  return db ? createD1Store(db) : createMemoryStore();
}

function createMemoryStore() {
  return {
    async list() {
      return memoryHoldings.map(cloneHolding);
    },
    async create(name: string, position: ManagedHoldingPositionInput = {}) {
      assertUniqueName(memoryHoldings, name);
      const holding: ManagedHolding = {
        id: crypto.randomUUID(),
        name,
        sortOrder: Math.max(0, ...memoryHoldings.map((item) => item.sortOrder)) + 1,
        ...normalizePosition(position),
      };
      memoryHoldings.push(holding);
      return cloneHolding(holding);
    },
    async update(id: string, name: string, position: ManagedHoldingPositionInput = {}) {
      const index = memoryHoldings.findIndex((holding) => holding.id === id);
      if (index < 0) throw storeError("not_found", 404);
      assertUniqueName(memoryHoldings, name, id);
      memoryHoldings[index] = {
        ...memoryHoldings[index],
        name,
        ...normalizePosition(position, memoryHoldings[index]),
      };
      return cloneHolding(memoryHoldings[index]);
    },
    async remove(id: string) {
      const index = memoryHoldings.findIndex((holding) => holding.id === id);
      if (index < 0) throw storeError("not_found", 404);
      memoryHoldings.splice(index, 1);
    },
  };
}

function createD1Store(db: D1DatabaseLike) {
  const ready = () => ensureD1Initialized(db);
  const selectSql = `SELECT h.id, h.name, h.sort_order AS sortOrder,
      h.created_at AS createdAt, h.updated_at AS updatedAt,
      COALESCE(p.code, '') AS code, COALESCE(p.market, 'kr') AS market,
      COALESCE(p.symbol, '') AS symbol, p.current_value_krw AS currentValueKrw,
      COALESCE(p.benchmark, 'kospi') AS benchmark, COALESCE(p.tags_json, '[]') AS tagsJson
    FROM managed_holdings h
    LEFT JOIN holding_positions p ON p.holding_id = h.id`;
  return {
    async list() {
      await ready();
      const result = await db
        .prepare(`${selectSql} ORDER BY h.sort_order ASC, h.created_at ASC`)
        .all<HoldingRow>();
      return (result.results ?? []).map(hydrateHolding);
    },
    async create(name: string, position: ManagedHoldingPositionInput = {}) {
      await ready();
      await assertD1UniqueName(db, name);
      const maxRow = await db
        .prepare("SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder FROM managed_holdings")
        .first<{ maxSortOrder: number }>();
      const holding: ManagedHolding = {
        id: crypto.randomUUID(),
        name,
        sortOrder: Number(maxRow?.maxSortOrder) + 1,
        ...normalizePosition(position),
      };
      await db.batch([
        db
          .prepare("INSERT INTO managed_holdings (id, name, sort_order) VALUES (?, ?, ?)")
          .bind(holding.id, holding.name, holding.sortOrder),
        positionInsertStatement(db, holding.id, holding),
      ]);
      return cloneHolding(holding);
    },
    async update(id: string, name: string, position: ManagedHoldingPositionInput = {}) {
      await ready();
      const existingRow = await db
        .prepare(`${selectSql} WHERE h.id = ?`)
        .bind(id)
        .first<HoldingRow>();
      if (!existingRow) throw storeError("not_found", 404);
      await assertD1UniqueName(db, name, id);
      const existing = hydrateHolding(existingRow);
      const nextPosition = normalizePosition(position, existing);
      await db.batch([
        db
          .prepare("UPDATE managed_holdings SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(name, id),
        db
          .prepare(
            `INSERT INTO holding_positions
              (holding_id, code, market, symbol, current_value_krw, benchmark, tags_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(holding_id) DO UPDATE SET
               code = excluded.code, market = excluded.market, symbol = excluded.symbol,
               current_value_krw = excluded.current_value_krw,
               benchmark = excluded.benchmark, tags_json = excluded.tags_json,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            id,
            nextPosition.code,
            nextPosition.market,
            nextPosition.symbol,
            nextPosition.currentValueKrw,
            nextPosition.benchmark,
            JSON.stringify(nextPosition.tags),
          ),
      ]);
      const updated = await db
        .prepare(`${selectSql} WHERE h.id = ?`)
        .bind(id)
        .first<HoldingRow>();
      if (!updated) throw storeError("not_found", 404);
      return hydrateHolding(updated);
    },
    async remove(id: string) {
      await ready();
      const existing = await db
        .prepare("SELECT id FROM managed_holdings WHERE id = ?")
        .bind(id)
        .first<{ id: string }>();
      if (!existing) throw storeError("not_found", 404);
      await db.batch([
        db.prepare("DELETE FROM holding_positions WHERE holding_id = ?").bind(id),
        db.prepare("DELETE FROM managed_holdings WHERE id = ?").bind(id),
      ]);
    },
  };
}

async function ensureD1Initialized(db: D1DatabaseLike) {
  initializationPromise ??= initializeD1(db).catch((error) => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

async function initializeD1(db: D1DatabaseLike) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS managed_holdings (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_holdings_name ON managed_holdings (name)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_managed_holdings_sort_order ON managed_holdings (sort_order)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS holding_store_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS holding_positions (
        holding_id TEXT PRIMARY KEY NOT NULL REFERENCES managed_holdings(id) ON DELETE CASCADE,
        code TEXT DEFAULT '' NOT NULL,
        market TEXT DEFAULT 'kr' NOT NULL,
        symbol TEXT DEFAULT '' NOT NULL,
        current_value_krw REAL,
        benchmark TEXT DEFAULT 'kospi' NOT NULL,
        tags_json TEXT DEFAULT '[]' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_holding_positions_code ON holding_positions (code)"),
  ]);

  const seeded = await db
    .prepare("SELECT value FROM holding_store_meta WHERE key = ?")
    .bind(SEED_VERSION_KEY)
    .first<{ value: string }>();
  if (!seeded) {
    await db.batch([
      ...seedHoldings.map((holding) =>
        db
          .prepare("INSERT OR IGNORE INTO managed_holdings (id, name, sort_order) VALUES (?, ?, ?)")
          .bind(holding.id, holding.name, holding.sortOrder),
      ),
      db
        .prepare("INSERT OR REPLACE INTO holding_store_meta (key, value) VALUES (?, ?)")
        .bind(SEED_VERSION_KEY, String(seedSource.version)),
    ]);
  }

  const positionSeeded = await db
    .prepare("SELECT value FROM holding_store_meta WHERE key = ?")
    .bind(POSITION_SEED_VERSION_KEY)
    .first<{ value: string }>();
  if (!positionSeeded) {
    await db.batch([
      ...seedHoldings.map((holding) => positionInsertStatement(db, holding.id, holding, true)),
      db
        .prepare("INSERT OR REPLACE INTO holding_store_meta (key, value) VALUES (?, ?)")
        .bind(POSITION_SEED_VERSION_KEY, String(seedSource.version)),
    ]);
  }
  await db.prepare("PRAGMA optimize").run();
}

function positionInsertStatement(
  db: D1DatabaseLike,
  holdingId: string,
  position: ManagedHoldingPositionInput,
  ignore = false,
) {
  const normalized = normalizePosition(position);
  const values = [
    holdingId,
    normalized.code,
    normalized.market,
    normalized.symbol,
    normalized.currentValueKrw,
    normalized.benchmark,
    JSON.stringify(normalized.tags),
  ];
  if (ignore) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO holding_positions
          (holding_id, code, market, symbol, current_value_krw, benchmark, tags_json)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM managed_holdings WHERE id = ?)`,
      )
      .bind(...values, holdingId);
  }
  return db
    .prepare(
      `INSERT INTO holding_positions
        (holding_id, code, market, symbol, current_value_krw, benchmark, tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...values);
}

function normalizePosition(
  value: ManagedHoldingPositionInput | Record<string, unknown> = {},
  fallback: ManagedHoldingPositionInput = {},
): ManagedHoldingPosition {
  const rawValue = value as Record<string, unknown>;
  const rawFallback = fallback as Record<string, unknown>;
  const amountSource = Object.prototype.hasOwnProperty.call(rawValue, "currentValueKrw")
    ? rawValue.currentValueKrw
    : rawFallback.currentValueKrw;
  const amount = amountSource === null || amountSource === "" || amountSource === undefined
    ? null
    : Number(amountSource);
  const tagsSource = Array.isArray(rawValue.tags)
    ? rawValue.tags
    : Array.isArray(rawFallback.tags)
      ? rawFallback.tags
      : [];
  return {
    code: String(rawValue.code ?? rawFallback.code ?? "").trim().toUpperCase().slice(0, 20),
    market: String(rawValue.market ?? rawFallback.market ?? "kr").trim().toLowerCase().slice(0, 12) || "kr",
    symbol: String(rawValue.symbol ?? rawFallback.symbol ?? "").trim().toUpperCase().slice(0, 24),
    currentValueKrw: amount !== null && Number.isFinite(amount) && amount >= 0 ? amount : null,
    benchmark: String(rawValue.benchmark ?? rawFallback.benchmark ?? "kospi").trim().slice(0, 24) || "kospi",
    tags: tagsSource.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
  };
}

function hydrateHolding(row: HoldingRow): ManagedHolding {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(String(row.tagsJson || "[]"));
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sortOrder),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...normalizePosition({
      code: row.code,
      market: row.market,
      symbol: row.symbol,
      currentValueKrw: row.currentValueKrw,
      benchmark: row.benchmark,
      tags,
    }),
  };
}

function cloneHolding(holding: ManagedHolding) {
  return { ...holding, tags: [...holding.tags] };
}

async function assertD1UniqueName(db: D1DatabaseLike, name: string, exceptId = "") {
  const existing = await db
    .prepare("SELECT id FROM managed_holdings WHERE lower(name) = lower(?) AND id != ? LIMIT 1")
    .bind(name, exceptId)
    .first<{ id: string }>();
  if (existing) throw storeError("duplicate_name", 409);
}

function assertUniqueName(holdings: ManagedHolding[], name: string, exceptId = "") {
  const normalized = name.toLocaleLowerCase();
  if (
    holdings.some(
      (holding) => holding.id !== exceptId && holding.name.toLocaleLowerCase() === normalized,
    )
  ) {
    throw storeError("duplicate_name", 409);
  }
}

export function storeError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}
