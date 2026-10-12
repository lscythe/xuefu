import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import { ok } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import { briefFiles } from "../../../../src/infrastructure/agent/brief-files";
import { makeTempDir } from "../../../support/temp-dir";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function folder() {
  const temp = makeTempDir();
  cleanups.push(temp.cleanup);
  return join(temp.path, "briefs");
}

const MOBILE = "mobile" as WorkspaceId;
const BRIEF = { workspaceId: MOBILE, text: "Mobile is a Kotlin app.", createdAt: 42 as Timestamp };

describe("briefFiles", () => {
  test("keeps a brief a workspace, readable only by you, and finds it again", () => {
    const dir = folder();
    const briefs = briefFiles(dir);
    expect(briefs.find(MOBILE)).toEqual(ok(null));
    expect(briefs.save(BRIEF)).toEqual(ok(undefined));
    expect(briefs.find(MOBILE)).toEqual(ok(BRIEF));
    expect(briefs.find("other" as WorkspaceId)).toEqual(ok(null));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "mobile.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, "mobile.json"), "utf8"))).toEqual({
      text: "Mobile is a Kotlin app.",
      createdAt: 42,
    });
  });

  test("a file it cannot make sense of is no brief", () => {
    const dir = folder();
    mkdirSync(dir);
    const briefs = briefFiles(dir);
    writeFileSync(join(dir, "mobile.json"), "{oops");
    expect(briefs.find(MOBILE)).toEqual(ok(null));
    writeFileSync(join(dir, "mobile.json"), JSON.stringify({ text: 1, createdAt: "now" }));
    expect(briefs.find(MOBILE)).toEqual(ok(null));
  });

  test("a brief that cannot be read or kept says where", () => {
    const dir = folder();
    mkdirSync(join(dir, "mobile.json"), { recursive: true });
    const briefs = briefFiles(dir);
    const read = briefs.find(MOBILE);
    expect(!read.ok && read.error.message).toBe("Unable to read a project brief");
    const saved = briefs.save(BRIEF);
    expect(!saved.ok && saved.error.message).toBe("Unable to keep the project brief");
  });
});
