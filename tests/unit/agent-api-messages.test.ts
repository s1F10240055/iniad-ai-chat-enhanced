import { describe, it, expect } from "vitest";
import { prepareApiMessages } from "../../src/main/services/agent-api-messages";
import type { AgentMessage } from "../../src/shared/types/chat";

describe("prepareApiMessages", () => {
  it("omits bodies of older tool results but keeps recent ones", () => {
    const long = "スライド本文".repeat(500);
    const messages: AgentMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      { role: "tool", tool_call_id: "1", content: long },
      { role: "tool", tool_call_id: "2", content: long },
      { role: "tool", tool_call_id: "3", content: "最新の結果" },
    ];

    const prepared = prepareApiMessages(messages);

    expect(prepared[2].role).toBe("tool");
    expect(prepared[4].role).toBe("tool");
    if (prepared[2].role === "tool" && prepared[4].role === "tool") {
      expect(prepared[2].content).toContain("省略");
      expect(prepared[4].content).toBe("最新の結果");
    }
  });

  it("leaves messages unchanged when tool count is within limit", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "q" },
      { role: "tool", tool_call_id: "1", content: "a" },
    ];
    expect(prepareApiMessages(messages)).toEqual(messages);
  });
});
