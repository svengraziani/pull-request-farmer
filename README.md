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

## Usage

```bash
# Process all open PRs with CodeRabbit reviews
pr-farmer fix

# Process a specific PR
pr-farmer fix --pr 8

# Specify a repo (default: auto-detect from git remote)
pr-farmer fix --repo owner/repo

# Dry run — see what would happen without committing
pr-farmer fix --dry-run
```

## How it works

1. Detects the current GitHub repository (or uses `--repo`)
2. Fetches all open pull requests
3. For each PR, collects CodeRabbit comments:
   - General PR comments
   - Review bodies
   - Inline file-specific review comments
4. Checks out the PR branch
5. Passes the review feedback to Claude Code
6. If Claude made changes: commits and pushes to the PR branch
7. Returns to your original branch

## License

MIT
