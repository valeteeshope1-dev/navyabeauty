/* ============================================================
   Instalacao do app na loja — o passo que gera as credenciais
   do MERCHANT (as unicas que criam cliente, pedido e pagamento).

   Roda em duas etapas, porque no meio delas VOCE precisa
   autorizar a instalacao no navegador:

     node scripts/instalar-appmax.js autorizar
         -> devolve o link para voce abrir e autorizar

     node scripts/instalar-appmax.js gerar
         -> apos autorizar, gera as credenciais do merchant
            e grava sozinho no .env.local

   Antes de rodar, o .env.local precisa ter:
     APPMAX_CLIENT_ID       credencial do APP
     APPMAX_CLIENT_SECRET   credencial do APP
     APPMAX_APP_ID          o App UUID (nao o numero!)
   ============================================================ */

var fs   = require("fs");
var path = require("path");

var RAIZ   = path.join(__dirname, "..");
var ENV    = path.join(RAIZ, ".env.local");
var GUARDA = path.join(__dirname, ".instalacao.json");

var URL_VALIDACAO = "https://navyabeauty.com/api/appmax-validar";
var URL_CALLBACK  = "https://navyabeauty.com/checkout";
var DOMINIO       = "navyabeauty.com";
var EXTERNAL_KEY  = "navya-loja-1";

function lerEnv(){
  if (!fs.existsSync(ENV)){
    console.error("\n  Falta o .env.local. Veja .env.local.exemplo.\n");
    process.exit(1);
  }
  var mapa = {};
  fs.readFileSync(ENV, "utf8").split(/\r?\n/).forEach(function(linha){
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m) mapa[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  return mapa;
}

/* Reescreve uma chave no .env.local preservando o resto. */
function gravarEnv(chave, valor){
  var linhas = fs.readFileSync(ENV, "utf8").split(/\r?\n/);
  var achou = false;
  linhas = linhas.map(function(l){
    if (new RegExp("^\\s*" + chave + "\\s*=").test(l)){ achou = true; return chave + "=" + valor; }
    return l;
  });
  if (!achou) linhas.push(chave + "=" + valor);
  fs.writeFileSync(ENV, linhas.join("\n"));
}

var env = lerEnv();
var sandbox = (env.APPMAX_ENV || "sandbox").toLowerCase() !== "producao";

var URLS = sandbox
  ? { auth: "https://auth.sandboxappmax.com.br", api: "https://api.sandboxappmax.com.br",
      autorizar: "https://breakingcode.sandboxappmax.com.br/appstore/integration/" }
  : { auth: "https://auth.appmax.com.br", api: "https://api.appmax.com.br",
      autorizar: "https://admin.appmax.com.br/appstore/integration/" };

/* Depois da primeira instalacao, APPMAX_CLIENT_ID passa a guardar a
   credencial do MERCHANT, e a do APP fica em APPMAX_APP_CLIENT_ID.
   A instalacao precisa da credencial do APP — usar a do merchant aqui
   da 401, porque ela nao tem escopo de appstore. */
function credenciaisDoApp(){
  if (env.APPMAX_APP_CLIENT_ID && env.APPMAX_APP_CLIENT_SECRET){
    return { id: env.APPMAX_APP_CLIENT_ID, secret: env.APPMAX_APP_CLIENT_SECRET, origem: "APPMAX_APP_CLIENT_*" };
  }
  return { id: env.APPMAX_CLIENT_ID, secret: env.APPMAX_CLIENT_SECRET, origem: "APPMAX_CLIENT_*" };
}

async function tokenDoApp(){
  var c = credenciaisDoApp();
  var corpo = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: c.id,
    client_secret: c.secret
  });
  var r = await fetch(URLS.auth + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString()
  });
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok || !d.access_token){
    throw new Error("autenticacao do app falhou (" + r.status + ") usando " + c.origem + ": " + JSON.stringify(d).slice(0, 300));
  }
  return d.access_token;
}

async function chamar(caminho, corpo, token){
  var r = await fetch(URLS.api + caminho, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(corpo)
  });
  var texto = await r.text();
  var d;
  try { d = texto ? JSON.parse(texto) : {}; } catch (e) { d = { _cru: texto.slice(0, 400) }; }
  return { ok: r.ok, status: r.status, dados: d };
}

