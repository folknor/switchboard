#!/usr/bin/env node
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// Install native dependencies for Electron
try {
  execSync("npx electron-builder install-app-deps", { stdio: "inherit" });
} catch (err) {
  console.error("electron-builder install-app-deps failed:", err.message);
}

// macOS/Linux: ad-hoc codesign native modules & fix node-pty permissions
if (process.platform !== "win32") {
  // Ad-hoc codesign all .node files so macOS doesn't block them
  try {
    const nodeModules = path.join(__dirname, "..", "node_modules");
    findFiles(nodeModules, ".node").forEach((file) => {
      try {
        execSync(`codesign --sign - --force "${file}"`, { stdio: "ignore" });
      } catch {}
    });
  } catch {}

  // Ensure node-pty spawn-helper is executable
  const spawnHelperGlob = path.join(
    __dirname,
    "..",
    "node_modules",
    "node-pty",
    "prebuilds",
  );
  if (fs.existsSync(spawnHelperGlob)) {
    try {
      findFiles(spawnHelperGlob, "spawn-helper").forEach((file) => {
        fs.chmodSync(file, 0o755);
      });
    } catch {}
  }
}

function findFiles(dir, suffix) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(full, suffix));
      } else if (entry.name.endsWith(suffix)) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}
