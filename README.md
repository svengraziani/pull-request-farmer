# pr-farmer 🌾

Automatically process [CodeRabbit](https://coderabbit.ai) review comments with [Claude Code](https://claude.ai/claude-code).

pr-farmer fetches open pull requests from your GitHub repo, collects all CodeRabbit review comments (general + inline), and passes them to Claude Code to implement the suggested improvements. Changes are auto-committed and pushed.

## Getting Started

### 1. Prerequisites

Make sure you have the following installed:

| Tool | Install | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) >= 18 | `brew install node` | Runtime |
| [GitHub CLI](https://cli.github.com/) | `brew install gh` | Fetching PRs & comments |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | AI code fixes |

### 2. Authenticate GitHub CLI

```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account. pr-farmer uses `gh` to access the GitHub API — no tokens to configure manually.

### 3. Install pr-farmer

```bash
# From npm (once published)
npm install -g pr-farmer

# Or directly from the repo
git clone https://github.com/svengraziani/pull-request-farmer.git
cd pull-request-farmer
npm install
npm run build
npm link
```

### 4. Set up CodeRabbit on your repo

If you haven't already, add [CodeRabbit](https://coderabbit.ai) to your GitHub repository. It will automatically review your pull requests and leave comments with suggestions.

### 5. Run it

```bash
cd your-project   # navigate to any repo with open PRs
pr-farmer review   # interactive mode — pick which reviews to fix
```

That's it! pr-farmer will detect the repo, fetch CodeRabbit reviews, and let Claude Code fix them.

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

| Key | Action |
|-----|--------|
| `↑` `↓` / `j` `k` | Navigate |
| `space` | Toggle comment (on a PR header: toggle all in that PR) |
| `a` | Select / deselect all |
| `enter` | Confirm and start processing |
| `q` | Quit |

**Example output:**
```
🌾 pr-farmer review — 3/6 selected

↑↓/jk navigate • space toggle • a select all • enter confirm • q quit

  PR #8: feat: add generic Webhook channel (2/4)
  ◉ src/channels/webhook.ts:77   Validate webhook URL before…
  ◉ src/channels/webhook.ts:107  Consider using a Map instead…
  ○ src/channels/webhook.ts:145  Add error handling for…
  ○ README.md:497                Update documentation to…

  PR #25: feat: add Time Awareness (1/2)
  ◉ src/time.ts:15  Use Intl.DateTimeFormat…
  ○ src/time.ts:42  Consider caching…
```

## How it works

```
┌─────────────┐     ┌───────────┐     ┌─────────────┐     ┌──────────┐
│  GitHub API  │────▶│ pr-farmer │────▶│ Claude Code │────▶│ git push │
│  (via gh)    │     │           │     │  (in worktree) │  │          │
└─────────────┘     └───────────┘     └─────────────┘     └──────────┘
```

1. Detects the current GitHub repository (or uses `--repo`)
2. Fetches all open pull requests
3. Collects CodeRabbit comments per PR:
   - General PR comments
   - Review bodies
   - Inline file-specific review comments
4. Creates a **git worktree** for each PR branch (no dirty state, no branch switching)
5. Passes the review feedback to Claude Code inside the worktree
6. If Claude made changes: auto-commits and pushes to the PR branch
7. Cleans up worktrees automatically

### Why worktrees?

Instead of `git checkout` (which requires a clean working tree and interrupts your work), pr-farmer creates temporary [git worktrees](https://git-scm.com/docs/git-worktree). Each PR gets its own isolated copy of the repo. Your current branch and uncommitted changes stay untouched.

## Tips

- Use `--dry-run` first to see what Claude would change without committing
- Use `pr-farmer fix --pr 8` to process a single PR when you know exactly which one
- Use `pr-farmer review` when you want to cherry-pick specific suggestions
- Works from any directory inside a git repo — it auto-detects the remote

## License

MIT
