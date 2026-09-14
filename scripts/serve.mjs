import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const port = Number(process.env.PORT || 3000);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let file = path.join(root, relative);
  if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
  else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  else if (!path.extname(file)) file = path.join(file, "index.html");
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, "404.html");
  res.statusCode = file.endsWith("404.html") ? 404 : 200;
  res.setHeader("Content-Type", types[path.extname(file).toLowerCase()] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => console.log(`МедКонспект: http://localhost:${port}`));
