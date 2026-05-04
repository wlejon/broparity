// Runs inside bro-headless. Walks the DOM, emits layout JSON to BROPARITY_OUT_JSON,
// then screenshots to BROPARITY_OUT_PNG. Output paths come from env (we inline them
// per-invocation via -e since bro-headless does not expose process.env directly).
//
// Configuration: the orchestrator overwrites this file's /Users/j/projects/broparity/out/2026-05-04T07-31-48-610Z/game-ui/hud-overlay/bro.layout.json / /Users/j/projects/broparity/out/2026-05-04T07-31-48-610Z/game-ui/hud-overlay/bro.png
// placeholders before each run, OR passes a tiny bootstrap via -e. We use the
// placeholder approach for simplicity.

const OUT_JSON = "/Users/j/projects/broparity/out/2026-05-04T07-31-48-610Z/game-ui/hud-overlay/bro.layout.json";
const OUT_PNG = "/Users/j/projects/broparity/out/2026-05-04T07-31-48-610Z/game-ui/hud-overlay/bro.png";

const STYLE_PROPS = [
  "display", "position",
  "width", "height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "font-size", "line-height",
  "color", "background-color",
  "box-sizing"
];

function pathFor(el) {
  // body>div:nth-of-type(2)>span:nth-of-type(1)
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "html") {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body") { parts.unshift("body"); break; }
    let idx = 1;
    let sib = cur;
    while (sib.previousElementSibling) {
      sib = sib.previousElementSibling;
      if (sib.tagName && sib.tagName.toLowerCase() === tag) idx++;
    }
    parts.unshift(tag + ":nth-of-type(" + idx + ")");
    cur = cur.parentElement;
  }
  return parts.join(">");
}

function normalizeColor(s) {
  if (!s) return s;
  // Both engines may emit rgb()/rgba() with different spacing; normalize to "r,g,b[,a]".
  const m = String(s).match(/rgba?\s*\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.]+))?\s*\)/);
  if (m) {
    const r = Math.round(parseFloat(m[1]));
    const g = Math.round(parseFloat(m[2]));
    const b = Math.round(parseFloat(m[3]));
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  }
  return String(s).trim();
}

// Properties whose computed style is always an absolute length, so a unitless
// number from one engine should be treated as `px`. line-height is intentionally
// omitted: Chromium resolves it to absolute px, but a unitless value (e.g. 1.4)
// is a multiplier — keeping the raw shape exposes that real divergence.
const LENGTH_PROPS = new Set([
  "width","height","font-size",
  "margin-top","margin-right","margin-bottom","margin-left",
  "padding-top","padding-right","padding-bottom","padding-left",
  "border-top-width","border-right-width","border-bottom-width","border-left-width"
]);

function normalizeNumber(s, prop) {
  if (s === undefined || s === null) return s;
  const str = String(s).trim();
  const m = str.match(/^(-?\d+(?:\.\d+)?)(px|em|%)?$/);
  if (m) {
    const n = parseFloat(m[1]);
    let unit = m[2] || "";
    if (!unit && LENGTH_PROPS.has(prop)) unit = "px";
    return (Math.round(n * 1000) / 1000) + unit;
  }
  return str;
}

function getStyleSafe(el, prop) {
  // bro headless: computedStyle(selector, prop) is a global; also window.getComputedStyle works.
  try {
    const cs = window.getComputedStyle(el);
    return cs.getPropertyValue(prop);
  } catch (e) {
    return "";
  }
}

function dumpElement(el) {
  const r = el.getBoundingClientRect();
  const style = {};
  for (const p of STYLE_PROPS) {
    let v = getStyleSafe(el, p);
    if (p === "color" || p === "background-color") v = normalizeColor(v);
    else v = normalizeNumber(v, p);
    style[p] = v;
  }
  return {
    path: pathFor(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    classes: el.className ? String(el.className).split(/\s+/).filter(Boolean) : [],
    rect: {
      x: Math.round(r.left * 1000) / 1000,
      y: Math.round(r.top * 1000) / 1000,
      w: Math.round(r.width * 1000) / 1000,
      h: Math.round(r.height * 1000) / 1000
    },
    style
  };
}

function walk(el, out) {
  if (!el || el.nodeType !== 1) return;
  const tag = el.tagName.toLowerCase();
  if (tag !== "html" && tag !== "head" && !["script", "style", "meta", "link", "title"].includes(tag)) {
    out.push(dumpElement(el));
  }
  let c = el.firstElementChild;
  while (c) { walk(c, out); c = c.nextElementSibling; }
}

advanceTime(100);
flush();
advanceTime(100);

const elements = [];
walk(document.body, elements);

const dump = {
  engine: "bro",
  viewport: { w: window.innerWidth, h: window.innerHeight },
  elements
};

const fs = require("fs");
fs.writeFileSync(OUT_JSON, JSON.stringify(dump, null, 2));
screenshot(OUT_PNG);
