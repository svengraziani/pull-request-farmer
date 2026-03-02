import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import {
  getRepo,
  getOpenPRs,
  getReviewComments,
  formatReviewForPrompt,
  type PullRequest,
  type ReviewComment,
} from "../lib/github.js";
import {
  getCurrentBranch,
  checkoutBranch,
  pullLatest,
  hasChanges,
  commitAndPush,
} from "../lib/git.js";
import { processReview } from "../lib/claude.js";

interface PRStatus {
  pr: PullRequest;
  status: "pending" | "loading" | "processing" | "committing" | "done" | "skipped" | "error";
  commentCount: number;
  inlineCount: number;
  message?: string;
}

interface AppProps {
  repo?: string;
  dryRun?: boolean;
  prNumber?: number;
}

export function App({ repo: repoArg, dryRun, prNumber }: AppProps) {
  const [repo, setRepo] = useState(repoArg ?? "");
  const [statuses, setStatuses] = useState<PRStatus[]>([]);
  const [phase, setPhase] = useState<"init" | "fetching" | "processing" | "done">("init");
  const [originalBranch, setOriginalBranch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    run();
  }, []);

  async function run() {
    try {
      // Detect repo
      let r = repoArg ?? "";
      if (!r) {
        setPhase("init");
        r = await getRepo();
      }
      setRepo(r);

      // Save current branch
      const branch = await getCurrentBranch();
      setOriginalBranch(branch);

      // Fetch PRs
      setPhase("fetching");
      let prs = await getOpenPRs(r);

      // Filter to single PR if specified
      if (prNumber) {
        prs = prs.filter((p) => p.number === prNumber);
        if (prs.length === 0) {
          setError(`PR #${prNumber} not found or not open.`);
          setPhase("done");
          return;
        }
      }

      if (prs.length === 0) {
        setPhase("done");
        return;
      }

      const initial: PRStatus[] = prs.map((pr) => ({
        pr,
        status: "pending",
        commentCount: 0,
        inlineCount: 0,
      }));
      setStatuses(initial);
      setPhase("processing");

      // Process PRs sequentially
      for (let i = 0; i < prs.length; i++) {
        const pr = prs[i];

        // Update status: loading comments
        setStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "loading" } : s,
          ),
        );

        // Fetch comments
        let comments: ReviewComment[];
        try {
          comments = await getReviewComments(r, pr.number);
        } catch {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "error", message: "Failed to fetch comments" }
                : s,
            ),
          );
          continue;
        }

        const generalCount = comments.filter((c) => c.type !== "inline").length;
        const inlineCount = comments.filter((c) => c.type === "inline").length;

        if (comments.length === 0) {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "skipped", commentCount: 0, inlineCount: 0, message: "No CodeRabbit comments" }
                : s,
            ),
          );
          continue;
        }

        // Update counts
        setStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "processing", commentCount: generalCount, inlineCount }
              : s,
          ),
        );

        // Checkout branch
        const checked = await checkoutBranch(pr.headRefName);
        if (!checked) {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "error", message: `Cannot checkout ${pr.headRefName}` }
                : s,
            ),
          );
          continue;
        }
        await pullLatest();

        // Process with Claude
        const feedback = formatReviewForPrompt(pr, comments);
        try {
          const output = await processReview(feedback, pr.number, pr.title);

          if (dryRun) {
            setStatuses((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: "done", message: "Dry run — no commit" }
                  : s,
              ),
            );
            continue;
          }

          // Commit & push
          const changed = await hasChanges();
          if (changed) {
            setStatuses((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, status: "committing" } : s,
              ),
            );

            await commitAndPush(
              pr.headRefName,
              `fix: apply CodeRabbit review suggestions for PR #${pr.number}\n\nAutomatically processed by pr-farmer.\nBased on ${generalCount} comment(s) and ${inlineCount} inline review(s).`,
            );
            setStatuses((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: "done", message: "Committed & pushed" }
                  : s,
              ),
            );
          } else {
            setStatuses((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: "done", message: "No changes needed" }
                  : s,
              ),
            );
          }
        } catch (err) {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? {
                    ...s,
                    status: "error",
                    message: err instanceof Error ? err.message : "Claude processing failed",
                  }
                : s,
            ),
          );
        }
      }

      // Return to original branch
      if (originalBranch || branch) {
        await checkoutBranch(branch);
      }

      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("done");
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {"🌾 pr-farmer"}
        </Text>
        {repo ? (
          <Text color="gray"> — {repo}</Text>
        ) : null}
        {dryRun ? (
          <Text color="yellow"> [dry-run]</Text>
        ) : null}
      </Box>

      {phase === "init" && (
        <Box>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> Detecting repository...</Text>
        </Box>
      )}

      {phase === "fetching" && (
        <Box>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> Fetching open pull requests...</Text>
        </Box>
      )}

      {error ? (
        <Box>
          <Text color="red">Error: {error}</Text>
        </Box>
      ) : null}

      {statuses.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {statuses.map((s) => (
            <Box key={s.pr.number} marginBottom={0}>
              <StatusIcon status={s.status} />
              <Text>
                {" "}
                <Text bold>#{s.pr.number}</Text> {s.pr.title}
              </Text>
              {s.commentCount + s.inlineCount > 0 && (
                <Text color="gray">
                  {" "}
                  ({s.commentCount + s.inlineCount} comments)
                </Text>
              )}
              {s.message && (
                <Text color={s.status === "error" ? "red" : "gray"}>
                  {" "}
                  — {s.message}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {phase === "done" && !error && (
        <Box marginTop={1}>
          <Text color="green">
            Done! {statuses.filter((s) => s.status === "done").length} processed,{" "}
            {statuses.filter((s) => s.status === "skipped").length} skipped,{" "}
            {statuses.filter((s) => s.status === "error").length} errors.
          </Text>
        </Box>
      )}
    </Box>
  );
}

function StatusIcon({ status }: { status: PRStatus["status"] }) {
  switch (status) {
    case "pending":
      return <Text color="gray">○</Text>;
    case "loading":
      return (
        <Text color="yellow">
          <Spinner type="dots" />
        </Text>
      );
    case "processing":
      return (
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
      );
    case "committing":
      return (
        <Text color="blue">
          <Spinner type="dots" />
        </Text>
      );
    case "done":
      return <Text color="green">●</Text>;
    case "skipped":
      return <Text color="yellow">○</Text>;
    case "error":
      return <Text color="red">✗</Text>;
  }
}
