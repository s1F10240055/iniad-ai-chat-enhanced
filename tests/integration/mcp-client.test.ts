import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpClient } from "../../src/main/services/mcp-client";
import { MoocsPageReader } from "../../src/main/services/moocs-page-reader";

const username = process.env.INIAD_USERNAME;
const password = process.env.INIAD_PASSWORD;
const hasCredentials = !!(username && password);

describe.skipIf(!hasCredentials)("McpClient + MoocsPageReader (integration)", () => {
  let client: McpClient;
  let pageReader: MoocsPageReader;

  beforeAll(async () => {
    client = new McpClient();
    pageReader = new MoocsPageReader(client);
    await client.connect(username!, password!);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it("should be connected after connect()", () => {
    expect(client.getStatus()).toBe("connected");
  });

  it("should read HTML review page without Google login", async () => {
    const url = "https://moocs.iniad.org/courses/2026/COS201/01/review";
    const result = await pageReader.readPage(url);

    expect(result.content).toContain(url);
    expect(result.content).toContain("Page kind: review");
    expect(result.citations.some((c) => c.url === url)).toBe(true);
  });

  it("should expose Google login and expandSlideTab MCP tools", async () => {
    await expect(client.loginToGoogle()).resolves.toBeUndefined();
    await expect(client.expandSlideTab()).resolves.toBeUndefined();
  });

  it("should have disconnected status after disconnect()", async () => {
    const tempClient = new McpClient();
    await tempClient.connect(username!, password!);
    expect(tempClient.getStatus()).toBe("connected");

    await tempClient.disconnect();
    expect(tempClient.getStatus()).toBe("disconnected");
  });
});
