/**
 * インメモリ状態管理クラス（MVP用）
 *
 * 将来のSettingsStore実装までの一時的な実装。
 * チャット履歴とアプリステータスをメモリ上で管理する。
 */

import type { ChatTurn, AppStatus, McpStatus } from "../../shared/types";

export class InMemoryStore {
  private static readonly MAX_HISTORY = 200;
  private chatHistory: ChatTurn[] = [];
  private mcpStatus: McpStatus = "disconnected";
  private currentModel: string = "gpt-5.4-nano";
  private hasApiKey: boolean = false;

  addMessage(message: ChatTurn): void {
    this.chatHistory.push(message);
    if (this.chatHistory.length > InMemoryStore.MAX_HISTORY) {
      this.chatHistory.shift();
    }
  }

  getHistory(): ChatTurn[] {
    return [...this.chatHistory];
  }

  clearHistory(): void {
    this.chatHistory = [];
  }

  sliceHistoryUpTo(id: string): void {
    const index = this.chatHistory.findIndex(m => m.id === id);
    if (index !== -1) {
      this.chatHistory = this.chatHistory.slice(0, index);
    }
  }

  getMcpStatus(): McpStatus {
    return this.mcpStatus;
  }

  setMcpStatus(status: McpStatus): void {
    this.mcpStatus = status;
  }

  getAppStatus(): AppStatus {
    return {
      mcpStatus: this.mcpStatus,
      model: this.currentModel,
      hasApiKey: this.hasApiKey,
    };
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  setHasApiKey(hasKey: boolean): void {
    this.hasApiKey = hasKey;
  }
}
