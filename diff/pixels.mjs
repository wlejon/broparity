// Pixel diff using pixelmatch.
import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export async function diffPixels({ aPath, bPath, outPath, threshold = 0.1 }) {
  const [aBuf, bBuf] = await Promise.all([readFile(aPath), readFile(bPath)]);
  const aPng = PNG.sync.read(aBuf);
  const bPng = PNG.sync.read(bBuf);
  const w = Math.min(aPng.width, bPng.width);
  const h = Math.min(aPng.height, bPng.height);
  // If sizes mismatch, crop both to common size by copying into fresh buffers.
  function crop(src, w, h) {
    if (src.width === w && src.height === h) return src;
    const out = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (src.width * y + x) << 2;
        const di = (w * y + x) << 2;
        out.data[di] = src.data[si];
        out.data[di+1] = src.data[si+1];
        out.data[di+2] = src.data[si+2];
        out.data[di+3] = src.data[si+3];
      }
    }
    return out;
  }
  const aN = crop(aPng, w, h);
  const bN = crop(bPng, w, h);
  const diff = new PNG({ width: w, height: h });
  const mismatched = pixelmatch(aN.data, bN.data, diff.data, w, h, { threshold });
  await writeFile(outPath, PNG.sync.write(diff));
  const total = w * h;
  return {
    width: w,
    height: h,
    matchedPixels: total - mismatched,
    totalPixels: total,
    mismatchedPixels: mismatched,
    mismatchRatio: mismatched / total,
    sizeMismatch: !(aPng.width === bPng.width && aPng.height === bPng.height),
    aSize: { w: aPng.width, h: aPng.height },
    bSize: { w: bPng.width, h: bPng.height }
  };
}
