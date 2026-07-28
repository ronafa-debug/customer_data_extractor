/**
 * 로컬 개발 서버 (정적 파일 + /api/product-capture)
 * 사용: npm run dev:local
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import productCapture from "../api/product-capture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 5151);

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

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
      res.end(JSON.stringify({ success: false, message: "이미지 생성에 실패했습니다." }));
    }
    return;
  }

  let filePath = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`E-commerce Toolkit → http://localhost:${PORT}`);
});
