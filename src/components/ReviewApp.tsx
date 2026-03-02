import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
import {
  getRepo,
  getOpenPRs,
  getReviewComments,
  formatReviewForPrompt,
  resolveReviewThreads,
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

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return "Processing failed";
  const msg = err.message;
  const timeoutMatch = msg.match(/timed? ?out after (\d+)/i);
  if (timeoutMatch) {
    const mins = Math.round(Number(timeoutMatch[1]) / 60000);
    return `Timed out after ${mins} min`;
  }
  if (msg.length > 120) return msg.slice(0, 120) + "…";
  return msg;
}

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
  const [logLines, setLogLines] = useState<string[]>([]);
  const { stdout } = useStdout();

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
        setError("No PRs with reviews found.");
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
      setLogLines([]);
      try {
        await processReview(feedback, pr.number, pr.title, worktree.path, (chunk) => {
          setLogLines((prev) => {
            const newLines = (prev.join("") + chunk).split("\n");
            return newLines;
          });
        });

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
            `fix: apply review suggestions for PR #${pr.number}\n\nAutomatically processed by pr-farmer.\nBased on ${generalCount} comment(s) and ${inlineCount} inline review(s).`,
            worktree.path,
          );

          let resolveMsg = "";
          try {
            const resolved = await resolveReviewThreads(repo, pr.number, comments);
            if (resolved > 0) resolveMsg = `, ${resolved} thread(s) resolved`;
          } catch {
            // Don't break the flow if resolving fails
          }

          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "done", message: `Committed & pushed${resolveMsg}` } : s,
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
              ? { ...s, status: "error", message: formatError(err) }
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

          {logLines.length > 0 && (
            <LogView lines={logLines} maxRows={Math.max(6, (stdout.rows ?? 24) - statuses.length - 8)} />
          )}
        </Box>
      )}

      {phase === "done" && (
        <Box flexDirection="column" padding={1}>
          {error ? (
            <Text color="red">{error}</Text>
          ) : (
            <>
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
              <Box marginTop={1}>
                <Text color="green">
                  Done! {statuses.filter((s) => s.status === "done").length} processed,{" "}
                  {statuses.filter((s) => s.status === "error").length} errors.
                </Text>
              </Box>
            </>
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

function LogView({ lines, maxRows }: { lines: string[]; maxRows: number }) {
  const visible = lines.slice(-maxRows);
  return (
    <Box flexDirection="column" marginTop={1} height={maxRows}>
      <Box marginBottom={0}>
        <Text color="gray" dimColor>{"─".repeat(40)} claude output {"─".repeat(40)}</Text>
      </Box>
      {visible.map((line, i) => (
        <Text key={i} color="gray" wrap="truncate">{line}</Text>
      ))}
    </Box>
  );
}
