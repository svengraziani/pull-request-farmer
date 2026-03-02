#!/usr/bin/env node
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { App } from "./components/App.js";

const program = new Command();

program
  .name("pr-farmer")
  .description("Automatically process CodeRabbit review comments with Claude Code")
  .version("0.1.0");

program
  .command("fix")
  .description("Fetch CodeRabbit reviews from open PRs and apply fixes with Claude Code")
  .option("-r, --repo <owner/repo>", "GitHub repository (default: auto-detect from git remote)")
  .option("-p, --pr <number>", "Process only a specific PR number", parseInt)
  .option("--dry-run", "Run without committing or pushing changes")
  .action((opts) => {
    render(
      <App repo={opts.repo} prNumber={opts.pr} dryRun={opts.dryRun} />,
    );
  });

// Default command: show help
program
  .action(() => {
    program.help();
  });

program.parse();
