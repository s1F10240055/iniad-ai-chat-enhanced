import { BrowserWindow } from "electron";
import type { McpClient } from "./mcp-client";
import type { McpStatus } from "../../shared/types/settings";

const LOGIN_WINDOW_TIMEOUT_MS = 120_000;

export function loginViaBrowser(
  username: string,
  password: string,
  mcpClient: McpClient,
  broadcastStatus: (status: McpStatus) => void
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    let hasSeenLoginPage = false;

    const finish = (result: { success: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try {
        loginWindow.close();
      } catch {}
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ success: false, error: "ログインがタイムアウトしました（2分）" });
    }, LOGIN_WINDOW_TIMEOUT_MS);

    const loginWindow = new BrowserWindow({
      width: 600,
      height: 700,
      title: "INIAD MOOCs ログイン",
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    loginWindow.on("closed", () => {
      finish({ success: false, error: "ログインがキャンセルされました" });
    });

    loginWindow.webContents.on("did-finish-load", async () => {
      const url = loginWindow.webContents.getURL();

      if (url.includes("idmanager") || url.includes("login")) {
        hasSeenLoginPage = true;
        try {
          await loginWindow.webContents.executeJavaScript(`
            const u = document.querySelector('input#username, input[name="username"], input[ref=s1e16]');
            const p = document.querySelector('input#password, input[name="password"], input[ref=s1e18]');
            if (u) { u.value = ${JSON.stringify(username)}; u.dispatchEvent(new Event('input', {bubbles:true})); }
            if (p) { p.value = ${JSON.stringify(password)}; p.dispatchEvent(new Event('input', {bubbles:true})); }
          `);
          loginWindow.setTitle("INIAD MOOCs ログイン - ログインボタンを押してください");
        } catch {}
        return;
      }

      // On moocs.iniad.org — check if already logged in or just logged in
      if (url.includes("moocs.iniad.org")) {
        try {
          const hasLoginForm = await loginWindow.webContents.executeJavaScript(
            `!!document.querySelector('input#username, input[name="username"], input[ref=s1e16]')`
          );
          if (!hasLoginForm) {
            loginWindow.setTitle("INIAD MOOCs ログイン - MCPサーバーに接続中...");
            broadcastStatus("connecting");
            await mcpClient.connect(username, password);
            broadcastStatus("connected");
            finish({ success: true });
          }
        } catch (mcpError) {
          broadcastStatus("disconnected");
          finish({
            success: false,
            error: `INIADログイン成功、MCP接続失敗: ${mcpError instanceof Error ? mcpError.message : String(mcpError)}`,
          });
        }
      }
    });

    loginWindow.loadURL("https://moocs.iniad.org/");
  });
}
