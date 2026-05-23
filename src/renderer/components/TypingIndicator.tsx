import React from "react";

interface TypingIndicatorProps {
  onStop?: () => void;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ onStop }) => {
  return (
    <div className="message-bubble-wrapper assistant">
      <div className="message-avatar">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="10" rx="2"></rect>
          <circle cx="12" cy="5" r="2"></circle>
          <path d="M12 7v4"></path>
          <line x1="8" y1="16" x2="8" y2="16"></line>
          <line x1="16" y1="16" x2="16" y2="16"></line>
        </svg>
      </div>
      <div className="message-body">
        <div className="message-sender-name">AI アシスタント</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            className="message-bubble assistant typing-indicator-bubble"
            style={{ width: "auto" }}
          >
            <span className="dot"></span>
            <span className="dot"></span>
            <span className="dot"></span>
          </div>
          {onStop && (
            <button
              type="button"
              className="chat-input-button stop-button"
              onClick={onStop}
              aria-label="Stop generation"
              title="生成を停止"
              style={{ alignSelf: "center", marginBottom: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
