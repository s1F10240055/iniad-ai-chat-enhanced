import React, { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled }) => {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [text]);

  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (text.trim() && !disabled) {
      const sentText = text.trim();
      onSend(sentText);
      setHistory((prev) => [sentText, ...prev]);
      setHistoryIndex(-1);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent && e.nativeEvent.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }

    if (e.key === "ArrowUp" && text === "" && historyIndex === -1) {
      e.preventDefault();
      if (history.length > 0) {
        setText(history[0]);
        setHistoryIndex(0);
      }
      return;
    }

    if (e.key === "ArrowUp" && historyIndex >= 0 && historyIndex < history.length - 1) {
      e.preventDefault();
      const nextIndex = historyIndex + 1;
      setText(history[nextIndex]);
      setHistoryIndex(nextIndex);
      return;
    }

    if (e.key === "ArrowDown" && historyIndex >= 0) {
      e.preventDefault();
      if (historyIndex === 0) {
        setText("");
        setHistoryIndex(-1);
      } else {
        const prevIndex = historyIndex - 1;
        setText(history[prevIndex]);
        setHistoryIndex(prevIndex);
      }
      return;
    }
  };

  return (
    <div className="chat-input-container">
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="質問を入力... (Enterで送信, Shift+Enterで改行)"
          aria-label="Chat message input"
          disabled={disabled}
          rows={1}
        />
        <button
          type="submit"
          className="chat-input-button send-button"
          disabled={disabled || !text.trim()}
          aria-label="Send message"
          title="送信"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    </div>
  );
};
