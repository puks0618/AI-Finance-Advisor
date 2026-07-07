"use client";

import { useState } from "react";

interface DecisionTreeOutcome {
  sector: string;
  pressure: "upward" | "downward" | "neutral";
  reason: string;
}

interface DecisionTreeBranch {
  label: string;
  children?: DecisionTreeBranch[];
  outcome?: DecisionTreeOutcome;
}

interface DecisionTree {
  event: string;
  summaryParagraph: string;
  root: DecisionTreeBranch;
  summary: DecisionTreeOutcome[];
}

const PRESSURE_STYLES: Record<DecisionTreeOutcome["pressure"], string> = {
  upward: "text-neon-green",
  downward: "text-neon-pink",
  neutral: "text-neon-cyan",
};

const PRESSURE_LABEL: Record<DecisionTreeOutcome["pressure"], string> = {
  upward: "Upward pressure",
  downward: "Downward pressure",
  neutral: "Neutral",
};

// Depth-1 branches (the root's direct children) start expanded so the tree's shape is visible
// without any clicks; deeper leaf detail stays collapsed until the user asks for it.
function TreeNode({ branch, depth }: { branch: DecisionTreeBranch; depth: number }) {
  const [expanded, setExpanded] = useState(depth <= 1);
  const hasChildren = !!branch.children?.length;

  return (
    <div className={depth > 1 ? "border-l border-[var(--border-subtle)] pl-3" : ""}>
      <button
        type="button"
        onClick={() => hasChildren && setExpanded((e) => !e)}
        disabled={!hasChildren}
        className={`flex w-full items-start gap-1.5 text-left text-sm ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        }`}
      >
        {hasChildren ? (
          <span className="mt-0.5 text-[var(--text-muted)]">{expanded ? "▾" : "▸"}</span>
        ) : (
          <span className="mt-0.5 text-[var(--text-muted)]">·</span>
        )}
        <span className="text-[var(--text-primary)]">{branch.label}</span>
      </button>

      {branch.outcome && (
        <p className="mt-1 pl-5 text-xs leading-5 text-[var(--text-secondary)]">
          <span className={`font-medium ${PRESSURE_STYLES[branch.outcome.pressure]}`}>
            {PRESSURE_LABEL[branch.outcome.pressure]}
          </span>{" "}
          ({branch.outcome.sector}) — {branch.outcome.reason}
        </p>
      )}

      {hasChildren && expanded && (
        <div className="mt-2 flex flex-col gap-2 pl-2">
          {branch.children!.map((child, i) => (
            <TreeNode key={i} branch={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DecisionTreeView({ tree }: { tree: DecisionTree }) {
  return (
    <div className="glass-card p-4">
      <h3 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">News decision tree</h3>
      <p className="mb-3 text-xs text-[var(--text-muted)]">Event: {tree.event}</p>

      <TreeNode branch={tree.root} depth={1} />

      <p className="mt-4 text-sm leading-6 text-[var(--text-primary)]">{tree.summaryParagraph}</p>

      {tree.summary.length > 0 && (
        <div className="glass-card mt-4 overflow-x-auto p-3">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-[var(--text-secondary)]">
                <th className="pb-2 font-medium">Sector</th>
                <th className="pb-2 font-medium">Pressure</th>
                <th className="pb-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {tree.summary.map((row, i) => (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className="py-2 text-[var(--text-primary)]">{row.sector}</td>
                  <td className={`py-2 font-medium ${PRESSURE_STYLES[row.pressure]}`}>
                    {PRESSURE_LABEL[row.pressure]}
                  </td>
                  <td className="py-2 text-[var(--text-secondary)]">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Reasoning about how this news could plausibly move supply and demand — not a forecast, and
        not a recommendation to buy or sell.
      </p>
    </div>
  );
}
