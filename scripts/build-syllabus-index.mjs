#!/usr/bin/env node

/**
 * シラバスインデックス生成スクリプト
 *
 * 東洋大学シラバスサイトから講義情報をスクレイピングし、
 * INIAD API (LLM) で構造化データを抽出して JSON インデックスを生成する。
 *
 * Usage:
 *   INIAD_API_KEY=xxx SYLLABUS_COURSE_NAMES="講義A\n講義B" npm run build:syllabus-index
 */

import { load as cheerioLoad } from "cheerio";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ── 環境変数 ──────────────────────────────────────────

const COURSE_NAMES = (process.env.SYLLABUS_COURSE_NAMES || "").trim();
const API_KEY = process.env.INIAD_API_KEY || "";
const API_URL = process.env.INIAD_API_URL || "https://api.openai.iniad.org/api/v1";
const MODEL = process.env.INIAD_MODEL || "gpt-4o-mini";
const ACADEMIC_YEAR = process.env.SYLLABUS_ACADEMIC_YEAR || String(new Date().getFullYear());
const OUTPUT_PATH = process.env.SYLLABUS_OUTPUT_PATH || "data/syllabus-index.json";

const SYLLABUS_BASE = "https://g-sys.toyo.ac.jp/syllabus";
const REQUEST_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 30_000;

// ── バリデーション ────────────────────────────────────

if (!COURSE_NAMES) {
  console.error("Error: SYLLABUS_COURSE_NAMES is required");
  process.exit(1);
}
if (!API_KEY) {
  console.error("Error: INIAD_API_KEY is required");
  process.exit(1);
}

// ── ユーティリティ ────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function courseNames() {
  return COURSE_NAMES.split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
}

// ── スクレイピング ────────────────────────────────────

async function searchSyllabus(courseName) {
  const url = `${SYLLABUS_BASE}/result`;
  const params = new URLSearchParams({
    nendo: ACADEMIC_YEAR,
    gakubu: "情報連携学部",
    kamoku: courseName,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Syllabus search failed (${res.status}) for "${courseName}"`);
  }

  return res.text();
}

function extractDetailUrls(html) {
  const $ = cheerioLoad(html);
  const urls = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.includes("/syllabus/html/gakugai/")) {
      const full = new URL(href, `${SYLLABUS_BASE}/result`).href;
      if (!urls.includes(full)) urls.push(full);
    }
  });

  return urls;
}

async function fetchDetailPage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Failed to fetch detail page (${res.status}): ${url}`);
  }
  return res.text();
}

function extractStructuredText(html) {
  const $ = cheerioLoad(html);

  const tables = [];
  $("table").each((_, table) => {
    const rows = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = [];
        $(tr)
          .find("th, td")
          .each((_, cell) => {
            cells.push($(cell).text().trim().replace(/\s+/g, " "));
          });
        if (cells.length > 0) rows.push(cells.join(" | "));
      });
    if (rows.length > 0) tables.push(rows.join("\n"));
  });

  return tables.join("\n\n");
}

// ── LLM 抽出 ─────────────────────────────────────────

const EXTRACTION_PROMPT = `以下は東洋大学シラバスのHTMLから抽出したテキストです。
このテキストから講義情報を構造化JSONとして抽出してください。

出力フォーマット（JSONのみ、他のテキストは一切出力しない）:
{
  "courseName": "科目名",
  "subtitle": "サブタイトル（あれば）",
  "instructor": "担当者名",
  "courseCode": "授業コード",
  "description": "講義の目的・内容の要約",
  "objectives": "学修到達目標の要約",
  "schedule": [
    {"week": 1, "topic": "第1回のトピック"},
    {"week": 2, "topic": "第2回のトピック"}
  ],
  "prerequisites": ["前提科目名1", "前提科目名2"],
  "keywords": ["キーワード1", "keyword2"]
}

注意事項:
- schedule は第1回〜第15回のすべてを抽出する
- keywords は日本語・英語合わせて10〜20個抽出する
- 情報が見つからないフィールドは空文字または空配列にする
- JSON以外は絶対に出力しない`;

async function extractWithLLM(structuredText) {
  const MAX_INPUT = 8000;
  let truncated;
  if (structuredText.length > MAX_INPUT) {
    const half = MAX_INPUT / 2;
    truncated = structuredText.slice(0, half) + "\n…(中略)…\n" + structuredText.slice(-half);
  } else {
    truncated = structuredText;
  }

  const res = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: truncated },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`LLM API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM output is not valid JSON");
  }

  return JSON.parse(jsonMatch[0]);
}

// ── バリデーション ────────────────────────────────────

function validateEntry(raw) {
  return {
    courseName: String(raw.courseName || ""),
    subtitle: raw.subtitle ? String(raw.subtitle) : undefined,
    instructor: raw.instructor ? String(raw.instructor) : undefined,
    courseCode: raw.courseCode ? String(raw.courseCode) : undefined,
    description: raw.description ? String(raw.description) : undefined,
    objectives: raw.objectives ? String(raw.objectives) : undefined,
    schedule: Array.isArray(raw.schedule)
      ? raw.schedule
          .filter((s) => typeof s.week === "number" && typeof s.topic === "string")
          .map((s) => ({ week: s.week, topic: s.topic }))
      : [],
    prerequisites: Array.isArray(raw.prerequisites)
      ? raw.prerequisites.filter((p) => typeof p === "string")
      : [],
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.filter((k) => typeof k === "string")
      : [],
    syllabusUrl: undefined,
    status: "ok",
  };
}

// ── メイン処理 ────────────────────────────────────────

async function processCourse(courseName) {
  console.log(`\n🔍 Processing: ${courseName}`);

  try {
    const searchHtml = await searchSyllabus(courseName);
    const detailUrls = extractDetailUrls(searchHtml);

    if (detailUrls.length === 0) {
      console.warn(`  ⚠ No detail page found for "${courseName}"`);
      return {
        courseName,
        schedule: [],
        prerequisites: [],
        keywords: [],
        status: "partial",
      };
    }

    await delay(REQUEST_DELAY_MS);

    const detailHtml = await fetchDetailPage(detailUrls[0]);
    const structuredText = extractStructuredText(detailHtml);

    await delay(REQUEST_DELAY_MS);

    const raw = await extractWithLLM(structuredText);
    const entry = validateEntry(raw);
    entry.syllabusUrl = detailUrls[0];

    console.log(
      `  ✅ ${entry.courseName} — ${entry.schedule.length} weeks, ${entry.keywords.length} keywords`
    );
    return entry;
  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
    return {
      courseName,
      schedule: [],
      prerequisites: [],
      keywords: [],
      status: "error",
    };
  }
}

async function main() {
  const names = courseNames();
  console.log(`Building syllabus index for ${names.length} courses...`);

  const courses = [];
  for (const name of names) {
    const entry = await processCourse(name);
    courses.push(entry);
    await delay(REQUEST_DELAY_MS);
  }

  const okCount = courses.filter((c) => c.status === "ok").length;
  const partialCount = courses.filter((c) => c.status === "partial").length;
  const errorCount = courses.filter((c) => c.status === "error").length;

  const index = {
    academicYear: Number(ACADEMIC_YEAR),
    faculty: "情報連携学部",
    generatedAt: new Date().toISOString(),
    courses,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2), "utf-8");

  console.log(
    `\n📄 Written to ${OUTPUT_PATH}` +
      `\n   Total: ${courses.length} courses (ok: ${okCount}, partial: ${partialCount}, error: ${errorCount})`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
