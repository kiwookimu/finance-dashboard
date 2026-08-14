import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
