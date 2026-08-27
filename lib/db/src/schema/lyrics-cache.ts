import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const lyricsCacheTable = pgTable("lyrics_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LyricsCacheRow = typeof lyricsCacheTable.$inferSelect;
export type InsertLyricsCacheRow = typeof lyricsCacheTable.$inferInsert;
