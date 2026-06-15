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
import { MoocsPageReader } from "../main/services/moocs-page-reader";

const username = process.env.INIAD_USERNAME;
const password = process.env.INIAD_PASSWORD;

if (!username || !password) {
  console.error("Error: INIAD_USERNAME and INIAD_PASSWORD environment variables are required.");
  process.exit(1);
}

const client = new McpClient();
const pageReader = new MoocsPageReader(client);

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

async function cmdNavigate(url: string) {
  if (!url) {
    logError("Usage: navigate <url>");
    return;
  }
  if (!url.startsWith("https://moocs.iniad.org/")) {
    logError("URL must be a moocs.iniad.org URL");
    return;
  }
  console.log(`\n⟳ Navigating to: ${url}...`);
  await client.navigateTo(url);
  logOk(`Navigated to ${url}`);
}

async function cmdRead(url: string) {
  if (!url) {
    logError("Usage: read <url>");
    return;
  }
  if (!url.startsWith("https://moocs.iniad.org/")) {
    logError("URL must be a moocs.iniad.org URL");
    return;
  }
  console.log(`\n⟳ Reading: ${url}...`);
  const result = await pageReader.readPage(url);
  log("Page Content", { content: result.content, citations: result.citations });
}

function cmdHelp() {
  console.log(`
Available commands:
  connect            Connect to MCP server
  disconnect         Disconnect from MCP server
  status             Show connection status
  navigate <url>     Navigate to a MOOCs URL
  read <url>         Read MOOCs page content (slide or HTML)
  help               Show this help
  quit / exit        Exit the inspector
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
        case "navigate":
          await cmdNavigate(args.join(" "));
          break;
        case "read":
          await cmdRead(args.join(" "));
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
