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

- `boxmodel/` — basic block, vertical margin collapsing, content-box vs border-box.

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
