import React, { useState, useRef, useEffect, useCallback } from "react";

interface ChatInputProps {
  onSend: (text: string) => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  isCancelling?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onCancel,
  disabled = false,
  isLoading = false,
  isCancelling = false,
}) => {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const draftRef = useRef<string>("");

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [text]);

  const handleSubmit = useCallback(
    (e?: React.SyntheticEvent) => {
      e?.preventDefault();
      if (text.trim() && !disabled && !isLoading) {
        void onSend(text.trim());
        historyRef.current = [...historyRef.current, text.trim()];
        historyIndexRef.current = -1;
        draftRef.current = "";
        setText("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      }
    },
    [text, disabled, isLoading, onSend]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent && e.nativeEvent.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }

    const history = historyRef.current;
    if (history.length === 0) return;

    if (e.key === "ArrowUp" && text === "") {
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        draftRef.current = "";
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      }
      setText(history[historyIndexRef.current]);
    }

    if (e.key === "ArrowDown" && historyIndexRef.current !== -1) {
      e.preventDefault();
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++;
        setText(history[historyIndexRef.current]);
      } else {
        historyIndexRef.current = -1;
        setText(draftRef.current);
      }
    }
  };

  return (
    <div className="chat-input-container">
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (historyIndexRef.current !== -1) {
              historyIndexRef.current = -1;
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="質問を入力... (Enterで送信, Shift+Enterで改行, ↑で履歴)"
          aria-label="Chat message input"
          disabled={disabled || isLoading}
          rows={1}
        />
        {isLoading ? (
          <button
            type="button"
            className="chat-input-button chat-cancel-button"
            onClick={() => void onCancel?.()}
            disabled={isCancelling || !onCancel}
            aria-label="回答生成をキャンセル"
          >
            {isCancelling ? "キャンセル中..." : "キャンセル"}
          </button>
        ) : (
          <button type="submit" className="chat-input-button" disabled={disabled || !text.trim()}>
            送信
          </button>
        )}
      </form>
    </div>
  );
};
