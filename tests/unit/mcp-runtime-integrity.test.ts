import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createRequire } from "module";

const moduleRequire = createRequire(path.resolve("package.json"));
const { buildMcpRuntime, computeRuntimeTreeHash } = moduleRequire(
  "./scripts/copy-mcp-runtime.cjs"
) as {
  buildMcpRuntime(projectDir: string): string;
  computeRuntimeTreeHash(runtimeRoot: string): string;
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("packaged MCP runtime integrity", () => {
  it("refuses to write a runtime outside the project that owns the build script", async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "mcp-runtime-wrong-project-"));
    temporaryDirectories.push(directory);

    expect(() => buildMcpRuntime(directory)).toThrow(
      "Refusing to write MCP runtime outside this project"
    );
    await expect(fs.access(path.join(directory, ".mcp-runtime"))).rejects.toThrow();
  });

  it("is deterministic and changes when runtime code is modified", async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "mcp-runtime-integrity-"));
    temporaryDirectories.push(directory);
    await fs.mkdir(path.join(directory, "node_modules"));
    await fs.writeFile(path.join(directory, "runtime.json"), "runtime", "utf8");
    await fs.writeFile(path.join(directory, "node_modules", "entry.js"), "version-one", "utf8");

    const original = computeRuntimeTreeHash(directory);
    expect(computeRuntimeTreeHash(directory)).toBe(original);

    await fs.writeFile(path.join(directory, "integrity.json"), "ignored metadata", "utf8");
    expect(computeRuntimeTreeHash(directory)).toBe(original);

    await fs.writeFile(path.join(directory, "node_modules", "entry.js"), "version-two", "utf8");
    expect(computeRuntimeTreeHash(directory)).not.toBe(original);
  });
});
