import React, { useState } from "react";
import { ChatTurn } from "../../shared/types/chat";
import { CitationPanel } from "./CitationPanel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
interface MessageBubbleProps {
  turn: ChatTurn;
  onEdit?: (id: string, newText: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CodeBlock = ({ language, children, ...rest }: any) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children).replace(/\n$/, "")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: "relative" }} className="code-block-wrapper">
      <button 
        onClick={handleCopy} 
        className="copy-button code-copy-button"
        aria-label="Copy code"
        title="コードをコピー"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10a37f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        )}
      </button>
      <SyntaxHighlighter
        {...rest}
        PreTag="div"
        language={language}
        style={vscDarkPlus}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ turn, onEdit }) => {
  const isUser = turn.role === "user";
  const isSystem = turn.role === "system";
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(turn.content);

  if (isSystem) {
    return (
      <div className="message-system">
        <span>{turn.content}</span>
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(turn.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={`message-bubble-wrapper ${isUser ? "user" : "assistant"}`}>
      <div className="message-avatar">
        {isUser ? (
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
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        ) : (
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
        )}
      </div>
      <div className="message-body">
        <div className="message-sender-name">
          {isUser ? "あなた" : "AI アシスタント"}
          {isUser && onEdit && !isEditing && (
            <button className="copy-button" onClick={() => setIsEditing(true)} aria-label="Edit message" title="メッセージを編集">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
          )}
          {!isUser && (
            <button className="copy-button" onClick={handleCopy} aria-label="Copy message" title="回答をコピー">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10a37f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              )}
            </button>
          )}
        </div>
        <div className={`message-bubble ${isUser ? "user" : "assistant"} ${isEditing ? "editing" : ""}`}>
          {isUser ? (
            isEditing ? (
              <div className="edit-container">
                <textarea 
                  className="chat-input-textarea edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={Math.min(10, editText.split("\n").length)}
                  autoFocus
                />
                <div className="edit-actions">
                  <button className="chat-input-button" onClick={() => setIsEditing(false)}>キャンセル</button>
                  <button className="chat-input-button send-button" onClick={() => {
                    setIsEditing(false);
                    if (editText.trim() && editText.trim() !== turn.content) {
                      onEdit?.(turn.id, editText.trim());
                    }
                  }}>再送信</button>
                </div>
              </div>
            ) : (
              <p className="message-content">{turn.content}</p>
            )
          ) : (
            <div className="message-content markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  code(props: any) {
                    const { children, className, node: _node, ...rest } = props;
                    const match = /language-(\w+)/.exec(className || "");
                    return match ? (
                      <CodeBlock language={match[1]} {...rest}>
                        {children}
                      </CodeBlock>
                    ) : (
                      <code {...rest} className={className}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {turn.content}
              </ReactMarkdown>
            </div>
          )}

          {!isUser && <CitationPanel citations={turn.citations || []} />}
        </div>
      </div>
    </div>
  );
};
