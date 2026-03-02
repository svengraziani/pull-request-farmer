import { execa } from "execa";
import { join } from "path";

const WORKTREE_DIR = ".pr-farmer-worktrees";

export async function getRepoRoot(): Promise<string> {
  const result = await execa("git", ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

export async function getCurrentBranch(): Promise<string> {
  const result = await execa("git", ["branch", "--show-current"]);
  return result.stdout.trim();
}

export async function checkoutBranch(branch: string): Promise<boolean> {
  try {
    await execa("git", ["checkout", branch]);
    return true;
  } catch {
    return false;
  }
}

export async function pullLatest(cwd?: string): Promise<void> {
  try {
    await execa("git", ["pull", "--ff-only"], cwd ? { cwd } : {});
  } catch {
    // might not have upstream, that's ok
  }
}

export async function hasChanges(cwd?: string): Promise<boolean> {
  const opts = cwd ? { cwd } : {};
  try {
    await execa("git", ["diff", "--quiet"], opts);
    await execa("git", ["diff", "--cached", "--quiet"], opts);
    return false;
  } catch {
    return true;
  }
}

export async function commitAndPush(
  branch: string,
  message: string,
  cwd?: string,
): Promise<void> {
  const opts = cwd ? { cwd } : {};
  await execa("git", ["add", "-A"], opts);
  await execa("git", ["commit", "-m", message], opts);
  await execa("git", ["push", "origin", branch], opts);
}

// ─── Worktree management ────────────────────────────────────────

export interface Worktree {
  path: string;
  branch: string;
}

export async function createWorktree(branch: string): Promise<Worktree> {
  const root = await getRepoRoot();
  const worktreePath = join(root, WORKTREE_DIR, `pr-${branch.replace(/\//g, "-")}`);

  // Fetch the branch first so we have it locally
  try {
    await execa("git", ["fetch", "origin", `${branch}:${branch}`], { cwd: root });
  } catch {
    // branch might already exist locally
  }

  // Create worktree
  try {
    await execa("git", ["worktree", "add", worktreePath, branch], { cwd: root });
  } catch {
    // worktree might already exist — try to reuse it
    const exists = await worktreeExists(worktreePath);
    if (!exists) throw new Error(`Failed to create worktree for ${branch}`);
  }

  // Pull latest in worktree
  await pullLatest(worktreePath);

  return { path: worktreePath, branch };
}

export async function removeWorktree(worktree: Worktree): Promise<void> {
  const root = await getRepoRoot();
  try {
    await execa("git", ["worktree", "remove", worktree.path, "--force"], { cwd: root });
  } catch {
    // best effort cleanup
  }
}

async function worktreeExists(path: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--git-dir"], { cwd: path });
    return true;
  } catch {
    return false;
  }
}

export async function cleanupAllWorktrees(): Promise<void> {
  const root = await getRepoRoot();
  try {
    await execa("git", ["worktree", "prune"], { cwd: root });
  } catch {
    // best effort
  }
}
