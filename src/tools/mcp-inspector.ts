/**
 * MCP Inspector — MCP 接続の検査・デバッグ用 CLI ツール
 *
 * 使い方:
 *   npx tsx src/tools/mcp-inspector.ts
 *
 * 環境変数 INIAD_USERNAME / INIAD_PASSWORD が必要です。
 * インタラクティブモードで各種コマンドを実行できます。
 */

import * as readline from "readline";
import { McpClient } from "../main/services/mcp-client";

const username = process.env.INIAD_USERNAME;
const password = process.env.INIAD_PASSWORD;

if (!username || !password) {
  console.error("Error: INIAD_USERNAME and INIAD_PASSWORD environment variables are required.");
  process.exit(1);
}

const client = new McpClient();

// ── Helpers ──────────────────────────────────────────────

function log(label: string, data: unknown) {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(data, null, 2));
}

function logError(message: string) {
  console.error(`\n✗ ${message}`);
}

function logOk(message: string) {
  console.log(`\n✓ ${message}`);
}

// ── Commands ──────────────────────────────────────────────

async function cmdStatus() {
  log("MCP Status", { status: client.getStatus() });
}

async function cmdConnect() {
  try {
    console.log("\n⟳ Connecting...");
    await client.connect(username, password);
    logOk(`Connected (status: ${client.getStatus()})`);
  } catch (error) {
    logError(`Connection failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function cmdDisconnect() {
  await client.disconnect();
  logOk(`Disconnected (status: ${client.getStatus()})`);
}

async function cmdSearch(query: string) {
  if (!query) {
    logError("Usage: search <query>");
    return;
  }
  console.log(`\n⟳ Searching: "${query}"...`);
  const result = await client.searchMoocs(query);
  if (result.success) {
    log(`Search Results (${result.results.length} items)`, result.results);
  } else {
    logError(`Search failed: ${result.error}`);
  }
}

async function cmdCache() {
  console.log("\n⟳ Running cache cleanup...");
  client.cleanupCache();
  logOk("Cache cleanup completed");
}

function cmdHelp() {
  console.log(`
Available commands:
  connect        Connect to MCP server
  disconnect     Disconnect from MCP server
  status         Show connection status
  search <q>     Search MOOCs content
  cache          Run cache cleanup
  help           Show this help
  quit / exit    Exit the inspector
`);
}

// ── REPL ──────────────────────────────────────────────────

async function runREPL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "mcp> ",
  });

  console.log("MCP Inspector — type 'help' for available commands\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      const [cmd, ...args] = input.split(/\s+/);

      switch (cmd) {
        case "connect":
          await cmdConnect();
          break;
        case "disconnect":
          await cmdDisconnect();
          break;
        case "status":
          await cmdStatus();
          break;
        case "search":
          await cmdSearch(args.join(" "));
          break;
        case "cache":
          await cmdCache();
          break;
        case "help":
          cmdHelp();
          break;
        case "quit":
        case "exit":
          console.log("Bye!");
          await client.disconnect().catch(() => {});
          rl.close();
          return;
        default:
          logError(`Unknown command: ${cmd}. Type 'help' for available commands.`);
      }
    } catch (error) {
      logError(error instanceof Error ? error.message : String(error));
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    await client.disconnect().catch(() => {});
    process.exit(0);
  });
}

runREPL();
