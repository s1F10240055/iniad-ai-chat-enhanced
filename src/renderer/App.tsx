import React, { useState, useEffect } from "react";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { StatusBar } from "./components/StatusBar";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
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
      <Sidebar
        currentView={currentView}
        onSwitchView={switchView}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="app-content">
        <header className="app-header">
          {isChat ? (
            <h1>INIAD AI Chat</h1>
          ) : (
            <h1>設定</h1>
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
    </div>
  );
};

export default App;
