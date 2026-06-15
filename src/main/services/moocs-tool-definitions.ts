import type { ChatToolDefinition } from "../../shared/types/chat";

export const MOOCS_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "moocs_login",
      description:
        "INIAD MOOCs にログインする。コース一覧の取得前、またはセッション切れが疑われるときに呼ぶ。成功すると登録コース一覧が返る。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_list_courses",
      description: "ログイン済みの状態で、登録されているコース一覧を取得する。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_navigate",
      description:
        "MOOCs の指定 URL に移動する。コースページ・講義ページ・スライドページの URL は list_* ツールの結果から取得する。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "移動先の MOOCs URL" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_list_lectures",
      description:
        "現在のコースページで講義（回）のリンク一覧を取得する。事前に moocs_navigate でコース URL に移動すること。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_list_slides",
      description:
        "現在の講義ページでスライド・教材のリンク一覧を取得する。事前に moocs_navigate で講義 URL に移動すること。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_read_slide",
      description:
        "MOOCs ページ本文を取得する。数値スライド URL（/01/01 等）は Google Slides から抽出。課題解説（/review）・演習課題（/exercise）・出席確認（/atnd）は HTML ページとして読む（Google ログイン不要）。非公開の場合はその旨が返る。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "省略可。指定時は先にこの MOOCs スライド URL に移動してから読み取る。",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_expand_slide_tab",
      description: "スライドページで「スライド」タブを開く。通常は moocs_read_slide を使えば不要。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_page_content",
      description:
        "現在のページのアクセシビリティスナップショット。スライド本文には moocs_read_slide を使うこと（iframe 内はこのツールでは取れない）。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "moocs_google_login",
      description:
        "数値スライドページ（Google Slides iframe あり）でのみ使用。課題解説・演習課題ページでは呼ばない。google_login_required が出たときだけ 1 回試す。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "MOOCs 外の補足情報を Web 検索する。INIAD 講義内容の回答には MOOCs ツールを優先すること。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索クエリ" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];
