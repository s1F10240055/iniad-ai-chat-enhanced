import { createRequire } from "module";
import path from "path";
import { describe, expect, it, vi } from "vitest";

const moduleRequire = createRequire(path.resolve("package.json"));
const { isAllowedMcpBrowserUrl, installPlaywrightNetworkPolicy } = moduleRequire(
  "./scripts/mcp-network-policy.cjs"
) as {
  isAllowedMcpBrowserUrl(url: string): boolean;
  installPlaywrightNetworkPolicy(playwright: unknown): void;
};

describe("MCP browser network policy", () => {
  it("allows only HTTPS INIAD/Google resources and safe internal URLs", () => {
    expect(isAllowedMcpBrowserUrl("https://moocs.iniad.org/courses")).toBe(true);
    expect(isAllowedMcpBrowserUrl("https://docs.google.com/presentation/d/1")).toBe(true);
    expect(isAllowedMcpBrowserUrl("wss://docs.google.com/socket")).toBe(true);
    expect(isAllowedMcpBrowserUrl("about:blank")).toBe(true);
    expect(isAllowedMcpBrowserUrl("http://moocs.iniad.org/courses")).toBe(false);
    expect(isAllowedMcpBrowserUrl("https://moocs.iniad.org.evil.example/")).toBe(false);
    expect(isAllowedMcpBrowserUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isAllowedMcpBrowserUrl("ws://127.0.0.1/socket")).toBe(false);
    expect(isAllowedMcpBrowserUrl("https://attacker.example/collect")).toBe(false);
  });

  it("intercepts redirects/subresources and blocks service workers", async () => {
    interface RouteStub {
      request: () => { url: () => string };
      continue: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    }
    interface WebSocketStub {
      url: () => string;
      connectToServer: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }
    let routeHandler: ((route: RouteStub) => unknown) | undefined;
    let webSocketHandler: ((webSocket: WebSocketStub) => unknown) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, handler: (route: RouteStub) => unknown) => {
        routeHandler = handler;
      }),
      routeWebSocket: vi.fn(
        async (_pattern: string, handler: (webSocket: WebSocketStub) => unknown) => {
          webSocketHandler = handler;
        }
      ),
      close: vi.fn(),
    };
    const launchPersistentContext = vi.fn().mockResolvedValue(context);
    const browserType = { launchPersistentContext };
    installPlaywrightNetworkPolicy({ chromium: browserType });

    await browserType.launchPersistentContext("profile", { headless: true });
    expect(launchPersistentContext).toHaveBeenCalledWith(
      "profile",
      expect.objectContaining({ headless: true, serviceWorkers: "block" })
    );

    const allowed = {
      request: () => ({ url: () => "https://moocs.iniad.org/" }),
      continue: vi.fn(),
      abort: vi.fn(),
    };
    const blocked = {
      request: () => ({ url: () => "http://localhost/private" }),
      continue: vi.fn(),
      abort: vi.fn(),
    };
    await routeHandler!(allowed);
    await routeHandler!(blocked);
    expect(allowed.continue).toHaveBeenCalledOnce();
    expect(blocked.abort).toHaveBeenCalledWith("blockedbyclient");

    const allowedWebSocket = {
      url: () => "wss://docs.google.com/socket",
      connectToServer: vi.fn(),
      close: vi.fn(),
    };
    const blockedWebSocket = {
      url: () => "ws://localhost/socket",
      connectToServer: vi.fn(),
      close: vi.fn(),
    };
    await webSocketHandler!(allowedWebSocket);
    await webSocketHandler!(blockedWebSocket);
    expect(allowedWebSocket.connectToServer).toHaveBeenCalledOnce();
    expect(blockedWebSocket.close).toHaveBeenCalledWith({
      code: 1008,
      reason: "Blocked by MCP network policy",
    });
  });

  it("applies the policy to launch, connect, and CDP browser contexts", async () => {
    const createContext = () => ({
      route: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    });
    const createBrowser = (existingContexts: ReturnType<typeof createContext>[] = []) => ({
      newContext: vi.fn(async (_options?: unknown) => createContext()),
      contexts: vi.fn(() => existingContexts),
      close: vi.fn(async () => undefined),
    });

    const launchedBrowser = createBrowser();
    const connectedBrowser = createBrowser();
    const launchedNewContext = launchedBrowser.newContext;
    const connectedNewContext = connectedBrowser.newContext;
    const existingCdpContext = createContext();
    const cdpBrowser = createBrowser([existingCdpContext]);
    const browserType = {
      launchPersistentContext: vi.fn(async () => createContext()),
      launch: vi.fn(async (_options?: unknown) => launchedBrowser),
      connect: vi.fn(async (_endpoint: string, _options?: unknown) => connectedBrowser),
      connectOverCDP: vi.fn(async (_endpoint: string, _options?: unknown) => cdpBrowser),
    };
    installPlaywrightNetworkPolicy({ chromium: browserType });

    const launched = await browserType.launch({ headless: true });
    const launchedContext = await launched.newContext({ locale: "ja-JP" });
    expect(launchedNewContext).toHaveBeenCalledWith({
      locale: "ja-JP",
      serviceWorkers: "block",
    });
    expect(launchedContext.route).toHaveBeenCalledOnce();
    expect(launchedContext.routeWebSocket).toHaveBeenCalledOnce();

    const connected = await browserType.connect("wss://browser.example/socket");
    const connectedContext = await connected.newContext();
    expect(connectedNewContext).toHaveBeenCalledWith({ serviceWorkers: "block" });
    expect(connectedContext.route).toHaveBeenCalledOnce();
    expect(connectedContext.routeWebSocket).toHaveBeenCalledOnce();

    await browserType.connectOverCDP("https://browser.example/cdp");
    expect(existingCdpContext.route).toHaveBeenCalledOnce();
    expect(existingCdpContext.routeWebSocket).toHaveBeenCalledOnce();
  });

  it("closes a newly created context when WebSocket routing is unavailable", async () => {
    const context = {
      route: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      contexts: vi.fn(() => []),
      close: vi.fn(async () => undefined),
    };
    const browserType = {
      launchPersistentContext: vi.fn(),
      launch: vi.fn(async () => browser),
    };
    installPlaywrightNetworkPolicy({ chromium: browserType });

    const launched = await browserType.launch();
    await expect(launched.newContext()).rejects.toThrow("Playwright WebSocket routing is required");
    expect(context.close).toHaveBeenCalledOnce();
  });
});
