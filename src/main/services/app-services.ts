import { InMemoryStore } from "./in-memory-store";
import { McpClient } from "./mcp-client";
import { WebSearchClient } from "./web-search-client";
import { ChatAgent } from "./chat-agent";
import { SyllabusIndexService } from "./syllabus-index";
import { SlidesIndexService } from "./slides-index";

export interface AppServices {
  store: InMemoryStore;
  mcpClient: McpClient;
  webClient: WebSearchClient;
  syllabusService: SyllabusIndexService;
  slidesService: SlidesIndexService;
  chatAgent: ChatAgent;
}

export function createAppServices(): AppServices {
  const mcpClient = new McpClient();
  const webClient = new WebSearchClient();
  const syllabusService = new SyllabusIndexService();
  const slidesService = new SlidesIndexService();
  syllabusService.load();
  slidesService.load();

  const chatAgent = new ChatAgent(mcpClient, webClient, syllabusService, slidesService);

  return {
    store: new InMemoryStore(),
    mcpClient,
    webClient,
    syllabusService,
    slidesService,
    chatAgent,
  };
}
