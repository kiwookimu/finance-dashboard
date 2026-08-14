import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const managedHoldings = sqliteTable(
  "managed_holdings",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_managed_holdings_name").on(table.name),
    index("idx_managed_holdings_sort_order").on(table.sortOrder),
  ],
);

export const holdingStoreMeta = sqliteTable("holding_store_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const holdingPositions = sqliteTable(
  "holding_positions",
  {
    holdingId: text("holding_id")
      .primaryKey()
      .references(() => managedHoldings.id, { onDelete: "cascade" }),
    code: text("code").notNull().default(""),
    market: text("market").notNull().default("kr"),
    symbol: text("symbol").notNull().default(""),
    currentValueKrw: real("current_value_krw"),
    benchmark: text("benchmark").notNull().default("kospi"),
    tagsJson: text("tags_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_holding_positions_code").on(table.code)],
);
