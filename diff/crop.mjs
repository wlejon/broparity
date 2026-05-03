// Crop screenshots to the content rect — the bbox of all elements across
// both engines' layout JSON. Without this, pixel-mismatch% is dominated by
// the giant white area outside the actual content.
import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const PADDING = 4;

function unionRect(layouts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layout of layouts) {
    for (const el of layout.elements || []) {
      const r = el.rect;
      if (!r || r.w <= 0 || r.h <= 0) continue;
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      if (r.x + r.w > x1) x1 = r.x + r.w;
      if (r.y + r.h > y1) y1 = r.y + r.h;
    }
  }
  if (!isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clampRect(r, imgW, imgH) {
  let x = Math.max(0, Math.floor(r.x - PADDING));
  let y = Math.max(0, Math.floor(r.y - PADDING));
  let x1 = Math.min(imgW, Math.ceil(r.x + r.w + PADDING));
  let y1 = Math.min(imgH, Math.ceil(r.y + r.h + PADDING));
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) };
}

function cropPng(src, rect) {
  const dst = new PNG({ width: rect.w, height: rect.h });
  for (let y = 0; y < rect.h; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= src.height) continue;
    const srcRow = (src.width * sy + rect.x) << 2;
    const dstRow = (rect.w * y) << 2;
    src.data.copy(dst.data, dstRow, srcRow, srcRow + (rect.w << 2));
  }
  return dst;
}

export async function cropToContent({ broLayoutJson, chromiumLayoutJson, broPng, chromiumPng }) {
  const [broLayout, chLayout] = await Promise.all([
    readFile(broLayoutJson, "utf8").then(JSON.parse),
    readFile(chromiumLayoutJson, "utf8").then(JSON.parse)
  ]);
  const rect = unionRect([broLayout, chLayout]);
  if (!rect) return { skipped: true, reason: "no content rect" };

  const [broBuf, chBuf] = await Promise.all([readFile(broPng), readFile(chromiumPng)]);
  const broImg = PNG.sync.read(broBuf);
  const chImg = PNG.sync.read(chBuf);

  const broRect = clampRect(rect, broImg.width, broImg.height);
  const chRect = clampRect(rect, chImg.width, chImg.height);

  await Promise.all([
    writeFile(broPng, PNG.sync.write(cropPng(broImg, broRect))),
    writeFile(chromiumPng, PNG.sync.write(cropPng(chImg, chRect)))
  ]);

  return { rect, broRect, chRect };
}
