import React, { useState, useEffect } from "react";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { StatusBar } from "./components/StatusBar";
import { SettingsView } from "./components/SettingsView";
import { ChatTurn } from "../shared/types/chat";
import type { McpStatus } from "../shared/types/settings";
import "./index.css";

/** 現在表示中のビュー */
type ViewType = "chat" | "settings";

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mcpConnectionStatus, setMcpConnectionStatus] = useState<McpStatus>("disconnected");
  const [modelName, setModelName] = useState("GPT-5.4-nano");
  const [currentView, setCurrentView] = useState<ViewType>("chat");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  useEffect(() => {
    const cleanup = window.electronAPI?.onMcpStatusChange?.((status) => {
      setMcpConnectionStatus(status);
    });

    window.electronAPI
      ?.getStatus?.()
      .then((status) => {
        setMcpConnectionStatus(status.mcpStatus);
        setModelName(status.model);
      })
      .catch(() => {
        setMcpConnectionStatus("disconnected");
        setModelName("GPT-5.4-nano");
      });

    return () => {
      cleanup?.();
    };
  }, []);

  /** ビュー切替 */
  const switchView = (target: ViewType) => {
    if (target === currentView) return;
    setCurrentView(target);
  };

  const handleSend = async (text: string) => {
    const newUserMsg: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      const response = await window.electronAPI.sendChat(text);

      const newAiMsg: ChatTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.content,
        citations: response.citations,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, newAiMsg]);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errorMsg: ChatTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `エラーが発生しました: ${errMsg}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const isChat = currentView === "chat";

  return (
    <div className="app">
      <header className="app-header">
        {isChat ? (
          <>
            <h1>INIAD AI Chat</h1>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="theme-toggle-btn"
                onClick={toggleTheme}
                aria-label="テーマ切替"
                title="テーマ切替"
              >
                {theme === "light" ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                )}
              </button>
              <button
                className="settings-button"
                onClick={() => switchView("settings")}
                aria-label="設定を開く"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>{" "}
                設定
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>設定</h1>
            <button
              className="settings-button"
              onClick={() => switchView("chat")}
              aria-label="設定を閉じる"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </>
        )}
      </header>

      {/* 両ビューをコンテナ内に絶対配置し、スムーズにトランジション */}
      <div className="views-container">
        <div className={`view-layer ${isChat ? "view-active" : "view-hidden"}`}>
          <main className="app-main">
            <ChatView messages={messages} />
          </main>
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>

        <div className={`view-layer ${!isChat ? "view-active" : "view-hidden"}`}>
          <main className="app-main">
            <SettingsView onClose={() => switchView("chat")} />
          </main>
        </div>
      </div>

      <StatusBar mcpStatus={mcpConnectionStatus} model={modelName} />
    </div>
  );
};

export default App;
