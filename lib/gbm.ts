/**
 * Minimal gradient-boosted regression trees — the same core algorithm family as XGBoost
 * (shallow trees fit sequentially on residuals, with shrinkage), hand-rolled in TypeScript
 * because this project has no Python runtime and no ML library installed. Generic/finance-
 * agnostic on purpose so it's independently testable; lib/prediction.ts supplies the features.
 */

export interface TrainingRow {
  features: number[];
  label: number;
}

export interface GbmOptions {
  rounds: number;
  learningRate: number;
  maxDepth: number;
  minLeafSize: number;
}

interface TreeNode {
  // Leaf node when featureIndex is null.
  featureIndex: number | null;
  threshold: number;
  left: TreeNode | null;
  right: TreeNode | null;
  value: number;
}

export interface GbmModel {
  trees: TreeNode[];
  initialValue: number;
  learningRate: number;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

// Naive O(features x rows x candidate-thresholds) SSE scan — fine at the ~100-200 row scale
// this model trains on; histogram/binned split-finding (what XGBoost needs at real scale)
// would be unneeded complexity here.
function buildTree(rows: TrainingRow[], residuals: number[], depth: number, opts: GbmOptions): TreeNode {
  const leafValue = mean(residuals);

  if (depth >= opts.maxDepth || rows.length < opts.minLeafSize * 2) {
    return { featureIndex: null, threshold: 0, left: null, right: null, value: leafValue };
  }

  const featureCount = rows[0].features.length;
  let bestFeature: number | null = null;
  let bestThreshold = 0;
  let bestSse = Infinity;

  for (let f = 0; f < featureCount; f++) {
    const candidateValues = Array.from(new Set(rows.map((r) => r.features[f]))).sort((a, b) => a - b);
    for (let i = 0; i < candidateValues.length - 1; i++) {
      const threshold = (candidateValues[i] + candidateValues[i + 1]) / 2;
      const leftResiduals: number[] = [];
      const rightResiduals: number[] = [];
      for (let j = 0; j < rows.length; j++) {
        if (rows[j].features[f] <= threshold) leftResiduals.push(residuals[j]);
        else rightResiduals.push(residuals[j]);
      }
      if (leftResiduals.length < opts.minLeafSize || rightResiduals.length < opts.minLeafSize) continue;

      const leftMean = mean(leftResiduals);
      const rightMean = mean(rightResiduals);
      const sse =
        leftResiduals.reduce((acc, v) => acc + (v - leftMean) ** 2, 0) +
        rightResiduals.reduce((acc, v) => acc + (v - rightMean) ** 2, 0);

      if (sse < bestSse) {
        bestSse = sse;
        bestFeature = f;
        bestThreshold = threshold;
      }
    }
  }

  // No split reduces SSE within the minLeafSize constraint — stop here rather than forcing one.
  if (bestFeature === null) {
    return { featureIndex: null, threshold: 0, left: null, right: null, value: leafValue };
  }

  const leftRows: TrainingRow[] = [];
  const leftResiduals: number[] = [];
  const rightRows: TrainingRow[] = [];
  const rightResiduals: number[] = [];
  for (let j = 0; j < rows.length; j++) {
    if (rows[j].features[bestFeature] <= bestThreshold) {
      leftRows.push(rows[j]);
      leftResiduals.push(residuals[j]);
    } else {
      rightRows.push(rows[j]);
      rightResiduals.push(residuals[j]);
    }
  }

  return {
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: buildTree(leftRows, leftResiduals, depth + 1, opts),
    right: buildTree(rightRows, rightResiduals, depth + 1, opts),
    value: leafValue,
  };
}

function predictTree(node: TreeNode, features: number[]): number {
  if (node.featureIndex === null) return node.value;
  const branch = features[node.featureIndex] <= node.threshold ? node.left : node.right;
  return branch ? predictTree(branch, features) : node.value;
}

export function trainGbm(rows: TrainingRow[], opts: GbmOptions): GbmModel {
  const initialValue = mean(rows.map((r) => r.label));
  const trees: TreeNode[] = [];
  const predictions = rows.map(() => initialValue);

  for (let round = 0; round < opts.rounds; round++) {
    const residuals = rows.map((r, i) => r.label - predictions[i]);
    const tree = buildTree(rows, residuals, 0, opts);
    trees.push(tree);
    for (let i = 0; i < rows.length; i++) {
      predictions[i] += opts.learningRate * predictTree(tree, rows[i].features);
    }
  }

  return { trees, initialValue, learningRate: opts.learningRate };
}

export function predictGbm(model: GbmModel, features: number[]): number {
  return model.trees.reduce(
    (acc, tree) => acc + model.learningRate * predictTree(tree, features),
    model.initialValue
  );
}
