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

// As credenciais ficam no .env.local, igual ao que o Vercel guarda
// no painel. Sem dependencia: um "CHAVE=valor" por linha.
(function carregarEnv() {
  const arq = path.join(ROOT, ".env.local");
  if (!fs.existsSync(arq)) return;
  fs.readFileSync(arq, "utf8").split(/\r?\n/).forEach((linha) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  console.log("  .env.local carregado (ambiente: " + (process.env.APPMAX_ENV || "sandbox") + ")");
})();

// Roda as funcoes de /api como o Vercel roda: mesmo contrato de
// req.query / req.body / res.status().json(), para o que funciona
// aqui funcionar la sem mudanca nenhuma.
async function servirApi(req, res, rota) {
  const arquivo = path.join(ROOT, "api", rota + ".js");
  if (!fs.existsSync(arquivo)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ erro: "Rota nao encontrada: /api/" + rota }));
    return;
  }

  const url = new URL(req.url, "http://localhost");
  req.query = Object.fromEntries(url.searchParams);

  if (req.method === "POST") {
    let cru = "";
    for await (const p of req) cru += p;
    try { req.body = cru ? JSON.parse(cru) : {}; } catch (e) { req.body = {}; }
  }

  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };

  try {
    // require novo a cada chamada: editar o handler nao exige
    // reiniciar o servidor.
    delete require.cache[require.resolve(arquivo)];
    Object.keys(require.cache)
      .filter((k) => k.includes(path.join("api", "_")))
      .forEach((k) => delete require.cache[k]);

    await require(arquivo)(req, res);
  } catch (e) {
    console.error("  [api/" + rota + "]", e.stack || e.message);
    if (!res.writableEnded) res.status(500).json({ ok: false, erro: "Erro interno: " + e.message });
  }
}

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";

  if (rel.startsWith("/api/")) {
    servirApi(req, res, rel.slice(5).replace(/[^a-zA-Z0-9_-]/g, ""));
    return;
  }

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
