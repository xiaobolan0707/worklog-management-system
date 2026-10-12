import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const script = resolve(root, "scripts/deploy-one-click.ps1");
const temporaryDirectories: string[] = [];

async function makeFixture(includeSecret = false) {
  const directory = await mkdtemp(resolve(tmpdir(), "worklog-deploy-test-"));
  temporaryDirectories.push(directory);
  const source = resolve(directory, "source");
  const bin = resolve(directory, "bin");
  const log = resolve(directory, "workbench.log");
  await mkdir(resolve(source, "prisma/migrations/20261012090000_letter_log_comments"), { recursive: true });
  await mkdir(bin);
  await writeFile(resolve(source, "compose.yaml"), "services: {}\n");
  await writeFile(resolve(source, "Dockerfile"), "FROM scratch\n");
  await writeFile(resolve(source, "prisma/migrations/20261012090000_letter_log_comments/migration.sql"), "SELECT 1;\n");
  if (includeSecret) await writeFile(resolve(source, ".env"), "SESSION_SECRET=do-not-upload\n");
  await writeFile(resolve(bin, "workbench.cmd"), "@echo off\r\necho %*>>\"%FAKE_WORKBENCH_LOG%\"\r\nif \"%1\"==\"version\" echo workbench test\r\nexit /b 0\r\n");
  const archive = resolve(directory, "upgrade.tar.gz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", source, "."], { encoding: "utf8" });
  expect(tar.status, tar.stderr).toBe(0);
  return { archive, bin, log };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(process.platform !== "win32")("one-click ECS deployment", () => {
  it("validates a safe release without uploading or running remote commands", async () => {
    const fixture = await makeFixture();
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-PackagePath", fixture.archive, "-ValidateOnly"
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ""}`,
        FAKE_WORKBENCH_LOG: fixture.log
      }
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("VALIDATION_OK");
    expect((await readFile(fixture.log, "utf8")).trim()).toBe("version");
  });

  it("rejects an archive that would upload a local secret", async () => {
    const fixture = await makeFixture(true);
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-PackagePath", fixture.archive, "-ValidateOnly"
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ""}`,
        FAKE_WORKBENCH_LOG: fixture.log
      }
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/\.env|敏感文件/);
  });
});
