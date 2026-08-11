/**
 * 로컬 개발 서버 (정적 파일 + /api/product-capture)
 * 사용: npm run dev:local
 *
 * PORT — 시작 포트 (기본 5151). 사용 중이면 다음 포트로 자동 시도
 * OPEN_BROWSER=1 — listen 성공 후 브라우저 자동 오픈
 * OPEN_BROWSER=0 — 오픈하지 않음 (기본: 0, 포터블 bat은 1로 설정)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import productCapture from "../api/product-capture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PREFERRED_PORT = Number(process.env.PORT || 5151);
const MAX_PORT_TRIES = 20;
const shouldOpenBrowser = process.env.OPEN_BROWSER === "1";

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

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
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

/**
 * @param {http.ServerResponse} res
 */
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

/**
 * @param {string} url
 */
function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/**
 * @param {http.Server} server
 * @param {number} startPort
 * @returns {Promise<number>}
 */
function listenWithFallback(server, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;

    function attempt() {
      const onError = (err) => {
        server.off("listening", onListening);
        if (err?.code === "EADDRINUSE" && tries < MAX_PORT_TRIES) {
          console.warn(
            `[dev-server] 포트 ${port} 사용 중 → ${port + 1} 시도`
          );
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
      const vercelReq = /** @type {any} */ ({
        method: req.method,
        body,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams),
      });
      await productCapture(vercelReq, createVercelRes(res));
    } catch (err) {
      console.error("[dev-server] api:", err);
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
      `[dev-server] 기본 포트 ${PREFERRED_PORT}가 사용 중이어서 ${port}로 시작했습니다.`
    );
  }
  console.log(`E-commerce Toolkit → ${appUrl}`);
  if (shouldOpenBrowser) {
    openBrowser(appUrl);
  }
} catch (err) {
  console.error(
    `[dev-server] 서버를 시작할 수 없습니다. (${err?.code || err?.message || err})`
  );
  if (err?.code === "EADDRINUSE") {
    console.error(
      `  포트 ${PREFERRED_PORT}~${PREFERRED_PORT + MAX_PORT_TRIES - 1} 모두 사용 중입니다.`
    );
    console.error(
      "  다른 프로그램을 종료한 뒤 다시 실행하거나, PORT=다른번호 로 지정하세요."
    );
  }
  process.exit(1);
}
