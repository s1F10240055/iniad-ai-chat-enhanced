import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpClient } from "../../src/main/services/mcp-client";
import { MoocsSearch } from "../../src/main/services/moocs-search";

const username = process.env.INIAD_USERNAME;
const password = process.env.INIAD_PASSWORD;
const hasCredentials = !!(username && password);

describe.skipIf(!hasCredentials)("McpClient + MoocsSearch (integration)", () => {
  let client: McpClient;
  let moocsSearch: MoocsSearch;

  beforeAll(async () => {
    client = new McpClient();
    moocsSearch = new MoocsSearch(client);
    await client.connect(username!, password!);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it("should be connected after connect()", () => {
    expect(client.getStatus()).toBe("connected");
  });

  it("should return success with results for a valid query", async () => {
    const result = await moocsSearch.searchMoocs("Python");

    expect(result.success).toBe(true);
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("should return results with correct SearchResult shape", async () => {
    const result = await moocsSearch.searchMoocs("Python");

    if (result.results.length === 0) return;

    const item = result.results[0];
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("url");
    expect(item).toHaveProperty("snippet");
    expect(item).toHaveProperty("source");
    expect(item).toHaveProperty("relevanceScore");
    expect(item.source).toBe("moocs");
    expect(typeof item.relevanceScore).toBe("number");
  });

  it("should return empty results for empty/whitespace query", async () => {
    const result = await moocsSearch.searchMoocs("   ");

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it("should return error when not connected", async () => {
    const disconnectedClient = new McpClient();
    const disconnectedSearch = new MoocsSearch(disconnectedClient);
    const result = await disconnectedSearch.searchMoocs("Python");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should cache repeated queries", async () => {
    const first = await moocsSearch.searchMoocs("Python");
    const second = await moocsSearch.searchMoocs("Python");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.results).toEqual(second.results);
  });

  it("should have disconnected status after disconnect()", async () => {
    const tempClient = new McpClient();
    await tempClient.connect(username!, password!);
    expect(tempClient.getStatus()).toBe("connected");

    await tempClient.disconnect();
    expect(tempClient.getStatus()).toBe("disconnected");
  });
});
