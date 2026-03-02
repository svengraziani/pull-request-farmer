import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { PullRequest, ReviewComment } from "../lib/github.js";

export interface PRWithComments {
  pr: PullRequest;
  comments: ReviewComment[];
}

export interface SelectedReview {
  pr: PullRequest;
  comments: ReviewComment[];
}

interface ReviewPickerProps {
  prs: PRWithComments[];
  onConfirm: (selected: SelectedReview[]) => void;
}

interface FlatItem {
  kind: "pr-header" | "comment";
  pr: PullRequest;
  comment?: ReviewComment;
  index: number; // global index for flat list
}

export function ReviewPicker({ prs, onConfirm }: ReviewPickerProps) {
  const { exit } = useApp();

  // Build flat list of selectable items
  const flatItems: FlatItem[] = [];
  let idx = 0;
  for (const { pr, comments } of prs) {
    flatItems.push({ kind: "pr-header", pr, index: idx++ });
    for (const comment of comments) {
      flatItems.push({ kind: "comment", pr, comment, index: idx++ });
    }
  }

  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);

  useInput((input, key) => {
    if (confirmed) return;

    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(flatItems.length - 1, c + 1));
    }

    // Space: toggle selection
    if (input === " ") {
      const item = flatItems[cursor];
      if (item.kind === "pr-header") {
        // Toggle all comments in this PR
        const prComments = flatItems.filter(
          (f) => f.kind === "comment" && f.pr.number === item.pr.number,
        );
        const allSelected = prComments.every((c) => selected.has(c.index));
        setSelected((prev) => {
          const next = new Set(prev);
          for (const c of prComments) {
            if (allSelected) {
              next.delete(c.index);
            } else {
              next.add(c.index);
            }
          }
          return next;
        });
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(cursor)) {
            next.delete(cursor);
          } else {
            next.add(cursor);
          }
          return next;
        });
      }
    }

    // A: select all
    if (input === "a") {
      const allComments = flatItems.filter((f) => f.kind === "comment");
      const allSelected = allComments.every((c) => selected.has(c.index));
      if (allSelected) {
        setSelected(new Set());
      } else {
        setSelected(new Set(allComments.map((c) => c.index)));
      }
    }

    // Enter: confirm
    if (key.return) {
      setConfirmed(true);

      // Group selected comments by PR
      const result: Map<number, SelectedReview> = new Map();
      for (const idx of selected) {
        const item = flatItems[idx];
        if (item.kind === "comment" && item.comment) {
          if (!result.has(item.pr.number)) {
            result.set(item.pr.number, { pr: item.pr, comments: [] });
          }
          result.get(item.pr.number)!.comments.push(item.comment);
        }
      }

      onConfirm(Array.from(result.values()));
    }

    // Q: quit
    if (input === "q") {
      exit();
    }
  });

  if (confirmed) {
    return null;
  }

  const selectedCount = Array.from(selected).filter(
    (i) => flatItems[i]?.kind === "comment",
  ).length;
  const totalComments = flatItems.filter((f) => f.kind === "comment").length;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {"🌾 pr-farmer review"}
        </Text>
        <Text color="gray">
          {" "}
          — {selectedCount}/{totalComments} selected
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          ↑↓/jk navigate • space toggle • a select all • enter confirm • q quit
        </Text>
      </Box>

      <Box flexDirection="column">
        {flatItems.map((item, i) => {
          const isCursor = i === cursor;
          const isSelected = selected.has(i);

          if (item.kind === "pr-header") {
            const prCommentItems = flatItems.filter(
              (f) => f.kind === "comment" && f.pr.number === item.pr.number,
            );
            const prSelectedCount = prCommentItems.filter((c) =>
              selected.has(c.index),
            ).length;

            return (
              <Box key={`pr-${item.pr.number}`} marginTop={i > 0 ? 1 : 0}>
                <Text color={isCursor ? "cyan" : "white"}>
                  {isCursor ? "❯ " : "  "}
                </Text>
                <Text bold color={isCursor ? "cyan" : "white"}>
                  PR #{item.pr.number}: {item.pr.title}
                </Text>
                <Text color="gray">
                  {" "}
                  ({prSelectedCount}/{prCommentItems.length})
                </Text>
              </Box>
            );
          }

          const comment = item.comment!;
          const label =
            comment.type === "inline"
              ? `${comment.path}:${comment.line}`
              : comment.type;

          // Truncate body for preview
          const preview = comment.body
            .replace(/\n/g, " ")
            .replace(/<[^>]*>/g, "")
            .slice(0, 80);

          return (
            <Box key={`comment-${i}`}>
              <Text color={isCursor ? "cyan" : "white"}>
                {isCursor ? "❯ " : "  "}
              </Text>
              <Text color={isSelected ? "green" : "gray"}>
                {isSelected ? "◉" : "○"}{" "}
              </Text>
              <Text color={isCursor ? "cyan" : "yellow"}>{label}</Text>
              <Text color="gray"> {preview}…</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
