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

Per-category `out/<run>/<category>/index.html` files give the case-by-case
view, and `out/<run>/index.html` is the all-cases report.

## Publishing the report

The site is published to GitHub Pages on the `gh-pages` branch and served at
`https://wlejon.github.io/broparity/`. The bro project's site links here for
parity status.

```
node publish.mjs                                # publish most recent out/<run>/, auto-detect platform
node publish.mjs --platform windows             # force platform slug
node publish.mjs --platform macos out/<run>/    # publish a specific run as macos
node publish.mjs --dry-run                      # build the worktree but don't commit/push
node publish.mjs --no-push                      # commit locally, skip push
```

Each platform (`windows`, `macos`, `linux`) is tracked separately because
fonts, GPU drivers, and OS text shaping all influence the rendered output. The
published site looks like:

```
/index.html       landing — one card per platform with headline numbers
/manifest.json    what's published per platform (machine-readable)
/windows/         full per-platform report (index.html + tables/...)
/macos/           added when you publish from a Mac
/linux/           added when you publish from Linux
```

The landing page is regenerated from `manifest.json` on every publish, so each
publish only updates one platform's subtree plus the landing summary. The
`gh-pages` branch is created as an orphan on first publish if it doesn't
already exist.

Each run writes a `summary.json` next to its `index.html` containing the
overall scores plus the host system info (OS, CPU, GPU). That file is what the
publisher reads to populate the landing page.

## Notes / known caveats

- `bro-headless` requires a GPU by default; we use the default (GPU) mode.
- The bro driver materializes a per-case `_runner.local.js` next to the output so
  the output paths are baked in (bro-headless has no `process.env`).
