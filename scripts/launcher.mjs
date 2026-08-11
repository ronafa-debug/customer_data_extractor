/**
 * Standalone launcher — 서버 시작 + 브라우저 오픈 + Chromium 확인
 * (포터블은 주로 dev-server.mjs 사용; launcher는 OPEN_BROWSER 기본 on)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PREFERRED_PORT = Number(process.env.PORT || 5151);
const MAX_PORT_TRIES = 20;
const shouldOpenBrowser = process.env.OPEN_BROWSER !== "0";

async function ensureChromium() {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    console.log("[launcher] Chromium OK");
  } catch {
    console.log(
      "[launcher] Chromium이 없습니다. 자동 설치 중... (1회만 소요, 약 1~2분)"
    );
    try {
      const { registry } = await import("playwright-core/lib/server");
      const chromiumDescriptor = registry.findExecutable("chromium");
      if (chromiumDescriptor) {
        await registry.installDeps([chromiumDescriptor]);
        await registry.install([chromiumDescriptor]);
      }
    } catch {
      await new Promise((resolve, reject) => {
        const nodePath = process.execPath;
        const child = spawn(
          nodePath,
          [
            "-e",
            "import('playwright').then(({chromium})=>chromium.launch({headless:true}).then(b=>b.close()).catch(()=>process.exit(1)))",
          ],
          { stdio: "inherit", shell: true }
        );
        child.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error("Chromium install failed"))
        );
        child.on("error", reject);
      }).catch(() => {
        console.error("\n[오류] Chromium을 자동 설치할 수 없습니다.");
        console.error("아래 명령어를 직접 실행해주세요:");
        console.error("  npx playwright install chromium\n");
        process.exit(1);
      });
    }
    console.log("[launcher] Chromium 설치 완료.");
  }
}

await ensureChromium();

const { default: productCapture } = await import("../api/product-capture.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mjs": "text/javascript; charset=utf-8",
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function createVercelRes(res) {
  const headers = {};
  return {
    statusCode: 200,
    setHeader(key, value) {
      headers[key] = value;
      res.setHeader(key, value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      const body = JSON.stringify(payload);
      res.writeHead(this.statusCode || 200, {
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
      });
      res.end(body);
    },
    end(body) {
      res.writeHead(this.statusCode || 200, headers);
      res.end(body ?? "");
    },
  };
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function listenWithFallback(server, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;

    function attempt() {
      const onError = (err) => {
        server.off("listening", onListening);
        if (err?.code === "EADDRINUSE" && tries < MAX_PORT_TRIES) {
          console.warn(`[launcher] 포트 ${port} 사용 중 → ${port + 1} 시도`);
          port += 1;
          tries += 1;
          setImmediate(attempt);
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    }
    attempt();
  });
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PREFERRED_PORT}`;
  const url = new URL(req.url || "/", `http://${host}`);

  if (url.pathname === "/api/product-capture") {
    try {
      const body = req.method === "POST" ? await readJson(req) : {};
      const vercelReq = {
        method: req.method,
        body,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams),
      };
      await productCapture(vercelReq, createVercelRes(res));
    } catch (err) {
      console.error("[launcher] api:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ success: false, message: "이미지 생성에 실패했습니다." })
      );
    }
    return;
  }

  let filePath = path.join(
    ROOT,
    url.pathname === "/" ? "index.html" : url.pathname
  );
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
});

try {
  const port = await listenWithFallback(server, PREFERRED_PORT);
  const appUrl = `http://localhost:${port}`;
  if (port !== PREFERRED_PORT) {
    console.log(
      `[launcher] 기본 포트 ${PREFERRED_PORT}가 사용 중이어서 ${port}로 시작했습니다.`
    );
  }
  console.log(`\n  ┌──────────────────────────────────────────┐`);
  console.log(`  │                                          │`);
  console.log(`  │   전자상거래 업무 자동화 툴                │`);
  console.log(`  │   E-commerce Automation Toolkit           │`);
  console.log(`  │                                          │`);
  console.log(`  │   → ${appUrl}`);
  console.log(`  │                                          │`);
  console.log(`  │   종료: 이 창을 닫거나 Ctrl+C             │`);
  console.log(`  │                                          │`);
  console.log(`  └──────────────────────────────────────────┘\n`);
  if (shouldOpenBrowser) openBrowser(appUrl);
} catch (err) {
  console.error(
    `[launcher] 서버 시작 실패: ${err?.code || err?.message || err}`
  );
  process.exit(1);
}
