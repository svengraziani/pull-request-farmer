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
  createWorktree,
  removeWorktree,
  hasChanges,
  commitAndPush,
  cleanupAllWorktrees,
  type Worktree,
} from "../lib/git.js";
import { processReview } from "../lib/claude.js";
import {
  ReviewPicker,
  type PRWithComments,
  type SelectedReview,
} from "./ReviewPicker.js";

interface PRProcessStatus {
  pr: PullRequest;
  status: "pending" | "worktree" | "processing" | "committing" | "done" | "error";
  message?: string;
}

interface ReviewAppProps {
  repo?: string;
  dryRun?: boolean;
}

export function ReviewApp({ repo: repoArg, dryRun }: ReviewAppProps) {
  const [repo, setRepo] = useState(repoArg ?? "");
  const [phase, setPhase] = useState<"init" | "fetching" | "picking" | "processing" | "done">("init");
  const [prData, setPrData] = useState<PRWithComments[]>([]);
  const [statuses, setStatuses] = useState<PRProcessStatus[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadReviews();
  }, []);

  async function loadReviews() {
    try {
      let r = repoArg ?? "";
      if (!r) {
        r = await getRepo();
      }
      setRepo(r);
      setPhase("fetching");

      const prs = await getOpenPRs(r);

      // Fetch comments for all PRs
      const withComments: PRWithComments[] = [];
      for (const pr of prs) {
        const comments = await getReviewComments(r, pr.number);
        if (comments.length > 0) {
          withComments.push({ pr, comments });
        }
      }

      if (withComments.length === 0) {
        setError("No PRs with CodeRabbit reviews found.");
        setPhase("done");
        return;
      }

      setPrData(withComments);
      setPhase("picking");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch reviews");
      setPhase("done");
    }
  }

  async function handleConfirm(selected: SelectedReview[]) {
    if (selected.length === 0) {
      setPhase("done");
      return;
    }

    setPhase("processing");
    setStatuses(selected.map((s) => ({ pr: s.pr, status: "pending" })));

    for (let i = 0; i < selected.length; i++) {
      const { pr, comments } = selected[i];

      // Create worktree
      setStatuses((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "worktree" } : s)),
      );

      let worktree: Worktree;
      try {
        worktree = await createWorktree(pr.headRefName);
      } catch (err) {
        setStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "error", message: `Worktree failed: ${err instanceof Error ? err.message : "unknown"}` }
              : s,
          ),
        );
        continue;
      }

      // Process with Claude
      setStatuses((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "processing" } : s)),
      );

      const feedback = formatReviewForPrompt(pr, comments);
      try {
        await processReview(feedback, pr.number, pr.title, worktree.path);

        if (dryRun) {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "done", message: "Dry run — no commit" } : s,
            ),
          );
          await removeWorktree(worktree);
          continue;
        }

        // Commit & push from worktree
        const changed = await hasChanges(worktree.path);
        if (changed) {
          setStatuses((prev) =>
            prev.map((s, idx) => (idx === i ? { ...s, status: "committing" } : s)),
          );

          const generalCount = comments.filter((c) => c.type !== "inline").length;
          const inlineCount = comments.filter((c) => c.type === "inline").length;

          await commitAndPush(
            pr.headRefName,
            `fix: apply CodeRabbit review suggestions for PR #${pr.number}\n\nAutomatically processed by pr-farmer.\nBased on ${generalCount} comment(s) and ${inlineCount} inline review(s).`,
            worktree.path,
          );

          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "done", message: "Committed & pushed" } : s,
            ),
          );
        } else {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "done", message: "No changes needed" } : s,
            ),
          );
        }
      } catch (err) {
        setStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "error", message: err instanceof Error ? err.message : "Processing failed" }
              : s,
          ),
        );
      }

      // Cleanup worktree
      await removeWorktree(worktree);
    }

    await cleanupAllWorktrees();
    setPhase("done");
  }

  return (
    <Box flexDirection="column">
      {phase === "init" && (
        <Box padding={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Detecting repository...</Text>
        </Box>
      )}

      {phase === "fetching" && (
        <Box padding={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Fetching reviews from {repo}...</Text>
        </Box>
      )}

      {phase === "picking" && (
        <ReviewPicker prs={prData} onConfirm={handleConfirm} />
      )}

      {phase === "processing" && (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">{"🌾 pr-farmer"}</Text>
            <Text color="gray"> — processing selected reviews</Text>
            {dryRun && <Text color="yellow"> [dry-run]</Text>}
          </Box>

          {statuses.map((s) => (
            <Box key={s.pr.number}>
              <ProcessIcon status={s.status} />
              <Text> </Text>
              <Text bold>#{s.pr.number}</Text>
              <Text> {s.pr.title}</Text>
              {s.message && (
                <Text color={s.status === "error" ? "red" : "gray"}> — {s.message}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {phase === "done" && (
        <Box flexDirection="column" padding={1}>
          {error ? (
            <Text color="red">{error}</Text>
          ) : (
            <Text color="green">
              Done! {statuses.filter((s) => s.status === "done").length} processed,{" "}
              {statuses.filter((s) => s.status === "error").length} errors.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function ProcessIcon({ status }: { status: PRProcessStatus["status"] }) {
  switch (status) {
    case "pending":
      return <Text color="gray">○</Text>;
    case "worktree":
      return <Text color="blue"><Spinner type="dots" /></Text>;
    case "processing":
      return <Text color="cyan"><Spinner type="dots" /></Text>;
    case "committing":
      return <Text color="blue"><Spinner type="dots" /></Text>;
    case "done":
      return <Text color="green">●</Text>;
    case "error":
      return <Text color="red">✗</Text>;
  }
}
