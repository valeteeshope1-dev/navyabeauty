/* ============================================================
   Testa a politica de retry sem tocar na Appmax de verdade:
   o fetch e trocado por um dublê que devolve os status que
   queremos, na ordem que queremos.

   Uso:  node scripts/testar-retry.js

   O que esta sendo protegido aqui: COBRANCA NO CARTAO NAO PODE
   SER REPETIDA. Um 504 significa que o servidor nao respondeu a
   tempo, nao que ele nao processou — repetir pode debitar o
   cliente duas vezes. Se alguem marcar pagarCartao como
   repetivel, este teste acusa.
   ============================================================ */
process.env.APPMAX_CLIENT_ID = "x";
process.env.APPMAX_CLIENT_SECRET = "y";
process.env.APPMAX_ENV = "sandbox";

var roteiro = [];
var chamadas = [];

globalThis.fetch = async function(url, opts){
  if (String(url).indexOf("/oauth2/token") > -1){
    return resposta(200, { access_token: "tok", expires_in: 3600 });
  }
  chamadas.push(String(url));
  var status = roteiro.length ? roteiro.shift() : 200;
  if (status === "rede") throw new Error("socket hang up");
  return resposta(status, status === 200
    ? { data: { ok: true } }
    : { errors: { message: "erro simulado " + status } });
};

function resposta(status, corpo){
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: async function(){ return JSON.stringify(corpo); }
  };
}

var appmax = require(require("path").join(__dirname, "..", "api", "_appmax.js"));

async function cenario(nome, statuses, fn, esperado){
  roteiro = statuses.slice();
  chamadas = [];
  var res;
  try { await fn(); res = "passou"; }
  catch (e) { res = "falhou"; }
  var n = chamadas.length;
  var ok = n === esperado;
  console.log("  " + (ok ? "OK  " : "ERRO") + "  " + nome.padEnd(42) +
              n + " chamada(s), esperado " + esperado + "  -> " + res);
}

(async function(){
  await cenario("Pix: 504 e depois OK",        [504],            function(){ return appmax.pagarPix({order_id:1}); }, 2);
  await cenario("Pix: 504 sempre (desiste)",   [504,504,504],    function(){ return appmax.pagarPix({order_id:1}); }, 3);
  await cenario("CARTAO: 504 nao repete",      [504],            function(){ return appmax.pagarCartao({order_id:1}); }, 1);
  await cenario("CARTAO: falha de rede",       ["rede"],         function(){ return appmax.pagarCartao({order_id:1}); }, 1);
  await cenario("Cartao: 403 recusado",        [403],            function(){ return appmax.pagarCartao({order_id:1}); }, 1);
  await cenario("Pedido: 500 e depois OK",     [500],            function(){ return appmax.criarPedido({customer_id:1}); }, 2);
  await cenario("Cliente: 429 e depois OK",    [429],            function(){ return appmax.criarCliente({email:"a@b.c"}); }, 2);
  await cenario("Cliente: 422 nao repete",     [422],            function(){ return appmax.criarCliente({email:"a@b.c"}); }, 1);
  await cenario("Consulta: 502 e depois OK",   [502],            function(){ return appmax.consultarPedido(5); }, 2);
  await cenario("Parcelas: 503 e depois OK",   [503],            function(){ return appmax.consultarParcelas(5890, 3); }, 2);
})();
