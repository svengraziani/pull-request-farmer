# pr-farmer 🌾

Automatically process [CodeRabbit](https://coderabbit.ai) review comments with [Claude Code](https://claude.ai/claude-code).

pr-farmer fetches open pull requests from your GitHub repo, collects all CodeRabbit review comments (general + inline), and passes them to Claude Code to implement the suggested improvements. Changes are auto-committed and pushed.

## Install

```bash
npm install -g pr-farmer
```

### Requirements

- [Node.js](https://nodejs.org/) >= 18
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- [Claude Code](https://claude.ai/claude-code) (`claude`) — installed and configured

## Commands

### `pr-farmer fix` — Auto-fix all reviews

Processes all open PRs with CodeRabbit reviews automatically. Each PR gets its own git worktree, so your working directory stays clean.

```bash
# Process all open PRs
pr-farmer fix

# Process a specific PR
pr-farmer fix --pr 8

# Specify a repo (default: auto-detect from git remote)
pr-farmer fix --repo owner/repo

# Dry run — see what would happen without committing
pr-farmer fix --dry-run
```

### `pr-farmer review` — Interactive mode

Browse all CodeRabbit review comments, pick which ones to fix, then let Claude handle the rest.

```bash
pr-farmer review

# With options
pr-farmer review --repo owner/repo --dry-run
```

**Controls:**
- `↑↓` / `j` `k` — navigate
- `space` — toggle comment (on a PR header: toggle all)
- `a` — select / deselect all
- `enter` — confirm and process selected
- `q` — quit

## How it works

1. Detects the current GitHub repository (or uses `--repo`)
2. Fetches all open pull requests
3. Collects CodeRabbit comments per PR:
   - General PR comments
   - Review bodies
   - Inline file-specific review comments
4. Creates a **git worktree** for each PR branch (no dirty state, no branch switching)
5. Passes the review feedback to Claude Code inside the worktree
6. If Claude made changes: commits and pushes to the PR branch
7. Cleans up worktrees automatically

## License

MIT
