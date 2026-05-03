// Conformance scoring for broparity.
//
// Per-case layout-conformance score in [0..1]:
//   layoutScore = wRect * rectFrac
//               + wStyle * styleFrac
//               + wPaint * paintOk
// where:
//   rectFrac  = 1 - rectMismatches / totalElements
//   styleFrac = 1 - styleMismatches / totalElements
//   paintOk   = 1 unless the case is manually flagged as having a paint-order failure
//               (see "paint-order failures" below)
//
// Default weights: { wRect: 0.5, wStyle: 0.4, wPaint: 0.1 }.
// Layout geometry dominates because most app bugs surface as mis-positioned boxes;
// style-prop equality is a second-order check (same display/box-sizing/colors etc.);
// paint-order is a binary correctness signal but only a few cases exercise it, so it
// gets a small but real weight to keep it visible.
//
// Per-case pixel-similarity score in [0..1]:
//   pixelScore = 1 - mismatchRatio
//
// Per-category aggregate = arithmetic mean across cases (errored cases score 0).
// Overall score = arithmetic mean across categories (categories weighted equally
// so a 3-case category isn't drowned by a 12-case one).
//
// Paint-order failures: stacking/compositing bugs that pixel diffs catch but layout
// dumps don't (e.g. wrong z-index ordering, missing stacking context on opacity).
// There is no automated detector yet — flag a case manually by adding a sibling file
// `cases/<category>/<case>/paint-order.fail` (any contents) to set paintOk=0.
// `scoreCase` accepts a `paintOk` override for callers that detect this another way.

import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export const DEFAULT_WEIGHTS = Object.freeze({ wRect: 0.5, wStyle: 0.4, wPaint: 0.1 });

export async function detectPaintOrderFlag(caseDir) {
  try {
    await stat(resolve(caseDir, "paint-order.fail"));
    return 0;
  } catch {
    return 1;
  }
}

export function scoreCase(result, weights = DEFAULT_WEIGHTS) {
  if (result.error || !result.layout || !result.pixels) {
    return {
      layoutScore: 0,
      pixelScore: 0,
      rectFrac: 0,
      styleFrac: 0,
      paintOk: 0,
      ok: false
    };
  }
  const total = Math.max(1, result.layout.totalElements);
  const rectFrac = 1 - (result.layout.rectMismatches / total);
  const styleFrac = 1 - (result.layout.styleMismatches / total);
  const paintOk = result.paintOk ?? 1;
  const { wRect, wStyle, wPaint } = weights;
  const layoutScore = clamp01(wRect * rectFrac + wStyle * styleFrac + wPaint * paintOk);
  const pixelScore = clamp01(1 - (result.pixels.mismatchRatio ?? 0));
  return { layoutScore, pixelScore, rectFrac, styleFrac, paintOk, ok: true };
}

export function aggregate(results, weights = DEFAULT_WEIGHTS) {
  // Score each case
  const scored = results.map(r => ({ ...r, score: scoreCase(r, weights) }));

  // Per-category aggregation
  const cats = {};
  for (const r of scored) {
    cats[r.category] ||= { name: r.category, cases: [], layoutSum: 0, pixelSum: 0, errors: 0 };
    cats[r.category].cases.push(r);
    cats[r.category].layoutSum += r.score.layoutScore;
    cats[r.category].pixelSum += r.score.pixelScore;
    if (r.error) cats[r.category].errors++;
  }
  const catList = Object.values(cats).map(c => {
    const n = c.cases.length;
    // Worst case = lowest layoutScore (tie-break: lowest pixelScore)
    const worst = c.cases.slice().sort((a, b) => {
      if (a.score.layoutScore !== b.score.layoutScore) return a.score.layoutScore - b.score.layoutScore;
      return a.score.pixelScore - b.score.pixelScore;
    })[0];
    return {
      name: c.name,
      n,
      layoutScore: c.layoutSum / n,
      pixelScore: c.pixelSum / n,
      errors: c.errors,
      worst
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Overall = mean across categories (equal weight)
  const overallLayout = catList.length
    ? catList.reduce((s, c) => s + c.layoutScore, 0) / catList.length
    : 0;
  const overallPixel = catList.length
    ? catList.reduce((s, c) => s + c.pixelScore, 0) / catList.length
    : 0;

  return {
    weights,
    cases: scored,
    categories: catList,
    overall: {
      layoutScore: overallLayout,
      pixelScore: overallPixel,
      caseCount: scored.length,
      categoryCount: catList.length
    }
  };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }
export function fmtScore(x) { return x.toFixed(3); }
