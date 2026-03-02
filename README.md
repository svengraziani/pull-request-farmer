# pr-farmer 🌾

Automatically process [CodeRabbit](https://coderabbit.ai) review comments and implement GitHub issues with [Claude Code](https://claude.ai/claude-code).

pr-farmer is a full issue-to-PR pipeline: triage enhancement issues into plans, review and approve them, then auto-implement and open pull requests — all powered by Claude Code.

```
enhancement issue → (seed) → ready_to_review → (manual approval) → ready_to_develop → (pull) → PR opened
                     CodeRabbit reviews → (fix/review) → changes committed & pushed
```

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
cd your-project       # navigate to any repo with open PRs
pr-farmer seed        # triage enhancement issues into plans
pr-farmer review      # interactive mode — pick which reviews to fix
pr-farmer pull        # implement approved issues and open PRs
```

That's it! pr-farmer will detect the repo and let Claude Code handle the rest.

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

### `pr-farmer seed` — Triage enhancement issues

Fetches all open issues labeled `enhancement`, sends each to Claude to produce an implementation plan, and writes the plan into the issue body.

- If the issue is clear: writes the plan and re-labels `enhancement` → `ready_to_review`
- If the issue is ambiguous: posts clarifying questions as a comment and re-labels `enhancement` → `question`

```bash
pr-farmer seed

# With options
pr-farmer seed --repo owner/repo --dry-run
```

### `pr-farmer pull` — Implement approved issues

Fetches all open issues labeled `ready_to_develop`, creates a feature branch for each, runs Claude to implement the changes, and opens a PR with `Closes #N`.

```bash
pr-farmer pull

# With options
pr-farmer pull --repo owner/repo --dry-run
```

**Label workflow:**

| Label | Meaning |
|-------|---------|
| `enhancement` | New issue, needs triage (`seed`) |
| `question` | Needs clarification before planning |
| `ready_to_review` | Plan written, awaiting human approval |
| `ready_to_develop` | Approved, ready for implementation (`pull`) |

## How it works

```
┌─────────────┐     ┌───────────┐     ┌─────────────┐     ┌──────────┐
│  GitHub API  │────▶│ pr-farmer │────▶│ Claude Code │────▶│ git push │
│  (via gh)    │     │           │     │ (in worktree) │   │          │
└─────────────┘     └───────────┘     └─────────────┘     └──────────┘
```

**fix / review:**
1. Fetches open pull requests and their review comments
2. Creates a **git worktree** for each PR branch
3. Passes review feedback to Claude Code inside the worktree
4. If Claude made changes: auto-commits and pushes to the PR branch
5. Cleans up worktrees automatically

**seed:**
1. Fetches open issues labeled `enhancement`
2. Sends each issue to Claude for analysis
3. Writes the implementation plan into the issue body (or posts questions)
4. Updates labels to reflect the new status

**pull:**
1. Fetches open issues labeled `ready_to_develop`
2. Creates a feature branch and worktree for each issue
3. Runs Claude to implement the feature based on the issue and plan
4. Commits, pushes, and opens a PR linking back to the issue

### Why worktrees?

Instead of `git checkout` (which requires a clean working tree and interrupts your work), pr-farmer creates temporary [git worktrees](https://git-scm.com/docs/git-worktree). Each PR/issue gets its own isolated copy of the repo. Your current branch and uncommitted changes stay untouched.

## Tips

- Use `--dry-run` first to see what Claude would change without committing
- Use `pr-farmer fix --pr 8` to process a single PR when you know exactly which one
- Use `pr-farmer review` when you want to cherry-pick specific review suggestions
- Use `pr-farmer seed` + `pr-farmer pull` for the full issue-to-PR pipeline
- Works from any directory inside a git repo — it auto-detects the remote

## License

MIT
