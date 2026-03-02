#!/usr/bin/env node
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { App } from "./components/App.js";
import { ReviewApp } from "./components/ReviewApp.js";
import { SeedApp } from "./components/SeedApp.js";
import { PullApp } from "./components/PullApp.js";

const program = new Command();

program
  .name("pr-farmer")
  .description("Automatically process review comments with Claude Code")
  .version("0.1.0");

program
  .command("fix")
  .description("Auto-fix all reviews on open PRs (non-interactive)")
  .option("-r, --repo <owner/repo>", "GitHub repository (default: auto-detect)")
  .option("-p, --pr <number>", "Process only a specific PR number", parseInt)
  .option("--dry-run", "Run without committing or pushing changes")
  .action((opts) => {
    render(
      <App repo={opts.repo} prNumber={opts.pr} dryRun={opts.dryRun} />,
    );
  });

program
  .command("review")
  .description("Interactively pick which reviews to process")
  .option("-r, --repo <owner/repo>", "GitHub repository (default: auto-detect)")
  .option("--dry-run", "Run without committing or pushing changes")
  .action((opts) => {
    render(
      <ReviewApp repo={opts.repo} dryRun={opts.dryRun} />,
    );
  });

program
  .command("seed")
  .description("Triage enhancement issues into actionable plans")
  .option("-r, --repo <owner/repo>", "GitHub repository (default: auto-detect)")
  .option("--dry-run", "Run without commenting or changing labels")
  .action((opts) => {
    render(
      <SeedApp repo={opts.repo} dryRun={opts.dryRun} />,
    );
  });

program
  .command("pull")
  .description("Implement approved issues and open PRs")
  .option("-r, --repo <owner/repo>", "GitHub repository (default: auto-detect)")
  .option("--dry-run", "Run without committing, pushing, or creating PRs")
  .action((opts) => {
    render(
      <PullApp repo={opts.repo} dryRun={opts.dryRun} />,
    );
  });

program
  .action(() => {
    program.help();
  });

program.parse();
