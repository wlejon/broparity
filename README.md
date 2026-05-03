# broparity

Side-by-side parity comparison for the bro engine vs Chromium. Each case is a small,
UA-neutral HTML page. Both engines render it; we compare pixels and a structural
layout dump.

## Run

```
npm install
npx playwright install chromium
node run.mjs --filter boxmodel
```

`run.mjs` flags:

- `--filter <substr>` — limit to cases whose `category/case` contains the substring
- `--width <n>` `--height <n>` — viewport (default 800x600)

Output lands in `out/<run-id>/`. Open `out/<run-id>/index.html` for the report.

## Layout

```
cases/<category>/<case>/index.html       # the test page (no JS, no UA sniffing)
cases/<category>/<case>/bro.json         # bro app manifest
drivers/bro.mjs                          # bro-headless driver
drivers/chromium.mjs                     # Playwright Chromium driver
diff/pixels.mjs                          # pixelmatch wrapper -> diff.png + ratio
diff/layout.mjs                          # path-aligned rect + style diff
report/render.mjs                        # HTML report
run.mjs                                  # orchestrator
_runner.js                               # script that runs INSIDE bro-headless
```

## Layout dump schema

Both drivers emit JSON of this shape:

```jsonc
{
  "engine": "bro" | "chromium",
  "viewport": { "w": 800, "h": 600 },
  "elements": [
    {
      "path": "body>div:nth-of-type(1)",   // depth-first, stable cross-engine
      "tag":  "div",
      "id":   "box",
      "classes": ["foo"],
      "rect": { "x": 30, "y": 30, "w": 248, "h": 56 },
      "style": {
        "display": "block",
        "position": "static",
        "width": "240px",
        "height": "...",
        "margin-top": "30px", "margin-right": "30px", "margin-bottom": "30px", "margin-left": "30px",
        "padding-top": "20px", "padding-right": "20px", "padding-bottom": "20px", "padding-left": "20px",
        "border-top-width": "4px", "border-right-width": "4px", "border-bottom-width": "4px", "border-left-width": "4px",
        "font-size": "16px", "line-height": "...",
        "color": "rgb(32,32,32)", "background-color": "rgb(255,224,224)",
        "box-sizing": "content-box"
      }
    }
  ]
}
```

Curated style props (kept tight on purpose): `display`, `position`, `width`, `height`,
`margin-{top,right,bottom,left}`, `padding-{top,right,bottom,left}`,
`border-{top,right,bottom,left}-width`, `font-size`, `line-height`, `color`,
`background-color`, `box-sizing`. Colors normalize to `rgb(r,g,b)`/`rgba(r,g,b,a)`;
numeric values normalize to 3 decimal places.

## Diff semantics

- **Pixels**: `pixelmatch` with threshold 0.1. Output is `diff.png` + `mismatchRatio = mismatched / totalPixels`.
- **Layout**: align elements by `path`. For each, compute `rectDelta` and a
  per-property `styleDeltas` map. Default geometric tolerance ε=1px (so subpixel
  font hinting differences don't dominate). Style values are exact-match after
  normalization.

## Categories

| Category | Cases | What it covers |
|---|---:|---|
| `boxmodel/` | 3 | basic block, margin collapse, content-box vs border-box |
| `text/` | 8 | font shorthand, font-size cascade, line-height (px and unitless), inline formatting, whitespace (normal/pre), soft wrap |
| `flex/` | 12 | row/column, grow/shrink/basis, justify/align (items, self), wrap, gap, nested, min-content shrink |
| `position/` | 12 | relative offset, absolute (with/without ancestor, percent, tlbr, inset shorthand), fixed, sticky, z-index, stacking contexts (opacity/transform), negative z-index |
| `tables/` | 9 | basic, colspan, rowspan, border-collapse vs separate, table-layout auto/fixed, caption, thead/tfoot |
| `display-types/` | 12 | inline-block (basic / baseline / vertical-align-top / vs inline), `<img>` (intrinsic / explicit / css / aspect-ratio), `<button>` / `<input>` defaults, display:none, visibility:hidden |

Total: 56 cases across 6 categories.

## Scoring

Each case gets two scores in `[0..1]`:

- **Layout-conformance**:
  `layoutScore = 0.5·rectFrac + 0.4·styleFrac + 0.1·paintOk`
  where `rectFrac = 1 − rectMismatches / totalElements`,
  `styleFrac = 1 − styleMismatches / totalElements`, and `paintOk` is 1 unless
  the case is manually flagged as a paint-order failure (drop a sibling file
  `paint-order.fail` next to `index.html` to set `paintOk = 0` — there's no
  automated detector for stacking/compositing yet).
  Geometry dominates because most app bugs surface as mis-positioned boxes;
  style equality is a second-order check; paint-order keeps a small but real
  weight so stacking bugs don't disappear from the score.
- **Pixel-similarity**: `pixelScore = 1 − mismatchRatio`.

Per-category aggregate is the arithmetic mean across cases (errored cases
score 0). Overall is the mean across **categories** (equal weight, so a
3-case category isn't drowned by a 12-case one). See [`scoring.mjs`](scoring.mjs).

After every full run, `out/<run>/summary.html` shows headline numbers,
per-category breakdown, and the curated top-issues list. Per-category
`out/<run>/<category>/index.html` files give the case-by-case view, and
`out/<run>/index.html` is the legacy all-cases report.

## Known bro divergences

Snapshot of the worst offenders, grouped by category. Updated alongside the
curated list in `report/summary.mjs`; see `summary.html` for the impact-sorted
view.

- **tables/** (category layout score ≈ 0.10)
  - Cell geometry diverges across every case — cell widths, row heights,
    caption placement, thead/tfoot ordering all drift.
  - Caption and thead-tfoot cases are the worst (5%+ pixel mismatch).
- **display-types/** (≈ 0.45)
  - `<img>` intrinsic / aspect-ratio sizing wrong when only one CSS dimension
    is set (img-intrinsic-size, img-aspect-ratio, img-explicit-size).
  - inline-block baseline + vertical-align off by a few px; knocks on to
    `<button>` / `<input>` default sizing.
- **text/** (≈ 0.37)
  - Line-box y and font-size cascade drift in nested contexts
    (line-height-px, line-height-unitless, font-size-cascade, inline-formatting).
- **position/** (≈ 0.98)
  - `negative-zindex`: pure paint-order bug — z-index:-1 child paints above its
    containing block (4.08% pixel mismatch, layout rects match).
  - `sticky-basic`: computed style for `position: sticky` differs even when
    geometry matches.
- **flex/** (≈ 0.89)
  - `min-content-shrink`: min-content intrinsic width and negative-free-space
    distribution disagree with Chromium (only flex case with substantial drift).
- **boxmodel/** (≈ 0.57)
  - `box-sizing-border-box`: small consistent rect delta on border-box widths.

## Possible bro engine additions (deferred)

- A native `dumpLayout()` headless global so we don't have to ship a runner script
  per case. Foundation works fine without it; `_runner.js` runs inside bro-headless
  and writes via brokit `fs`.

## Notes / known caveats

- `bro-headless` requires a GPU by default; we use the default (GPU) mode.
- The bro driver materializes a per-case `_runner.local.js` next to the output so
  the output paths are baked in (bro-headless has no `process.env`).
- bro screenshots may be rendered at a different size than the requested viewport
  if the engine reserves space (e.g. menu bar inset). Mismatched sizes are clipped
  to the common region for pixel diffing and flagged in the report.
