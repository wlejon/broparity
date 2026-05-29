// Orchestrator. Discovers cases under cases/<category>/<case>/index.html,
// runs both drivers, computes diffs, renders an HTML report.
import { readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBro } from "./drivers/bro.mjs";
import { runChromium } from "./drivers/chromium.mjs";
import { diffPixels } from "./diff/pixels.mjs";
import { diffLayout } from "./diff/layout.mjs";
import { cropToContent } from "./diff/crop.mjs";
import { renderReport, renderPerCategoryReports } from "./report/render.mjs";
import { aggregate, detectPaintOrderFlag } from "./scoring.mjs";
import { collectSystemInfo } from "./system-info.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const CASES_DIR = resolve(ROOT, "cases");

function parseArgs(argv) {
  const out = { filter: "", width: 800, height: 600, geomEpsilon: 1, styleEpsilon: 0.5 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--filter") out.filter = argv[++i];
    else if (a === "--width") out.width = parseInt(argv[++i], 10);
    else if (a === "--height") out.height = parseInt(argv[++i], 10);
    else if (a === "--geom-epsilon") out.geomEpsilon = parseFloat(argv[++i]);
    else if (a === "--style-epsilon") out.styleEpsilon = parseFloat(argv[++i]);
  }
  return out;
}

async function discoverCases() {
  const cats = await readdir(CASES_DIR);
  const cases = [];
  for (const cat of cats) {
    const catDir = resolve(CASES_DIR, cat);
    const s = await stat(catDir);
    if (!s.isDirectory()) continue;
    for (const name of await readdir(catDir)) {
      const caseDir = resolve(catDir, name);
      const cs = await stat(caseDir);
      if (!cs.isDirectory()) continue;
      try {
        await stat(resolve(caseDir, "index.html"));
      } catch { continue; }
      cases.push({ category: cat, case: name, dir: caseDir });
    }
  }
  return cases;
}

async function main() {
  const args = parseArgs(process.argv);
  const all = await discoverCases();
  const filtered = args.filter
    ? all.filter(c => `${c.category}/${c.case}`.includes(args.filter))
    : all;

  if (filtered.length === 0) {
    console.error("no matching cases");
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(ROOT, "out", runId);
  await mkdir(runDir, { recursive: true });

  console.log(`run: ${runId}  cases: ${filtered.length}  viewport: ${args.width}x${args.height}`);

  const results = [];
  for (const c of filtered) {
    const outDir = resolve(runDir, c.category, c.case);
    await mkdir(outDir, { recursive: true });
    const label = `${c.category}/${c.case}`;
    process.stdout.write(`  ${label} ... `);
    try {
      const broRes = await runBro({ caseDir: c.dir, outDir, width: args.width, height: args.height });
      const chRes = await runChromium({ caseDir: c.dir, outDir, width: args.width, height: args.height });
      await cropToContent({
        broLayoutJson: broRes.layoutJson,
        chromiumLayoutJson: chRes.layoutJson,
        broPng: broRes.screenshot,
        chromiumPng: chRes.screenshot
      });
      const diffPng = resolve(outDir, "diff.png");
      const layoutDiff = resolve(outDir, "layout.diff.json");
      const pixels = await diffPixels({ aPath: broRes.screenshot, bPath: chRes.screenshot, outPath: diffPng });
      const layout = await diffLayout({ broJson: broRes.layoutJson, chromiumJson: chRes.layoutJson, outPath: layoutDiff, geomEpsilon: args.geomEpsilon, styleEpsilon: args.styleEpsilon });
      const paintOk = await detectPaintOrderFlag(c.dir);
      results.push({
        category: c.category,
        case: c.case,
        broPng: broRes.screenshot,
        chromiumPng: chRes.screenshot,
        diffPng,
        pixels,
        layout,
        paintOk
      });
      console.log(`ok  pixels=${(pixels.mismatchRatio*100).toFixed(2)}%  rectΔ=${layout.rectMismatches}  styleΔ=${layout.styleMismatches}`);
    } catch (e) {
      results.push({ category: c.category, case: c.case, error: e.message });
      console.log(`FAIL  ${e.message.split("\n")[0]}`);
    }
  }

  const scoring = aggregate(results);
  const system = collectSystemInfo();
  const summary = {
    runId,
    timestamp: new Date().toISOString(),
    viewport: { w: args.width, h: args.height },
    system,
    overall: scoring.overall,
    categories: scoring.categories.map(c => ({
      name: c.name, n: c.n, layoutScore: c.layoutScore, pixelScore: c.pixelScore, errors: c.errors
    }))
  };
  await writeFile(resolve(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

  const reportPath = await renderReport({ runDir, results, summary });
  await renderPerCategoryReports({ runDir, results });

  console.log(`\nreport:  ${reportPath}`);
  console.log(`overall layout: ${scoring.overall.layoutScore.toFixed(3)}  pixel: ${scoring.overall.pixelScore.toFixed(3)}`);
  for (const c of scoring.categories) {
    console.log(`  ${c.name.padEnd(16)} n=${String(c.n).padEnd(3)} L=${c.layoutScore.toFixed(3)}  P=${c.pixelScore.toFixed(3)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
