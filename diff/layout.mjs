// Structural layout diff: align by `path`, compute rect deltas + style deltas.
import { readFile, writeFile } from "node:fs/promises";

// Two style values are equal if their strings match exactly, OR they're both a
// single number (with the same optional px/% unit) within `styleEpsilon`. This
// keeps sub-pixel fractional widths (e.g. "172.667px" vs "172.656px") from
// flagging as mismatches — those are pixel-identical once rounded, and rect
// deltas already carry their own ε. Colors, keywords, and multi-token values
// fall back to exact string compare.
function styleValuesEqual(a, b, styleEpsilon) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const num = /^(-?\d*\.?\d+)(px|%)?$/;
  const ma = num.exec(a.trim());
  const mb = num.exec(b.trim());
  if (ma && mb && (ma[2] || "") === (mb[2] || "")) {
    return Math.abs(parseFloat(ma[1]) - parseFloat(mb[1])) <= styleEpsilon;
  }
  return false;
}

export async function diffLayout({ broJson, chromiumJson, outPath, geomEpsilon = 1, styleEpsilon = 0.5 }) {
  const [a, b] = await Promise.all([
    readFile(broJson, "utf8").then(JSON.parse),
    readFile(chromiumJson, "utf8").then(JSON.parse)
  ]);
  const byPathA = new Map(a.elements.map(e => [e.path, e]));
  const byPathB = new Map(b.elements.map(e => [e.path, e]));
  const allPaths = new Set([...byPathA.keys(), ...byPathB.keys()]);

  const entries = [];
  let totalRectMismatches = 0;
  let totalStyleMismatches = 0;

  for (const path of allPaths) {
    const ea = byPathA.get(path);
    const eb = byPathB.get(path);
    if (!ea) { entries.push({ path, status: "missing-in-bro", chromium: eb }); continue; }
    if (!eb) { entries.push({ path, status: "missing-in-chromium", bro: ea }); continue; }
    const dx = ea.rect.x - eb.rect.x;
    const dy = ea.rect.y - eb.rect.y;
    const dw = ea.rect.w - eb.rect.w;
    const dh = ea.rect.h - eb.rect.h;
    const rectOff = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) > geomEpsilon;
    const styleDeltas = {};
    for (const k of Object.keys(ea.style)) {
      if (!styleValuesEqual(ea.style[k], eb.style[k], styleEpsilon)) {
        styleDeltas[k] = [ea.style[k], eb.style[k]];
      }
    }
    const styleOff = Object.keys(styleDeltas).length > 0;
    if (rectOff) totalRectMismatches++;
    if (styleOff) totalStyleMismatches++;
    entries.push({
      path,
      tag: ea.tag,
      id: ea.id,
      rectDelta: { dx, dy, dw, dh },
      rectMismatch: rectOff,
      bro: { rect: ea.rect },
      chromium: { rect: eb.rect },
      styleDeltas,
      styleMismatch: styleOff
    });
  }

  const summary = {
    totalElements: entries.length,
    rectMismatches: totalRectMismatches,
    styleMismatches: totalStyleMismatches,
    geomEpsilon,
    styleEpsilon
  };
  const out = { summary, entries };
  await writeFile(outPath, JSON.stringify(out, null, 2));
  return summary;
}
