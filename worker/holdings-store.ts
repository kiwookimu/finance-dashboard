import seedSource from "../managed-holdings.json";

export type ManagedHolding = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

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

const SEED_VERSION_KEY = "managed_holdings_seed_version";
const seedHoldings: ManagedHolding[] = seedSource.holdings.map((holding) => ({
  id: String(holding.id),
  name: String(holding.name),
  sortOrder: Number(holding.sortOrder),
}));

let memoryHoldings = seedHoldings.map((holding) => ({ ...holding }));
let initializationPromise: Promise<void> | null = null;

export function normalizeHoldingName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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
      return memoryHoldings.map((holding) => ({ ...holding }));
    },
    async create(name: string) {
      assertUniqueName(memoryHoldings, name);
      const holding = {
        id: crypto.randomUUID(),
        name,
        sortOrder: Math.max(0, ...memoryHoldings.map((item) => item.sortOrder)) + 1,
      };
      memoryHoldings.push(holding);
      return { ...holding };
    },
    async update(id: string, name: string) {
      const index = memoryHoldings.findIndex((holding) => holding.id === id);
      if (index < 0) throw storeError("not_found", 404);
      assertUniqueName(memoryHoldings, name, id);
      memoryHoldings[index] = { ...memoryHoldings[index], name };
      return { ...memoryHoldings[index] };
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
  return {
    async list() {
      await ready();
      const result = await db
        .prepare(
          `SELECT id, name, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
           FROM managed_holdings
           ORDER BY sort_order ASC, created_at ASC`,
        )
        .all<ManagedHolding>();
      return result.results ?? [];
    },
    async create(name: string) {
      await ready();
      await assertD1UniqueName(db, name);
      const maxRow = await db
        .prepare("SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder FROM managed_holdings")
        .first<{ maxSortOrder: number }>();
      const holding = {
        id: crypto.randomUUID(),
        name,
        sortOrder: Number(maxRow?.maxSortOrder) + 1,
      };
      await db
        .prepare("INSERT INTO managed_holdings (id, name, sort_order) VALUES (?, ?, ?)")
        .bind(holding.id, holding.name, holding.sortOrder)
        .run();
      return holding;
    },
    async update(id: string, name: string) {
      await ready();
      const existing = await db
        .prepare("SELECT id FROM managed_holdings WHERE id = ?")
        .bind(id)
        .first<{ id: string }>();
      if (!existing) throw storeError("not_found", 404);
      await assertD1UniqueName(db, name, id);
      await db
        .prepare(
          "UPDATE managed_holdings SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(name, id)
        .run();
      const updated = await db
        .prepare(
          `SELECT id, name, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
           FROM managed_holdings WHERE id = ?`,
        )
        .bind(id)
        .first<ManagedHolding>();
      if (!updated) throw storeError("not_found", 404);
      return updated;
    },
    async remove(id: string) {
      await ready();
      const existing = await db
        .prepare("SELECT id FROM managed_holdings WHERE id = ?")
        .bind(id)
        .first<{ id: string }>();
      if (!existing) throw storeError("not_found", 404);
      await db.prepare("DELETE FROM managed_holdings WHERE id = ?").bind(id).run();
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
  ]);

  const seeded = await db
    .prepare("SELECT value FROM holding_store_meta WHERE key = ?")
    .bind(SEED_VERSION_KEY)
    .first<{ value: string }>();
  if (seeded) return;

  await db.batch([
    ...seedHoldings.map((holding) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO managed_holdings (id, name, sort_order) VALUES (?, ?, ?)",
        )
        .bind(holding.id, holding.name, holding.sortOrder),
    ),
    db
      .prepare("INSERT OR REPLACE INTO holding_store_meta (key, value) VALUES (?, ?)")
      .bind(SEED_VERSION_KEY, String(seedSource.version)),
  ]);
  await db.prepare("PRAGMA optimize").run();
}

async function assertD1UniqueName(db: D1DatabaseLike, name: string, exceptId = "") {
  const existing = await db
    .prepare(
      "SELECT id FROM managed_holdings WHERE lower(name) = lower(?) AND id != ? LIMIT 1",
    )
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
