import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
import {
  getRepo,
  getIssuesByLabel,
  getIssueComments,
  setIssueLabel,
  removeIssueLabel,
  createPullRequest,
  type GitHubIssue,
} from "../lib/github.js";
import {
  createFeatureBranch,
  slugifyBranch,
  removeWorktree,
  hasChanges,
  commitAndPush,
  cleanupAllWorktrees,
} from "../lib/git.js";
import { implementFromPlan } from "../lib/claude.js";

type IssueStatus =
  | "pending"
  | "loading"
  | "branching"
  | "implementing"
  | "committing"
  | "pr-creating"
  | "done"
  | "error";

interface IssueState {
  issue: GitHubIssue;
  status: IssueStatus;
  message?: string;
}

interface PullAppProps {
  repo?: string;
  dryRun?: boolean;
}

export function PullApp({ repo: repoArg, dryRun }: PullAppProps) {
  const [repo, setRepo] = useState(repoArg ?? "");
  const [issueStates, setIssueStates] = useState<IssueState[]>([]);
  const [phase, setPhase] = useState<"init" | "fetching" | "implementing" | "done">("init");
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
      const issues = await getIssuesByLabel(r, "ready_to_develop");

      if (issues.length === 0) {
        setPhase("done");
        return;
      }

      const initial: IssueState[] = issues.map((issue) => ({
        issue,
        status: "pending",
      }));
      setIssueStates(initial);
      setPhase("implementing");

      for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];

        // Claim the issue immediately to prevent parallel runs from picking it up
        if (!dryRun) {
          try {
            await setIssueLabel(r, issue.number, "in_progress", "ready_to_develop");
          } catch {
            setIssueStates((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: "error", message: "Failed to claim issue" }
                  : s,
              ),
            );
            continue;
          }
        }

        // Fetch issue comments (to get the plan)
        setIssueStates((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "loading" } : s)),
        );

        let comments;
        try {
          comments = await getIssueComments(r, issue.number);
        } catch (err) {
          if (!dryRun) {
            try { await setIssueLabel(r, issue.number, "ready_to_develop", "in_progress"); } catch {}
          }
          setIssueStates((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "error", message: "Failed to fetch comments" }
                : s,
            ),
          );
          continue;
        }

        // Create feature branch
        setIssueStates((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "branching" } : s)),
        );

        const branchName = slugifyBranch(issue.number, issue.title);
        let worktree;
        try {
          worktree = await createFeatureBranch(branchName);
        } catch (err) {
          if (!dryRun) {
            try { await setIssueLabel(r, issue.number, "ready_to_develop", "in_progress"); } catch {}
          }
          setIssueStates((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "error", message: `Branch failed: ${err instanceof Error ? err.message : "unknown"}` }
                : s,
            ),
          );
          continue;
        }

        // Implement with Claude
        setIssueStates((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "implementing" } : s)),
        );

        setLogLines([]);
        try {
          await implementFromPlan(issue, comments, worktree.path, (chunk) => {
            setLogLines((prev) => {
              const newLines = (prev.join("") + chunk).split("\n");
              return newLines;
            });
          });

          if (dryRun) {
            setIssueStates((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, status: "done", message: "Dry run — no commit" } : s,
              ),
            );
            await removeWorktree(worktree);
            continue;
          }

          const changed = await hasChanges(worktree.path);
          if (!changed) {
            // Restore label — nothing was done
            try { await setIssueLabel(r, issue.number, "ready_to_develop", "in_progress"); } catch {}
            setIssueStates((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, status: "done", message: "No changes produced" } : s,
              ),
            );
            await removeWorktree(worktree);
            continue;
          }

          // Commit & push
          setIssueStates((prev) =>
            prev.map((s, idx) => (idx === i ? { ...s, status: "committing" } : s)),
          );

          await commitAndPush(
            branchName,
            `feat: implement #${issue.number} — ${issue.title}\n\nAutomatically implemented by pr-farmer.`,
            worktree.path,
          );

          // Create PR
          setIssueStates((prev) =>
            prev.map((s, idx) => (idx === i ? { ...s, status: "pr-creating" } : s)),
          );

          const prUrl = await createPullRequest(r, branchName, issue);
          // Clean up the in_progress label — issue will be closed by "Closes #N" on merge
          try { await removeIssueLabel(r, issue.number, "in_progress"); } catch {}
          setIssueStates((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "done", message: `PR created: ${prUrl}` } : s,
            ),
          );
        } catch (err) {
          // Restore label so the issue can be retried
          try { await setIssueLabel(r, issue.number, "ready_to_develop", "in_progress"); } catch {}
          setIssueStates((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "error", message: err instanceof Error ? err.message : "Implementation failed" }
                : s,
            ),
          );
        }

        // Cleanup worktree
        if (worktree) {
          await removeWorktree(worktree);
        }
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
        <Text bold color="cyan">{"🚜 pr-farmer pull"}</Text>
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
          <Text> Fetching ready_to_develop issues...</Text>
        </Box>
      )}

      {error ? (
        <Box><Text color="red">Error: {error}</Text></Box>
      ) : null}

      {issueStates.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {issueStates.map((s) => (
            <Box key={s.issue.number}>
              <PullStatusIcon status={s.status} />
              <Text> <Text bold>#{s.issue.number}</Text> {s.issue.title}</Text>
              {s.message && (
                <Text color={s.status === "error" ? "red" : "gray"}> — {s.message}</Text>
              )}
            </Box>
          ))}

          {logLines.length > 0 && phase === "implementing" && (
            <LogView lines={logLines} maxRows={Math.max(6, (stdout.rows ?? 24) - issueStates.length - 8)} />
          )}
        </Box>
      )}

      {phase === "done" && !error && (
        <Box marginTop={1}>
          <Text color="green">
            Done! {issueStates.filter((s) => s.status === "done").length} processed,{" "}
            {issueStates.filter((s) => s.status === "error").length} errors.
          </Text>
        </Box>
      )}
    </Box>
  );
}

function PullStatusIcon({ status }: { status: IssueStatus }) {
  switch (status) {
    case "pending":
      return <Text color="gray">○</Text>;
    case "loading":
      return <Text color="yellow"><Spinner type="dots" /></Text>;
    case "branching":
      return <Text color="blue"><Spinner type="dots" /></Text>;
    case "implementing":
      return <Text color="cyan"><Spinner type="dots" /></Text>;
    case "committing":
      return <Text color="blue"><Spinner type="dots" /></Text>;
    case "pr-creating":
      return <Text color="magenta"><Spinner type="dots" /></Text>;
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
