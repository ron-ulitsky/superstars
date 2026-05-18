#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { closePool, query } from "../lib/db.mjs";

try {
  const schema = await readFile(new URL("../sql/schema.sql", import.meta.url), "utf8");
  await query(schema);
  console.log("Database schema is up to date.");
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
