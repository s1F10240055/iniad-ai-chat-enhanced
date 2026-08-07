import React, { useState } from "react";
import type { Citation } from "../../shared/types/chat";

interface CitationPanelProps {
  citations: Citation[];
}

function isSafeUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const CitationPanel: React.FC<CitationPanelProps> = ({ citations }) => {
  const [openError, setOpenError] = useState<string | null>(null);

  if (!citations || citations.length === 0) {
    return (
      <div className="citations-empty" role="status">
        参照資料なし（資料を確認できなかった回答です）
      </div>
    );
  }

  const openCitation = async (citation: Citation) => {
    setOpenError(null);
    if (!isSafeUrl(citation.url)) {
      setOpenError("安全でないURLのため開けませんでした。");
      return;
    }

    try {
      const opened = await window.electronAPI.openExternalUrl(citation.url);
      if (!opened) {
        setOpenError("許可されていないURLのため開けませんでした。");
      }
    } catch {
      setOpenError("資料を開けませんでした。URLまたは接続状態を確認してください。");
    }
  };

  return (
    <div className="citations-container">
      <div className="citations-header">参照資料</div>
      <ul className="citations-list">
        {citations.map((citation, index) => {
          const safeUrl = isSafeUrl(citation.url);
          return (
            <li
              key={`${citation.url}-${citation.location ?? ""}-${index}`}
              className="citation-item"
            >
              <div className="citation-heading">
                <span className="citation-title">{citation.title}</span>
                {citation.sourceType && (
                  <span className={`citation-source-badge ${citation.sourceType}`}>
                    {citation.sourceType === "moocs" ? "MOOCs" : "Web"}
                  </span>
                )}
              </div>
              {citation.location && (
                <div className="citation-location">位置: {citation.location}</div>
              )}
              {citation.snippet && <p className="citation-snippet">{citation.snippet}</p>}
              <div className="citation-link-row">
                <span className="citation-url" title={citation.url}>
                  {citation.url}
                </span>
                <button
                  type="button"
                  className="citation-open-button"
                  onClick={() => void openCitation(citation)}
                  disabled={!safeUrl}
                  aria-label={`${citation.title}を外部ブラウザーで開く`}
                >
                  資料を開く
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {openError && (
        <div className="citation-open-error" role="alert">
          {openError}
        </div>
      )}
    </div>
  );
};
