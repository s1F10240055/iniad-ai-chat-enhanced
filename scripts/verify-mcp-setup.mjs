/**
 * MCP Setup Verification Script
 * 
 * Role C (W1) - C07: MCP server startup verification
 * 
 * This script verifies:
 * 1. @modelcontextprotocol/sdk is installed and importable
 * 2. @rarandeyo/iniad-moocs-mcp CLI is discoverable
 * 3. Playwright + Chromium are available
 * 4. MCP server can be started via stdio transport
 * 5. Tool discovery (listTools) works
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

function log(section, message, status = 'info') {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : 'ℹ️';
  console.log(`  ${icon} [${section}] ${message}`);
  if (status === 'pass') passed++;
  if (status === 'fail') failed++;
}

console.log('\n🔍 MCP Setup Verification for Role C\n');
console.log('=' .repeat(60));

// ──────────────────────────────────────────────
// Test 1: SDK Package
// ──────────────────────────────────────────────
console.log('\n📦 1. Verifying @modelcontextprotocol/sdk');
try {
  const sdkPkg = require('@modelcontextprotocol/sdk/package.json');
  log('SDK', `Version: ${sdkPkg.version}`, 'pass');
} catch (e) {
  log('SDK', `Failed to load SDK package: ${e.message}`, 'fail');
  process.exit(1);
}

// ──────────────────────────────────────────────
// Test 2: Client class
// ──────────────────────────────────────────────
console.log('\n📦 2. Verifying MCP Client import');
try {
  const client = new Client({ name: 'verify-test', version: '1.0.0' }, { capabilities: {} });
  log('Client', 'Client class imported and instantiated successfully', 'pass');
} catch (e) {
  log('Client', `Failed to create Client: ${e.message}`, 'fail');
}

// ──────────────────────────────────────────────
// Test 3: iniad-moocs-mcp package
// ──────────────────────────────────────────────
console.log('\n📦 3. Verifying @rarandeyo/iniad-moocs-mcp');
try {
  const moocsPkg = require('@rarandeyo/iniad-moocs-mcp/package.json');
  log('MOOCs MCP', `Version: ${moocsPkg.version}`, 'pass');
  
  // cli.js is not in "exports", resolve via package directory
  const pkgDir = path.dirname(require.resolve('@rarandeyo/iniad-moocs-mcp/package.json'));
  const cliPath = path.join(pkgDir, 'cli.js');
  if (fs.existsSync(cliPath)) {
    log('MOOCs MCP', `CLI path: ${cliPath}`, 'pass');
  } else {
    log('MOOCs MCP', `CLI not found at: ${cliPath}`, 'fail');
  }
} catch (e) {
  log('MOOCs MCP', `Failed: ${e.message}`, 'fail');
}

// ──────────────────────────────────────────────
// Test 4: Playwright / Chromium
// ──────────────────────────────────────────────
console.log('\n🌐 4. Verifying Playwright & Chromium');
try {
  const { chromium } = await import('playwright');
  log('Playwright', 'Playwright module imported', 'pass');
  
  const execPath = chromium.executablePath();
  if (!execPath) {
    log('Chromium', 'Executable path not found - run: npx playwright install chromium', 'fail');
  } else if (!fs.existsSync(execPath)) {
    log('Chromium', `Binary does not exist at: ${execPath}`, 'fail');
  } else {
    log('Chromium', `Executable exists: ${execPath}`, 'pass');
    // Verify the binary actually launches
    let browser;
    try {
      browser = await chromium.launch({ headless: true, timeout: 10_000 });
      log('Chromium', 'Browser launched successfully', 'pass');
    } finally {
      await browser?.close().catch(() => {});
    }
  }
} catch (e) {
  log('Playwright', `Failed: ${e.message}`, 'fail');
}

// ──────────────────────────────────────────────
// Test 5: MCP Server via stdio (launch + listTools)
// ──────────────────────────────────────────────
console.log('\n🔌 5. Testing MCP Server via stdio transport');
console.log('   (Starting iniad-moocs-mcp server, this may take a moment...)');

let transport;
let client;

try {
  // cli.js is not in "exports", resolve via package directory
  const pkgDir = path.dirname(require.resolve('@rarandeyo/iniad-moocs-mcp/package.json'));
  const cliPath = path.join(pkgDir, 'cli.js');
  
  transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, '--headless'],
    env: {
      ...process.env,
      INIAD_USERNAME: 'test_verify_user',
      INIAD_PASSWORD: 'test_verify_pass',
    },
  });

  client = new Client(
    { name: 'verify-test', version: '1.0.0' },
    { capabilities: {} }
  );

  // Timeout helper: only used for connect() which lacks a built-in timeout option
  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
      ),
    ]);

  try {
    await withTimeout(client.connect(transport), 15_000, 'client.connect');
    log('Server', 'Connected to MCP server via stdio', 'pass');
  } catch (connectErr) {
    throw new Error(`Connection failed: ${connectErr.message}`);
  }

  // List tools - iniad-moocs-mcp (v0.0.4) was built with an older SDK
  // whose tool inputSchema doesn't pass the newer SDK v1.29.0's strict
  // validation. We use the public client.request() API with a relaxed
  // schema (z.any()) to bypass the strict validation.
  // SDK supports per-request timeout via RequestOptions (3rd argument).
  let toolNames = [];
  try {
    // First try the standard listTools() with SDK-native timeout
    const toolsResult = await client.listTools({}, { timeout: 10_000 });
    toolNames = toolsResult.tools.map(t => t.name);
    log('Tools', `Discovered ${toolNames.length} tools`, 'pass');
  } catch (listErr) {
    // Fallback: use public client.request() with relaxed schema and SDK-native timeout
    log('Tools', `listTools() compat issue (expected), using client.request()...`, 'info');
    const { z } = await import('zod');
    const result = await client.request(
      { method: 'tools/list', params: {} },
      z.object({ tools: z.any() }),
      { timeout: 10_000 }
    );
    
    if (result && result.tools) {
      toolNames = result.tools.map(t => t.name);
      log('Tools', `Discovered ${toolNames.length} tools (via client.request)`, 'pass');
    } else {
      log('Tools', 'No tools found in response', 'fail');
    }
  }
  
  // Check for expected INIAD-specific tools
  const expectedTools = [
    'loginToIniadMoocsWithIniadAccount',
    'listCourses',
    'listLectureLinks', 
    'listSlideLinks',
    'browser_navigate',
    'browser_snapshot',
    'loginToGoogleWithIniadAccount',
    'expandSlideTab',
    'extractGoogleSlideText',
  ];
  
  for (const expected of expectedTools) {
    if (toolNames.includes(expected)) {
      log('Tools', `Found: ${expected}`, 'pass');
    } else {
      log('Tools', `Missing: ${expected}`, 'fail');
    }
  }

  console.log('\n   All available tools:');
  for (const name of toolNames) {
    console.log(`     - ${name}`);
  }
  
} catch (e) {
  log('Server', `MCP server test failed: ${e.message}`, 'fail');
  if (e.cause) {
    log('Server', `  Cause: ${e.cause.message || e.cause}`, 'fail');
  }
} finally {
  // Clean up: close client and kill the child process, log outcome
  let cleanupOk = true;
  try {
    await client?.close();
  } catch (closeErr) {
    log('Server', `Client close failed: ${closeErr.message}`, 'fail');
    cleanupOk = false;
  }
  try {
    transport?.process?.kill?.();
  } catch (killErr) {
    log('Server', `Process kill failed: ${killErr.message}`, 'fail');
    cleanupOk = false;
  }
  if (cleanupOk) {
    log('Server', 'Client disconnected cleanly', 'pass');
  }
}

// ──────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────
console.log('\n' + '=' .repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('⚠️  Some checks failed. Please fix the issues above.\n');
  process.exit(1);
} else {
  console.log('🎉 All MCP setup checks passed! Ready for Role C development.\n');
  process.exit(0);
}
