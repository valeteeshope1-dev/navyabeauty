/* Servidor local simples — sem dependências.
   Uso:  node server.js          (porta 3000)
         node server.js 8080     (outra porta) */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const PORT = Number(process.argv[2]) || 3000;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".mov":  "video/quicktime",
  ".m4v":  "video/x-m4v",
  ".ogg":  "video/ogg",
  ".woff2":"font/woff2"
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";

  let file = path.join(ROOT, rel);

  // Impede sair da pasta do projeto.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("403");
    return;
  }

  // URLs limpas, igual ao Vercel: /produto serve produto.html
  if (!path.extname(file) && fs.existsSync(file + ".html")) {
    file += ".html";
  }

  const tipo = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>404</h1><p>Nao encontrado: " + rel + "</p>");
      return;
    }

    // Video precisa de Range: sem isto o navegador nao consegue
    // adiantar/voltar, e alguns nem comecam a tocar.
    const range = req.headers.range;
    if (range && tipo.startsWith("video/")) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const ini = m && m[1] ? parseInt(m[1], 10) : 0;
      const fim = m && m[2] ? parseInt(m[2], 10) : st.size - 1;

      if (ini >= st.size || fim >= st.size || ini > fim) {
        res.writeHead(416, { "Content-Range": "bytes */" + st.size });
        res.end();
        return;
      }

      res.writeHead(206, {
        "Content-Type": tipo,
        "Content-Range": "bytes " + ini + "-" + fim + "/" + st.size,
        "Accept-Ranges": "bytes",
        "Content-Length": fim - ini + 1
      });
      fs.createReadStream(file, { start: ini, end: fim }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": tipo,
      "Content-Length": st.size,
      "Accept-Ranges": tipo.startsWith("video/") ? "bytes" : "none",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("\n  NAVYA — servidor local no ar\n");
  console.log("  Neste PC:   http://localhost:" + PORT);

  // IP da rede: para abrir no celular, no mesmo Wi-Fi.
  const nets = os.networkInterfaces();
  for (const nome of Object.keys(nets)) {
    for (const net of nets[nome]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log("  No celular: http://" + net.address + ":" + PORT + "   (mesmo Wi-Fi)");
      }
    }
  }
  console.log("\n  Ctrl+C para parar.\n");
});
