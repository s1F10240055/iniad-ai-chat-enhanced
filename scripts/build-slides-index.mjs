#!/usr/bin/env node

/**
 * スライドインデックス生成・更新スクリプト
 *
 * Usage:
 *   SLIDES_ENTRIES_FILE=path/to/new-entries.json npm run build:slides-index
 *
 * new-entries.json は SlideIndexEntry の配列、または { "entries": [...] } 形式。
 * 既存 data/slides-index.json と moocsUrl でマージする。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT_PATH = process.env.SLIDES_OUTPUT_PATH || join(ROOT, "data", "slides-index.json");
const ENTRIES_FILE = process.env.SLIDES_ENTRIES_FILE || "";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function normalizeEntries(data) {
  if (Array.isArray(data)) return data;
  if (data?.entries && Array.isArray(data.entries)) return data.entries;
  return [];
}

let existing = { version: 1, generatedAt: new Date().toISOString(), entries: [] };
if (existsSync(OUTPUT_PATH)) {
  existing = loadJson(OUTPUT_PATH);
}

const byUrl = new Map((existing.entries || []).map((e) => [e.moocsUrl, e]));

if (ENTRIES_FILE) {
  const incoming = normalizeEntries(loadJson(ENTRIES_FILE));
  for (const entry of incoming) {
    if (!entry.moocsUrl || !entry.text) {
      console.warn("Skipping invalid entry (moocsUrl and text required):", entry.slideTitle);
      continue;
    }
    byUrl.set(entry.moocsUrl, entry);
  }
  console.log(`Merged ${incoming.length} entries from ${ENTRIES_FILE}`);
} else {
  console.log("No SLIDES_ENTRIES_FILE set; refreshing generatedAt only.");
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  entries: [...byUrl.values()],
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
console.log(`Wrote ${output.entries.length} entries to ${OUTPUT_PATH}`);
