/**
 * Write Windows-cmd-safe start scripts (ASCII, CRLF, no BOM)
 * Usage: node scripts/write-portable-bats.mjs [distDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const distDir = path.resolve(
  process.argv[2] || path.join(ROOT, "dist", "ecommerce-toolkit")
);

const batLines = [
  "@echo off",
  "setlocal",
  "title Ecommerce Automation Toolkit",
  'cd /d "%~dp0"',
  "",
  "set PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers",
  "set OPEN_BROWSER=1",
  "",
  "echo [1/2] Checking Chromium...",
  '".\\node.exe" -e "import(\'playwright\').then(({chromium})=>chromium.launch({headless:true}).then(b=>b.close()).then(()=>process.exit(0))).catch(()=>process.exit(1))" 2>nul',
  "if errorlevel 1 (",
  "  echo [install] Downloading Chromium. This may take 1-2 minutes...",
  '  ".\\node.exe" ".\\app\\node_modules\\playwright-core\\cli.js" install chromium',
  "  if errorlevel 1 (",
  "    echo [error] Chromium install failed. Check internet and try again.",
  "    pause",
  "    exit /b 1",
  "  )",
  "  echo [ok] Chromium installed.",
  ")",
  "",
  "echo [2/2] Starting server...",
  "echo Browser opens when ready. Default port 5151; if busy uses next free port.",
  "echo Close this window or press Ctrl+C to stop.",
  "echo.",
  "",
  '".\\node.exe" ".\\app\\scripts\\dev-server.mjs"',
  "if errorlevel 1 (",
  "  echo [error] Server failed to start. See messages above.",
  "  pause",
  "  exit /b 1",
  ")",
  "pause",
  "",
];

export function writePortableBats(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const content = batLines.join("\r\n");
  const buf = Buffer.from(content, "utf8");
  if (buf[0] === 0xef && buf[1] === 0xbb) {
    throw new Error("BOM must not be written");
  }
  for (const name of ["run.bat", "RUNME.bat", "\uC2E4\uD589.bat"]) {
    fs.writeFileSync(path.join(dir, name), buf);
  }
  return buf.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = writePortableBats(distDir);
  console.log(`Wrote run.bat / RUNME.bat / 실행.bat (${n} bytes) → ${distDir}`);
}
