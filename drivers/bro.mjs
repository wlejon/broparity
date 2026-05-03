// Driver: runs bro-headless against a case directory and captures
// layout JSON + screenshot.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BRO_HEADLESS = resolve("D:/projects/bro/build/Release/bro-headless.exe");
const RUNNER_TEMPLATE = resolve(ROOT, "_runner.js");

export async function runBro({ caseDir, outDir, width, height }) {
  await mkdir(outDir, { recursive: true });
  const outJson = resolve(outDir, "bro.layout.json");
  const outPng = resolve(outDir, "bro.png");

  // Materialize a per-case runner with substituted output paths.
  const tmpl = await readFile(RUNNER_TEMPLATE, "utf8");
  const runnerSrc = tmpl
    .replaceAll("__OUT_JSON__", outJson.replaceAll("\\", "/"))
    .replaceAll("__OUT_PNG__", outPng.replaceAll("\\", "/"));
  const runnerPath = resolve(outDir, "_runner.local.js");
  await writeFile(runnerPath, runnerSrc, "utf8");

  const args = [
    "--width", String(width),
    "--height", String(height),
    caseDir,
    runnerPath
  ];

  const result = await new Promise((resolveP) => {
    const child = spawn(BRO_HEADLESS, args, { cwd: outDir, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolveP({ code, stdout, stderr }));
  });

  if (result.code !== 0) {
    const tail = result.stderr.split(/\r?\n/).slice(-20).join("\n");
    throw new Error(`bro-headless exited ${result.code}\n${tail}`);
  }

  return { layoutJson: outJson, screenshot: outPng, stderr: result.stderr };
}
