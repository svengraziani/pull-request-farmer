import { execa } from "execa";
import type { GitHubIssue, IssueComment } from "./github.js";

export interface PlanResult {
  type: "plan" | "questions";
  content: string;
  questions?: string[];
}

export async function processReview(
  feedback: string,
  prNumber: number,
  prTitle: string,
  cwd?: string,
  onOutput?: (chunk: string) => void,
): Promise<string> {
  const prompt = `You are processing review feedback for PR #${prNumber} (${prTitle}).

Below is the review feedback. For each actionable suggestion:
1. Open the file mentioned in the review
2. Find the relevant code
3. Apply the suggested fix

Rules:
- Implement ALL suggestions that improve code quality, correctness, or performance
- Suggestions labeled "Major" or "Potential issue" should always be implemented
- Suggestions labeled "Nitpick" or "Trivial" — implement if the fix is straightforward
- Ignore summary/walkthrough comments that don't request specific changes
- For inline reviews: the file path and line number are in the heading

After applying all changes, give a brief summary of what you changed.

--- REVIEW FEEDBACK ---

${feedback}`;

  const proc = execa("claude", ["-p", prompt], {
    timeout: 15 * 60 * 1000, // 15 min per PR
    ...(cwd ? { cwd } : {}),
  });

  if (onOutput && proc.stdout) {
    proc.stdout.on("data", (chunk: Buffer) => {
      onOutput(chunk.toString());
    });
  }

  const result = await proc;
  return result.stdout;
}

export function parsePlanResult(output: string): PlanResult {
  // Look for a JSON marker at the end of the output
  const markerMatch = output.match(/```json\s*\n(\{[\s\S]*?\})\s*\n```\s*$/);
  if (markerMatch) {
    try {
      const marker = JSON.parse(markerMatch[1]);
      const content = output.slice(0, markerMatch.index).trim();
      if (marker.result === "questions" && Array.isArray(marker.questions)) {
        return { type: "questions", content, questions: marker.questions };
      }
      return { type: "plan", content };
    } catch {
      // JSON parse failed — treat as plan
    }
  }
  return { type: "plan", content: output.trim() };
}

export async function createPlan(
  issue: GitHubIssue,
  cwd?: string,
  onOutput?: (chunk: string) => void,
): Promise<PlanResult> {
  const prompt = `
You are analyzing a GitHub issue to create an implementation plan.

Issue #${issue.number}: ${issue.title}

Analyze the issue and produce ONE of the following:

1. If the issue is clear enough to implement, produce a detailed implementation plan including:
   - Files to create or modify
   - Key changes in each file
   - Testing approach
   End your response with a JSON marker:
   \`\`\`json
   {"result": "plan"}
   \`\`\`

2. If the issue is ambiguous or missing critical details, list your questions.
   End your response with a JSON marker:
   \`\`\`json
   {"result": "questions", "questions": ["question1", "question2"]}
   \`\`\`

Important: Do NOT make any code changes. Only analyze and plan.
`;

  const input = `# Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? "(no description)"}`;

  const proc = execa("claude", ["-p", prompt], {
    input,
    timeout: 10 * 60 * 1000,
    ...(cwd ? { cwd } : {}),
  });

  let fullOutput = "";
  if (proc.stdout) {
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      fullOutput += text;
      onOutput?.(text);
    });
  }

  await proc;
  return parsePlanResult(fullOutput);
}

export function formatIssueForPrompt(
  issue: GitHubIssue,
  comments: IssueComment[],
): string {
  let input = `# Issue #${issue.number}: ${issue.title}\n\n`;

  if (issue.body) {
    input += `## Description\n\n${issue.body}\n\n`;
  }

  if (comments.length > 0) {
    input += `## Discussion & Plan\n\n`;
    for (const c of comments) {
      input += `### Comment by @${c.author} (${c.created})\n${c.body}\n\n`;
    }
  }

  return input;
}

export async function implementFromPlan(
  issue: GitHubIssue,
  comments: IssueComment[],
  cwd?: string,
  onOutput?: (chunk: string) => void,
): Promise<string> {
  const prompt = `
You are implementing a feature based on a GitHub issue.

Read the issue description and any discussion/plan comments provided via stdin.
Then find the relevant files in the codebase and implement the requested changes.

Rules:
- Explore the codebase first to understand the project structure
- Implement the changes directly — edit the actual source files
- Follow existing code conventions and patterns
- Keep changes focused — only implement what the issue describes
- Give a brief summary of what you changed at the end
`;

  const input = formatIssueForPrompt(issue, comments);

  const proc = execa("claude", ["-p", prompt], {
    input,
    timeout: 15 * 60 * 1000, // 15 min for implementation
    ...(cwd ? { cwd } : {}),
  });

  if (onOutput && proc.stdout) {
    proc.stdout.on("data", (chunk: Buffer) => {
      onOutput(chunk.toString());
    });
  }

  const result = await proc;
  return result.stdout;
}
