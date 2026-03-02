import { execa } from "execa";

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueComment {
  body: string;
  author: string;
  created: string;
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

export async function resolveReviewThreads(
  repo: string,
  prNumber: number,
  comments: ReviewComment[],
): Promise<number> {
  const [owner, name] = repo.split("/");

  // 1. Fetch all review threads via GraphQL
  const query = `
    query($owner: String!, $name: String!, $pr: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              path
              comments(first: 10) {
                nodes {
                  body
                }
              }
            }
          }
        }
      }
    }
  `;

  const raw = await gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `pr=${prNumber}`,
  ]);

  const data = JSON.parse(raw);
  const threads = data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

  // 2. Match threads against processed comments
  const processedInline = comments.filter((c) => c.type === "inline" && c.path);

  let resolved = 0;
  for (const thread of threads) {
    if (thread.isResolved) continue;

    const threadBodies: string[] = (thread.comments?.nodes ?? []).map(
      (n: { body: string }) => n.body,
    );

    const matched = processedInline.some(
      (c) =>
        c.path === thread.path &&
        threadBodies.some((tb) => tb.includes(c.body) || c.body.includes(tb)),
    );

    if (!matched) continue;

    // 3. Resolve the thread
    const mutation = `
      mutation($threadId: ID!) {
        resolveReviewThread(input: {threadId: $threadId}) {
          thread { id isResolved }
        }
      }
    `;

    try {
      await gh([
        "api",
        "graphql",
        "-f",
        `query=${mutation}`,
        "-f",
        `threadId=${thread.id}`,
      ]);
      resolved++;
    } catch {
      // Individual thread resolve failure — continue with others
    }
  }

  return resolved;
}

// ─── Issue helpers ──────────────────────────────────────────────

export async function getIssuesByLabel(
  repo: string,
  label: string,
): Promise<GitHubIssue[]> {
  const raw = await gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--label",
    label,
    "--state",
    "open",
    "--json",
    "number,title,body,labels",
    "--limit",
    "100",
  ]);
  const issues = JSON.parse(raw);
  return issues.map((i: { number: number; title: string; body: string; labels: { name: string }[] }) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: (i.labels ?? []).map((l: { name: string }) => l.name),
  }));
}

export async function getIssueComments(
  repo: string,
  issueNumber: number,
): Promise<IssueComment[]> {
  const raw = await gh([
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "comments",
  ]);
  const data = JSON.parse(raw);
  return (data.comments ?? []).map(
    (c: { body: string; author: { login: string }; createdAt: string }) => ({
      body: c.body,
      author: c.author?.login ?? "unknown",
      created: c.createdAt,
    }),
  );
}

export async function commentOnIssue(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await gh([
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    repo,
    "--body",
    body,
  ]);
}

export async function updateIssueBody(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await gh([
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    "--body",
    body,
  ]);
}

export async function removeIssueLabel(
  repo: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  await gh([
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    "--remove-label",
    label,
  ]);
}

export async function setIssueLabel(
  repo: string,
  issueNumber: number,
  addLabel: string,
  removeLabel?: string,
): Promise<void> {
  const args = [
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    "--add-label",
    addLabel,
  ];
  if (removeLabel) {
    args.push("--remove-label", removeLabel);
  }
  await gh(args);
}

export async function createPullRequest(
  repo: string,
  branch: string,
  issue: GitHubIssue,
): Promise<string> {
  const body = `Closes #${issue.number}\n\nAutomatically implemented by pr-farmer.`;
  const result = await gh([
    "pr",
    "create",
    "--repo",
    repo,
    "--head",
    branch,
    "--title",
    `feat: ${issue.title}`,
    "--body",
    body,
  ]);
  // gh pr create prints the PR URL
  return result.trim();
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
