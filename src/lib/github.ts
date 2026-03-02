import { execa } from "execa";

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
}

export interface ReviewComment {
  type: "comment" | "review" | "inline";
  body: string;
  created: string;
  author: string;
  path?: string;
  line?: number;
}

/**
 * gh CLI sometimes returns JSON with bare control characters
 * that break JSON parsers. This strips them out.
 */
function sanitizeJson(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ");
}

async function gh(args: string[]): Promise<string> {
  const result = await execa("gh", args);
  return sanitizeJson(result.stdout);
}

export async function getRepo(): Promise<string> {
  const result = await gh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
  return result.trim();
}

export async function getOpenPRs(repo: string): Promise<PullRequest[]> {
  const raw = await gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,title,headRefName",
    "--limit",
    "100",
  ]);
  return JSON.parse(raw);
}

export async function getReviewComments(
  repo: string,
  prNumber: number,
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = [];

  // 1. PR comments + review bodies
  try {
    const raw = await gh([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      repo,
      "--json",
      "comments,reviews",
    ]);
    const data = JSON.parse(raw);

    for (const c of data.comments ?? []) {
      if (c.body) {
        comments.push({
          type: "comment",
          body: c.body,
          created: c.createdAt,
          author: c.author?.login ?? "unknown",
        });
      }
    }

    for (const r of data.reviews ?? []) {
      if (r.body) {
        comments.push({
          type: "review",
          body: r.body,
          created: r.submittedAt,
          author: r.author?.login ?? "unknown",
        });
      }
    }
  } catch {
    // PR might not exist or network error
  }

  // 2. Inline review comments (file-specific)
  try {
    const raw = await gh([
      "api",
      `repos/${repo}/pulls/${prNumber}/comments`,
      "--paginate",
    ]);

    // --paginate can return multiple JSON arrays, concatenate them
    const parsed = raw.startsWith("[")
      ? JSON.parse(raw)
      : JSON.parse(`[${raw.split("]\n[").join(",")}]`).flat();

    for (const c of parsed) {
      if (c.body) {
        comments.push({
          type: "inline",
          body: c.body,
          created: c.created_at,
          author: c.user?.login ?? "unknown",
          path: c.path,
          line: c.line,
        });
      }
    }
  } catch {
    // API might fail
  }

  return comments.sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
  );
}

export function formatReviewForPrompt(
  pr: PullRequest,
  comments: ReviewComment[],
): string {
  const generalComments = comments.filter((c) => c.type !== "inline");
  const inlineComments = comments.filter((c) => c.type === "inline");

  let prompt = `# Review Feedback for PR #${pr.number}: ${pr.title}\n`;
  prompt += `Branch: ${pr.headRefName}\n\n`;

  if (generalComments.length > 0) {
    prompt += `## General Comments\n\n`;
    for (const c of generalComments) {
      prompt += `### ${c.type} by @${c.author} (${c.created})\n${c.body}\n\n`;
    }
  }

  if (inlineComments.length > 0) {
    prompt += `## Inline Reviews (file-specific)\n\n`;
    for (const c of inlineComments) {
      prompt += `### ${c.path}:${c.line} by @${c.author}\n${c.body}\n\n`;
    }
  }

  return prompt;
}
