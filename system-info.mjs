// Capture host system info that affects rendering: OS, CPU, GPU.
// Best-effort and cross-platform — every field may be null if detection fails.

import os from "node:os";
import { execSync } from "node:child_process";

function tryExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, ...opts }).trim();
  } catch {
    return null;
  }
}

function detectGpus() {
  const platform = os.platform();
  if (platform === "win32") {
    // PowerShell returns one GPU name per line.
    const out = tryExec(`powershell.exe -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"`);
    if (!out) return [];
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  if (platform === "darwin") {
    const out = tryExec(`system_profiler SPDisplaysDataType -json`);
    if (!out) return [];
    try {
      const j = JSON.parse(out);
      const arr = j?.SPDisplaysDataType ?? [];
      return arr.map(g => g?.sppci_model || g?._name).filter(Boolean);
    } catch { return []; }
  }
  if (platform === "linux") {
    const out = tryExec(`bash -lc "lspci -mm | grep -Ei 'vga|3d|display'"`);
    if (!out) return [];
    return out.split(/\r?\n/).map(line => {
      // lspci -mm: 00:02.0 "VGA compatible controller" "Vendor" "Device" ...
      const parts = line.match(/"([^"]*)"/g);
      if (!parts || parts.length < 4) return line.trim();
      const vendor = parts[1].replaceAll('"', "");
      const device = parts[2].replaceAll('"', "");
      return `${vendor} ${device}`.trim();
    }).filter(Boolean);
  }
  return [];
}

function osLabel() {
  const platform = os.platform();
  // os.version() exists on Node 13+ and gives a useful string per platform.
  let version = "";
  try { version = os.version(); } catch {}
  if (platform === "win32") {
    // os.version() on Windows returns e.g. "Windows 11 Pro" — good enough.
    return version || `Windows ${os.release()}`;
  }
  if (platform === "darwin") {
    const productVersion = tryExec("sw_vers -productVersion");
    const productName = tryExec("sw_vers -productName") || "macOS";
    return productVersion ? `${productName} ${productVersion}` : (version || productName);
  }
  if (platform === "linux") {
    const pretty = tryExec(`bash -lc 'source /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"'`);
    return pretty || version || `Linux ${os.release()}`;
  }
  return version || `${platform} ${os.release()}`;
}

// "windows" / "macos" / "linux" — used as the published subdirectory.
export function platformSlug() {
  const p = os.platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  if (p === "linux") return "linux";
  return p;
}

export function collectSystemInfo() {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || null;
  return {
    platform: os.platform(),
    platformSlug: platformSlug(),
    os: osLabel(),
    arch: os.arch(),
    cpu: cpuModel,
    cpuCount: cpus.length,
    gpus: detectGpus(),
    nodeVersion: process.version,
    detectedAt: new Date().toISOString()
  };
}

// Short human-readable label, e.g. "Windows 11 Pro · NVIDIA GeForce RTX 3090 · Intel Core i9-12900K".
export function formatSystemLabel(info) {
  const parts = [];
  if (info.os) parts.push(info.os);
  if (info.gpus?.length) parts.push(info.gpus[0]);
  if (info.cpu) parts.push(info.cpu);
  return parts.join(" · ");
}
