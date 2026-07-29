/**
 * 포터블 배포 패키지 빌드 스크립트
 * 실행: node scripts/build-portable.mjs
 *
 * 결과: dist/ecommerce-toolkit/ 폴더 (ZIP으로 압축하여 배포)
 *   - node.exe (포터블 Node.js)
 *   - 실행.bat (더블클릭으로 시작)
 *   - app/ (소스 코드 + node_modules)
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist", "ecommerce-toolkit");
const NODE_VERSION = "v22.16.0"; // LTS
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  downloading ${url}`);
    const file = fs.createWriteStream(dest);
    const request = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total) process.stdout.write(`\r  ${Math.round((downloaded / total) * 100)}%`);
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          process.stdout.write("\n");
          resolve();
        });
      }).on("error", reject);
    };
    request(url);
  });
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "dist" || entry.name === "tmp" || entry.name === ".vercel") continue;
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

console.log("\n=== 포터블 배포 패키지 빌드 ===\n");

// Clean
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

// 1. Node.js portable download
const nodeZip = path.join(ROOT, "dist", "node.zip");
if (!fs.existsSync(nodeZip)) {
  console.log("[1/4] Node.js portable 다운로드...");
  await download(NODE_URL, nodeZip);
} else {
  console.log("[1/4] Node.js portable (캐시 사용)");
}

// Extract node.exe from zip
console.log("[2/4] Node.js 압축 해제...");
const extractDir = path.join(ROOT, "dist", "node-extracted");
if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
execSync(`powershell -Command "Expand-Archive -Path '${nodeZip}' -DestinationPath '${extractDir}' -Force"`, { stdio: "inherit" });
const nodeDir = fs.readdirSync(extractDir).find((d) => d.startsWith("node-"));
const nodeExeSrc = path.join(extractDir, nodeDir, "node.exe");
fs.copyFileSync(nodeExeSrc, path.join(DIST, "node.exe"));
// npm도 필요 (Chromium 설치용)
const npmDir = path.join(extractDir, nodeDir, "node_modules", "npm");
if (fs.existsSync(npmDir)) {
  copyDirSync(path.join(extractDir, nodeDir, "node_modules"), path.join(DIST, "node_modules_sys"));
  // npx, npm cmd
  for (const f of ["npm", "npm.cmd", "npx", "npx.cmd", "node_modules"]) {
    const s = path.join(extractDir, nodeDir, f);
    if (fs.existsSync(s)) {
      if (fs.statSync(s).isDirectory()) {
        // already copied
      } else {
        fs.copyFileSync(s, path.join(DIST, f));
      }
    }
  }
}

// 3. App source + production node_modules
console.log("[3/4] 앱 소스 복사 + 프로덕션 의존성...");
const appDir = path.join(DIST, "app");
fs.mkdirSync(appDir, { recursive: true });

const include = [
  "index.html",
  "css",
  "js",
  "api",
  "scripts",
  "package.json",
  "package-lock.json",
  "vercel.json",
];
for (const name of include) {
  const s = path.join(ROOT, name);
  const d = path.join(appDir, name);
  if (!fs.existsSync(s)) continue;
  if (fs.statSync(s).isDirectory()) {
    copyDirSync(s, d);
  } else {
    fs.copyFileSync(s, d);
  }
}

// npm install --omit=dev in app dir
console.log("  npm install --omit=dev ...");
execSync(`"${path.join(DIST, "node.exe")}" "${path.join(extractDir, nodeDir, "node_modules", "npm", "bin", "npm-cli.js")}" install --omit=dev`, {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, PATH: `${DIST};${process.env.PATH}` },
});

// 4. 실행 bat
console.log("[4/4] 실행 파일 생성...");
const batContent = `@echo off
chcp 65001 >nul
title 전자상거래 업무 자동화 툴
cd /d "%~dp0"

REM Chromium 확인 및 설치
echo [준비] Chromium 브라우저를 확인합니다...
set PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers
".\\node.exe" -e "import('playwright').then(({chromium})=>chromium.launch({headless:true}).then(b=>{b.close();process.exit(0)})).catch(()=>process.exit(1))" 2>nul
if %errorlevel% neq 0 (
  echo [설치] Chromium을 다운로드합니다. 약 1~2분 소요...
  ".\\node.exe" ".\\node_modules_sys\\npm\\bin\\npx-cli.js" --yes playwright install chromium
  if %errorlevel% neq 0 (
    echo.
    echo [오류] Chromium 설치에 실패했습니다.
    echo        인터넷 연결을 확인하고 다시 실행해주세요.
    pause
    exit /b 1
  )
  echo [완료] Chromium 설치 완료.
)

echo.
echo ┌──────────────────────────────────────────┐
echo │                                          │
echo │   전자상거래 업무 자동화 툴               │
echo │   E-commerce Automation Toolkit          │
echo │                                          │
echo │   → http://localhost:5151                │
echo │                                          │
echo │   종료: 이 창을 닫거나 Ctrl+C            │
echo │                                          │
echo └──────────────────────────────────────────┘
echo.

start "" "http://localhost:5151"
set PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers
".\\node.exe" ".\\app\\scripts\\dev-server.mjs"
pause
`;
fs.writeFileSync(path.join(DIST, "실행.bat"), batContent, "utf8");

// Cleanup extracted node
fs.rmSync(extractDir, { recursive: true, force: true });

const size = execSync(`powershell -Command "(Get-ChildItem -Recurse '${DIST}' | Measure-Object -Property Length -Sum).Sum / 1MB"`)
  .toString()
  .trim();

console.log(`\n=== 빌드 완료 ===`);
console.log(`경로: dist/ecommerce-toolkit/`);
console.log(`크기: ${Math.round(parseFloat(size))} MB`);
console.log(`\n배포: 이 폴더를 ZIP으로 압축해서 보내주세요.`);
console.log(`실행: '실행.bat'을 더블클릭하면 브라우저가 열립니다.\n`);
