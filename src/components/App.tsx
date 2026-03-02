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
  // execa timeout errors include the full command — extract just the timeout part
  const timeoutMatch = msg.match(/timed? ?out after (\d+)/i);
  if (timeoutMatch) {
    const mins = Math.round(Number(timeoutMatch[1]) / 60000);
    return `Timed out after ${mins} min`;
  }
  // Truncate long error messages (execa includes full command)
  if (msg.length > 120) return msg.slice(0, 120) + "…";
  return msg;
}

interface PRStatus {
  pr: PullRequest;
  status: "pending" | "loading" | "worktree" | "processing" | "committing" | "done" | "skipped" | "error";
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
  const [error, setError] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const { stdout } = useStdout();

  useEffect(() => {
    run();
  }, []);

  async function run() {
    try {
      let r = repoArg ?? "";
      if (!r) {
        setPhase("init");
        r = await getRepo();
      }
      setRepo(r);

      setPhase("fetching");
      let prs = await getOpenPRs(r);

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

      for (let i = 0; i < prs.length; i++) {
        const pr = prs[i];

        // Fetch comments
        setStatuses((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "loading" } : s)),
        );

        let comments: ReviewComment[];
        try {
          comments = await getReviewComments(r, pr.number);
        } catch {
          setStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "error", message: "Failed to fetch comments" } : s,
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
                ? { ...s, status: "skipped", message: "No review comments" }
                : s,
            ),
          );
          continue;
        }

        // Create worktree
        setStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "worktree", commentCount: generalCount, inlineCount }
              : s,
          ),
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

        // Process with Claude in worktree
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

          const changed = await hasChanges(worktree.path);
          if (changed) {
            setStatuses((prev) =>
              prev.map((s, idx) => (idx === i ? { ...s, status: "committing" } : s)),
            );

            await commitAndPush(
              pr.headRefName,
              `fix: apply review suggestions for PR #${pr.number}\n\nAutomatically processed by pr-farmer.\nBased on ${generalCount} comment(s) and ${inlineCount} inline review(s).`,
              worktree.path,
            );

            let resolveMsg = "";
            try {
              const resolved = await resolveReviewThreads(r, pr.number, comments);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("done");
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{"🌾 pr-farmer fix"}</Text>
        {repo ? <Text color="gray"> — {repo}</Text> : null}
        {dryRun ? <Text color="yellow"> [dry-run]</Text> : null}
      </Box>

      {phase === "init" && (
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Detecting repository...</Text>
        </Box>
      )}

      {phase === "fetching" && (
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Fetching open pull requests...</Text>
        </Box>
      )}

      {error ? (
        <Box><Text color="red">Error: {error}</Text></Box>
      ) : null}

      {statuses.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {statuses.map((s) => (
            <Box key={s.pr.number}>
              <StatusIcon status={s.status} />
              <Text> <Text bold>#{s.pr.number}</Text> {s.pr.title}</Text>
              {s.commentCount + s.inlineCount > 0 && (
                <Text color="gray"> ({s.commentCount + s.inlineCount} comments)</Text>
              )}
              {s.message && (
                <Text color={s.status === "error" ? "red" : "gray"}> — {s.message}</Text>
              )}
            </Box>
          ))}

          {logLines.length > 0 && phase === "processing" && (
            <LogView lines={logLines} maxRows={Math.max(6, (stdout.rows ?? 24) - statuses.length - 8)} />
          )}
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
    case "worktree":
      return <Text color="yellow"><Spinner type="dots" /></Text>;
    case "processing":
      return <Text color="cyan"><Spinner type="dots" /></Text>;
    case "committing":
      return <Text color="blue"><Spinner type="dots" /></Text>;
    case "done":
      return <Text color="green">●</Text>;
    case "skipped":
      return <Text color="yellow">○</Text>;
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
