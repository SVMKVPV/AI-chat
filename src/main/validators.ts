import path from "node:path";

export interface ParsedGitHubRepository {
  owner: string;
  repo: string;
  canonicalUrl: string;
  id: string;
}

const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,220}$/;

export function parseGitHubRepoUrl(value: string): ParsedGitHubRepository {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete GitHub URL, such as https://github.com/owner/repository.");
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only HTTPS repositories hosted on github.com are supported.");
  }

  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("The repository URL cannot include credentials, a port, query, or fragment.");
  }

  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.length !== 2) {
    throw new Error("Use the repository root URL, not a file, branch, or issue URL.");
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!SEGMENT_PATTERN.test(owner) || !SEGMENT_PATTERN.test(repo) || repo === "." || repo === "..") {
    throw new Error("That GitHub owner or repository name is not valid.");
  }

  const id = `${owner}--${repo}`.toLowerCase();
  return {
    owner,
    repo,
    id,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}

export function assertProjectId(value: string): string {
  if (!PROJECT_ID_PATTERN.test(value)) {
    throw new Error("Invalid project identifier.");
  }
  return value;
}

export function resolveInside(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The requested path is outside the managed projects directory.");
  }
  return candidate;
}

export function validateRelativeEntry(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes("\0")) {
    throw new Error("Choose an entry point inside the project folder.");
  }
  const normalized = path.normalize(trimmed);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("The entry point must stay inside the project folder.");
  }
  return normalized;
}

export function validateArguments(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > 128) {
    throw new Error("Arguments must be a list with no more than 128 entries.");
  }
  return values.map((value) => {
    if (typeof value !== "string" || value.length > 8_192 || value.includes("\0")) {
      throw new Error("One or more launch arguments are invalid.");
    }
    return value;
  });
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["github.com", "huggingface.co"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
