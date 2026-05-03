// Structural layout diff: align by `path`, compute rect deltas + style deltas.
import { readFile, writeFile } from "node:fs/promises";

export async function diffLayout({ broJson, chromiumJson, outPath, geomEpsilon = 1 }) {
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
      if (ea.style[k] !== eb.style[k]) {
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
    geomEpsilon
  };
  const out = { summary, entries };
  await writeFile(outPath, JSON.stringify(out, null, 2));
  return summary;
}
