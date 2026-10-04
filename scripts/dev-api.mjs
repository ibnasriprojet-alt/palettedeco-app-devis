process.loadEnvFile(".env.dev");
import { createServer } from "node:http";
const { default: app } = await import("../src/index.ts");

const port = Number(process.env.PORT || 8787);

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) headers.set(k, v);
    const bodyBuf = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req);
    const request = new Request(`http://${req.headers.host || `localhost:${port}`}${req.url}`, {
      method: req.method,
      headers,
      body: bodyBuf ? bodyBuf : undefined,
    });
    const response = await app.fetch(request, {}, { env: process.env });
    for (const [k, v] of response.headers.entries()) {
      if (k.toLowerCase() === "set-cookie") {
        res.appendHeader("set-cookie", v);
      } else {
        res.setHeader(k, v);
      }
    }
    res.writeHead(response.status);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end(String((e && e.message) || e));
  }
}).listen(port, () => {
  console.log(`API locale (dev branch) : http://localhost:${port}`);
  console.log(`DATABASE_URL -> ${String(process.env.DATABASE_URL).slice(0, 45)}...`);
});