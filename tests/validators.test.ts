import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSafeExternalUrl,
  parseGitHubRepoUrl,
  resolveInside,
  validateArguments,
  validateRelativeEntry,
} from "../src/main/validators";

describe("parseGitHubRepoUrl", () => {
  it("normalizes a repository URL", () => {
    expect(parseGitHubRepoUrl("https://github.com/shmishtopher/dark-bert.git")).toEqual({
      owner: "shmishtopher",
      repo: "dark-bert",
      id: "shmishtopher--dark-bert",
      canonicalUrl: "https://github.com/shmishtopher/dark-bert",
    });
  });

  it.each([
    "http://github.com/owner/repo",
    "https://gitlab.com/owner/repo",
    "https://github.com/owner/repo/issues/1",
    "https://user:secret@github.com/owner/repo",
  ])("rejects unsafe or non-root URL %s", (value) => {
    expect(() => parseGitHubRepoUrl(value)).toThrow();
  });
});

describe("path validation", () => {
  it("keeps resolved paths below their managed root", () => {
    const root = path.resolve("projects");
    expect(resolveInside(root, "owner--repo")).toBe(path.join(root, "owner--repo"));
    expect(() => resolveInside(root, "..", "escape")).toThrow();
  });

  it("accepts only relative entry points", () => {
    expect(validateRelativeEntry("src/main.py")).toBe(path.normalize("src/main.py"));
    expect(() => validateRelativeEntry("../outside.py")).toThrow();
    expect(() => validateRelativeEntry(path.resolve("main.py"))).toThrow();
  });
});

describe("argument and external URL validation", () => {
  it("preserves arguments as an array without shell parsing", () => {
    expect(validateArguments(["--model", "a value with spaces"])).toEqual([
      "--model",
      "a value with spaces",
    ]);
  });

  it("allows only explicitly supported external hosts", () => {
    expect(isSafeExternalUrl("https://github.com/openai/openai-python")).toBe(true);
    expect(isSafeExternalUrl("https://example.com/payload")).toBe(false);
  });
});
