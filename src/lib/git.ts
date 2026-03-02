import { execa } from "execa";

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

export async function pullLatest(): Promise<void> {
  try {
    await execa("git", ["pull", "--ff-only"]);
  } catch {
    // might not have upstream, that's ok
  }
}

export async function hasChanges(): Promise<boolean> {
  try {
    await execa("git", ["diff", "--quiet"]);
    await execa("git", ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

export async function commitAndPush(
  branch: string,
  message: string,
): Promise<void> {
  await execa("git", ["add", "-A"]);
  await execa("git", ["commit", "-m", message]);
  await execa("git", ["push", "origin", branch]);
}
