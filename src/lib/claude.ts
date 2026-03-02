import { execa } from "execa";

export async function processReview(
  feedback: string,
  prNumber: number,
  prTitle: string,
): Promise<string> {
  const prompt = `
You are processing CodeRabbit review feedback for PR #${prNumber} (${prTitle}).

Analyze the suggestions and implement the sensible improvements directly in the code.

Rules:
- Only implement changes that actually improve code quality
- Ignore purely cosmetic suggestions without added value
- Ignore summaries / walkthroughs — focus on concrete change suggestions
- For inline reviews: file and line are in the header

Give a brief summary of what you changed at the end.
`;

  const result = await execa("claude", ["-p", prompt], {
    input: feedback,
    timeout: 5 * 60 * 1000, // 5 min per PR
  });

  return result.stdout;
}
