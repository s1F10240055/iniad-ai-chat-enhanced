import type { McpClient } from "./mcp-client";
import type { McpStatus } from "../../shared/types/settings";

export interface McpCredentials {
  moocsUsername: string;
  moocsPassword: string;
}

let connectInFlight: Promise<{ connected: boolean; error?: string }> | null = null;

/**
 * MCP 接続を確立する（既に接続済みならスキップ）。
 * 同時呼び出しは1本にまとめる。
 */
export async function ensureMcpConnected(
  mcpClient: McpClient,
  broadcastStatus: (status: McpStatus) => void,
  credentials: McpCredentials
): Promise<{ connected: boolean; error?: string }> {
  if (mcpClient.getStatus() === "connected") {
    const healthy = await mcpClient.ping();
    if (healthy) return { connected: true };
    console.warn("[McpConnection] Stale connection detected, reconnecting...");
    await disconnectMcp(mcpClient, broadcastStatus);
  }

  if (connectInFlight) return connectInFlight;

  connectInFlight = connectInternal(mcpClient, broadcastStatus, credentials).finally(() => {
    connectInFlight = null;
  });

  return connectInFlight;
}

async function connectInternal(
  mcpClient: McpClient,
  broadcastStatus: (status: McpStatus) => void,
  credentials: McpCredentials
): Promise<{ connected: boolean; error?: string }> {
  const { moocsUsername, moocsPassword } = credentials;

  if (!moocsUsername || !moocsPassword) {
    return { connected: false, error: "MOOCs 認証情報が設定されていません" };
  }

  broadcastStatus("connecting");

  try {
    await mcpClient.connect(moocsUsername, moocsPassword);
    broadcastStatus("connected");
    return { connected: true };
  } catch (error) {
    broadcastStatus("disconnected");
    const message = error instanceof Error ? error.message : String(error);
    console.error("[McpConnection] Connect failed:", message);
    return { connected: false, error: message };
  }
}

/** MCP を切断する */
export async function disconnectMcp(
  mcpClient: McpClient,
  broadcastStatus: (status: McpStatus) => void
): Promise<void> {
  await mcpClient.disconnect();
  broadcastStatus("disconnected");
}
