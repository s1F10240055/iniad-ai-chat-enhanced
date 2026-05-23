import React, { useRef, useEffect } from "react";
import { ChatTurn } from "../../shared/types/chat";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";

interface ChatViewProps {
  messages: ChatTurn[];
  isLoading?: boolean;
  onStop?: () => void;
  onEdit?: (id: string, newText: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({ messages, isLoading, onStop, onEdit }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // スクロールを一番下へ移動
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="chat-view-container">
      {messages.length === 0 && !isLoading ? (
        <div className="chat-empty-state">
          <p>質問を入力して会話を始めましょう。</p>
        </div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} turn={msg} onEdit={onEdit} />)
      )}
      {isLoading && <TypingIndicator onStop={onStop} />}
      <div ref={bottomRef} />
    </div>
  );
};
