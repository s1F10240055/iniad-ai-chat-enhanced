import React from "react";
import type { McpConnectionState, McpStatus } from "../../shared/types/settings";

interface StatusBarProps {
  connection: McpConnectionState;
  model: string;
  materialCount: number;
  onReconnect: () => void;
  isReconnecting?: boolean;
}

const STATUS_LABELS: Record<McpStatus, string> = {
  disconnected: "MCP未接続",
  connecting: "MCP接続中",
  connected: "MCP接続済み",
  reconnecting: "MCP再接続中",
  error: "MCP接続エラー",
};

function formatLastConnectedAt(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export const StatusBar: React.FC<StatusBarProps> = ({
  connection,
  model,
  materialCount,
  onReconnect,
  isReconnecting = false,
}) => {
  const isBusy =
    isReconnecting || connection.status === "connecting" || connection.status === "reconnecting";
  const attemptText =
    connection.attempt && connection.maxAttempts
      ? `試行 ${connection.attempt}/${connection.maxAttempts}`
      : null;
  const guidance =
    connection.error?.guidance ??
    (connection.status === "disconnected"
      ? "MOOCs認証情報を確認し、再接続してください。"
      : connection.status === "error"
        ? "設定を確認してから再接続してください。"
        : null);

  return (
    <footer className={`status-bar status-${connection.status}`}>
      <div className="status-main-row">
        <div
          className="status-item status-connection-item"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`status-indicator ${connection.status}`}
            aria-hidden="true"
          >
            <circle cx="5" cy="5" r="5" fill="currentColor" />
          </svg>
          <span className="status-text status-connection-label">
            {STATUS_LABELS[connection.status]}
          </span>
          {attemptText && <span className="status-attempt">({attemptText})</span>}
        </div>

        <div className="status-divider" aria-hidden="true">
          |
        </div>
        <div className="status-item" title={connection.lastConnectedAt}>
          <span className="status-text">
            最終接続: {formatLastConnectedAt(connection.lastConnectedAt)}
          </span>
        </div>
        <div className="status-divider" aria-hidden="true">
          |
        </div>
        <div className="status-item">
          <span className="status-text">資料: {materialCount}件</span>
        </div>
        <div className="status-divider" aria-hidden="true">
          |
        </div>
        <div className="status-item status-model-item">
          <span className="status-text">モデル: {model}</span>
        </div>
        <button
          type="button"
          className="status-reconnect-button"
          onClick={onReconnect}
          disabled={isBusy}
          aria-label="MCPに再接続"
        >
          {isBusy ? "接続中..." : "再接続"}
        </button>
      </div>

      {(connection.error || guidance) && (
        <div className="status-detail-row" role={connection.error ? "alert" : "status"}>
          {connection.error && (
            <span className="status-error-message">{connection.error.message}</span>
          )}
          {guidance && <span className="status-guidance">対処: {guidance}</span>}
        </div>
      )}
    </footer>
  );
};
