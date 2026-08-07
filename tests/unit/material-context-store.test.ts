import { describe, expect, it } from "vitest";
import {
  InMemoryStore,
  MATERIAL_CONTEXT_LIMITS,
  MATERIAL_METADATA_LIMITS,
} from "../../src/main/services/in-memory-store";

function addMaterial(
  store: InMemoryStore,
  suffix: string,
  content: string,
  title = `資料 ${suffix}`
): void {
  store.addMaterial({
    title,
    url: `https://moocs.iniad.org/courses/2026/COS201/01/${suffix}`,
    content,
    sourceType: "moocs",
  });
}

describe("InMemoryStore material context", () => {
  it("manages conversation history and material context independently", () => {
    const store = new InMemoryStore();
    store.addMessage({
      id: "message-1",
      role: "user",
      content: "質問",
      timestamp: new Date().toISOString(),
    });
    addMaterial(store, "01", "C言語のポインタとメモリについての本文");

    store.clearConversationHistory();
    expect(store.getHistory()).toHaveLength(0);
    expect(store.getMaterialContextSummaries()).toHaveLength(1);

    store.clearMaterialContext();
    expect(store.getMaterialContextSummaries()).toHaveLength(0);
  });

  it("deduplicates normalized URLs and evicts the oldest entry at the fixed limit", () => {
    const store = new InMemoryStore();
    for (let i = 0; i < MATERIAL_CONTEXT_LIMITS.maxEntries + 5; i++) {
      addMaterial(store, String(i).padStart(2, "0"), `本文 ${i}`);
    }
    const latestSuffix = String(MATERIAL_CONTEXT_LIMITS.maxEntries + 4).padStart(2, "0");

    expect(store.getMaterialContextCount()).toBe(MATERIAL_CONTEXT_LIMITS.maxEntries);
    expect(store.getMaterialContextSummaries().some((item) => item.url.endsWith("/00"))).toBe(
      false
    );

    store.addMaterial({
      title: "詳細な資料タイトル",
      url: `https://moocs.iniad.org/courses/2026/COS201/01/${latestSuffix}/`,
      content: "更新された、より詳しい資料本文です。",
      location: `第1回 / 資料${latestSuffix}`,
    });
    expect(store.getMaterialContextCount()).toBe(MATERIAL_CONTEXT_LIMITS.maxEntries);
    expect(store.getMaterialContextSummaries()[0]).toMatchObject({
      title: "詳細な資料タイトル",
      location: `第1回 / 資料${latestSuffix}`,
      url: `https://moocs.iniad.org/courses/2026/COS201/01/${latestSuffix}`,
    });
  });

  it("selects at most three lexically relevant materials and only bounded excerpts", () => {
    const store = new InMemoryStore();
    addMaterial(
      store,
      "01",
      `${"無関係な前置き。".repeat(400)}ポインタはメモリアドレスを保持する。`
    );
    addMaterial(store, "02", "TCPは信頼性のあるトランスポートプロトコルである。");
    addMaterial(store, "03", "データベースの正規化とトランザクションについて説明する。");
    addMaterial(store, "04", "ポインタ演算と配列の関係を説明する。");

    const selected = store.selectRelevantMaterials("C言語のポインタとメモリを説明して");

    expect(selected.length).toBeLessThanOrEqual(MATERIAL_CONTEXT_LIMITS.maxSelectedEntries);
    expect(selected[0].content).toMatch(/ポインタ|メモリ/);
    expect(selected.some((item) => item.url.endsWith("/02"))).toBe(false);
    expect(selected.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(
      MATERIAL_CONTEXT_LIMITS.maxSelectedChars
    );
  });

  it("prefers recent materials for an explicit prior-material reference", () => {
    const store = new InMemoryStore();
    addMaterial(store, "01", "ポインタとメモリの詳しい説明");
    addMaterial(store, "02", "TCPとUDPの説明");
    addMaterial(store, "03", "データベースの説明");
    addMaterial(store, "04", "情報セキュリティの説明");

    const recent = store.selectRelevantMaterials("以前の資料を踏まえて説明して");
    expect(recent.map((item) => item.url.slice(-2))).toEqual(["04", "03", "02"]);

    const relevant = store.selectRelevantMaterials("以前の資料を踏まえてポインタを説明して");
    expect(relevant[0].url).toMatch(/\/01$/);
    store.markMaterialsReferenced(relevant.map((item) => item.id));

    const reusedRecently = store.selectRelevantMaterials("以前の資料を踏まえて説明して");
    expect(reusedRecently[0].url).toMatch(/\/01$/);
  });

  it("does not retain tool errors or non-HTTPS URLs as material", () => {
    const store = new InMemoryStore();
    store.addMaterial({
      title: "error",
      url: "https://example.com/error",
      content: "Error: failed",
    });
    store.addMaterial({ title: "file", url: "file:///tmp/secret", content: "secret" });
    store.addMaterial({ title: "http", url: "http://example.com/material", content: "secret" });
    expect(store.getMaterialContextCount()).toBe(0);
  });

  it("bounds material metadata and rejects oversized URLs", () => {
    const store = new InMemoryStore();
    store.addMaterial({
      title: "T".repeat(500),
      location: "L".repeat(500),
      url: "https://example.com/material",
      content: "useful content",
    });
    store.addMaterial({
      title: "oversized URL",
      url: `https://example.com/${"x".repeat(MATERIAL_METADATA_LIMITS.maxUrlChars)}`,
      content: "must not be retained",
    });

    const [summary] = store.getMaterialContextSummaries();
    expect(summary.title).toHaveLength(MATERIAL_METADATA_LIMITS.maxTitleChars);
    expect(summary.location).toHaveLength(MATERIAL_METADATA_LIMITS.maxLocationChars);
    expect(store.getMaterialContextCount()).toBe(1);
  });
});

describe("InMemoryStore MCP connection state", () => {
  it("clears stale retry diagnostics when the status becomes connected", () => {
    const store = new InMemoryStore();
    const lastConnectedAt = "2026-08-07T12:00:00.000Z";
    store.setMcpConnectionState({
      status: "error",
      lastConnectedAt,
      attempt: 3,
      maxAttempts: 3,
      error: {
        code: "MCP_CONNECTION_FAILED",
        message: "接続に失敗しました。",
        guidance: "再接続してください。",
        retryable: true,
      },
    });

    store.setMcpStatus("connected");

    expect(store.getMcpConnectionState()).toEqual({
      status: "connected",
      lastConnectedAt,
    });
  });
});
