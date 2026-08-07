import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnSync } from "child_process";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("MCP credential guard", () => {
  it("keeps credentials readable by the MCP process but not inheritable by children", async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "mcp-credential-guard-"));
    temporaryDirectories.push(directory);
    const fixture = path.join(directory, "fixture.cjs");
    await fs.writeFile(
      fixture,
      [
        'const { spawnSync } = require("node:child_process");',
        "const child = spawnSync(process.execPath, [\"-e\", \"process.stdout.write(String(process.env.INIAD_PASSWORD))\"], { encoding: \"utf8\" });",
        "process.stdout.write(JSON.stringify({",
        "  direct: process.env.INIAD_PASSWORD,",
        '  enumerable: Object.keys(process.env).includes("INIAD_PASSWORD"),',
        "  inherited: child.stdout,",
        "}));",
      ].join("\n"),
      "utf8"
    );

    const entry = path.resolve("scripts", "mcp-runtime-entry.cjs");
    const result = spawnSync(process.execPath, [entry, fixture], {
      encoding: "utf8",
      env: { ...process.env, INIAD_USERNAME: "test-user", INIAD_PASSWORD: "test-secret" },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      direct: "test-secret",
      enumerable: false,
      inherited: "undefined",
    });
  });
});