async function autorizar(){
  if (!env.APPMAX_APP_ID){
    console.error("\n  Falta APPMAX_APP_ID no .env.local — e o App UUID do painel,");
    console.error("  aquele no formato 8f2c1d3e-5a4b-4c7d-9e1f-2a3b4c5d6e7f.");
    console.error("  Cuidado: NAO e o numero curto (Numerical ID).\n");
    process.exit(1);
  }

  console.log("\n  Ambiente: " + (sandbox ? "SANDBOX" : "PRODUCAO"));
  console.log("  Pedindo o hash de autorizacao...\n");

  var token = await tokenDoApp();
  var r = await chamar("/app/authorize", {
    app_id: env.APPMAX_APP_ID,
    external_key: EXTERNAL_KEY,
    url_callback: URL_CALLBACK,
    domain_name: DOMINIO
  }, token);

  if (!r.ok){
    console.error("  FALHOU (" + r.status + "): " + JSON.stringify(r.dados));
    if (r.status === 422){
      console.error("\n  422 quase sempre e o ID errado: use o App UUID, nao o Numerical ID.");
    }
    process.exit(1);
  }

  var hash = r.dados.data && r.dados.data.token;
  if (!hash){
    console.error("  Resposta sem o hash: " + JSON.stringify(r.dados));
    process.exit(1);
  }

  fs.writeFileSync(GUARDA, JSON.stringify({ hash: hash, quando: new Date().toISOString() }, null, 2));

  console.log("  =======================================================");
  console.log("  ABRA ESTE LINK NO NAVEGADOR E AUTORIZE A INSTALACAO:\n");
  console.log("  " + URLS.autorizar + hash);
  console.log("\n  =======================================================");
  console.log("\n  Confira antes que a URL de validacao do app no painel seja:");
  console.log("    " + URL_VALIDACAO);
  console.log("  e que ela ja esteja publicada (deploy feito).\n");
  console.log("  Autorizou? Rode:  node scripts/instalar-appmax.js gerar\n");
}

async function gerar(){
  if (!fs.existsSync(GUARDA)){
    console.error("\n  Nao achei o hash. Rode antes: node scripts/instalar-appmax.js autorizar\n");
    process.exit(1);
  }
  var guarda = JSON.parse(fs.readFileSync(GUARDA, "utf8"));

  console.log("\n  Gerando as credenciais do merchant...");
  console.log("  (agora a Appmax chama " + URL_VALIDACAO + ")\n");

  var token = await tokenDoApp();
  var r = await chamar("/app/client/generate", { token: guarda.hash }, token);

  if (!r.ok){
    console.error("  FALHOU (" + r.status + "): " + JSON.stringify(r.dados));
    if (r.status === 500){
      console.error("\n  500 aqui quase sempre e o health check: a Appmax nao conseguiu");
      console.error("  falar com a URL de validacao, ou ela nao devolveu 200 + UUID.");
      console.error("  Teste voce mesmo:  curl " + URL_VALIDACAO);
    }
    if (r.status === 422 || r.status === 400){
      console.error("\n  O hash vale UMA vez so. Se ja usou, rode a etapa autorizar de novo.");
    }
    process.exit(1);
  }

  var c = (r.dados.data && r.dados.data.client) || {};
  if (!c.client_id || !c.client_secret){
    console.error("  Resposta sem as credenciais: " + JSON.stringify(r.dados));
    process.exit(1);
  }

  /* As credenciais do APP nao servem para o dia a dia: ficam
     guardadas a parte, e as do merchant assumem as chaves que a
     loja usa.

     So arquivamos na PRIMEIRA instalacao. Numa reinstalacao,
     APPMAX_CLIENT_ID ja guarda um merchant antigo — copiar dali
     apagaria a credencial do app e a proxima instalacao ficaria
     impossivel. */
  if (!env.APPMAX_APP_CLIENT_ID || !env.APPMAX_APP_CLIENT_SECRET){
    gravarEnv("APPMAX_APP_CLIENT_ID", env.APPMAX_CLIENT_ID);
    gravarEnv("APPMAX_APP_CLIENT_SECRET", env.APPMAX_CLIENT_SECRET);
  }
  gravarEnv("APPMAX_CLIENT_ID", c.client_id);
  gravarEnv("APPMAX_CLIENT_SECRET", c.client_secret);

  fs.unlinkSync(GUARDA);

  console.log("  OK — credenciais do MERCHANT geradas e gravadas no .env.local.");
  console.log("  (as do app foram preservadas como APPMAX_APP_CLIENT_*)\n");
  console.log("  Agora pegue o external_id no log do Vercel e coloque em");
  console.log("  APPMAX_EXTERNAL_ID. Depois rode:  node scripts/testar-appmax.js\n");
}

var acao = (process.argv[2] || "").toLowerCase();

(async function(){
  try {
    if (acao === "autorizar") await autorizar();
    else if (acao === "gerar") await gerar();
    else {
      console.log("\n  Uso:");
      console.log("    node scripts/instalar-appmax.js autorizar");
      console.log("    node scripts/instalar-appmax.js gerar\n");
    }
  } catch (e) {
    console.error("\n  ERRO: " + e.message + "\n");
    process.exit(1);
  }
})();
