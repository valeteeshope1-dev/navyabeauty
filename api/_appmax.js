/* ============================================================
   APPMAX — cliente da API
   Fala com a Appmax pelo servidor. O client_secret vive so aqui,
   nas variaveis de ambiente do Vercel: nunca no navegador.

   Variaveis necessarias (Vercel > Settings > Environment Variables):
     APPMAX_CLIENT_ID       credencial do MERCHANT
     APPMAX_CLIENT_SECRET   credencial do MERCHANT
     APPMAX_ENV             "sandbox" (padrao) ou "producao"
     APPMAX_EXTERNAL_ID     id da instalacao, usado pelo appmax.js
   ============================================================ */

function ambiente(){
  return (process.env.APPMAX_ENV || "sandbox").toLowerCase() === "producao"
    ? { auth: "https://auth.appmax.com.br",            api: "https://api.appmax.com.br",            nome: "producao" }
    : { auth: "https://auth.sandboxappmax.com.br",     api: "https://api.sandboxappmax.com.br",     nome: "sandbox"  };
}

/* O token vale 1 hora. Guardamos em memoria: enquanto a mesma
   instancia da funcao estiver quente, as chamadas seguintes
   reaproveitam em vez de pedir outro. Instancia nova = token novo. */
var tokenCache = { valor: null, expiraEm: 0 };

async function token(){
  var agora = Date.now();
  if (tokenCache.valor && agora < tokenCache.expiraEm) return tokenCache.valor;

  var id     = process.env.APPMAX_CLIENT_ID;
  var secret = process.env.APPMAX_CLIENT_SECRET;
  if (!id || !secret){
    throw new ErroAppmax(
      "Pagamento indisponível no momento.",
      500,
      "APPMAX_CLIENT_ID/APPMAX_CLIENT_SECRET nao configurados no ambiente"
    );
  }

  var corpo = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret
  });

  var r = await fetch(ambiente().auth + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString()
  });

  var dados = await lerJSON(r);

  if (!r.ok || !dados.access_token){
    throw new ErroAppmax(
      "Pagamento indisponível no momento.",
      502,
      "falha na autenticacao (" + r.status + "): " + JSON.stringify(dados).slice(0, 400)
    );
  }

  /* 60s de folga: evita usar um token que expira no meio da chamada. */
  var vida = (Number(dados.expires_in) || 3600) - 60;
  tokenCache = { valor: dados.access_token, expiraEm: agora + vida * 1000 };
  return tokenCache.valor;
}

/* Erro com duas caras: `publico` vai para o cliente na tela,
   `detalhe` fica so no log do Vercel. Nunca vaze `detalhe`. */
function ErroAppmax(publico, status, detalhe){
  this.name = "ErroAppmax";
  this.message = publico;
  this.status = status || 502;
  this.detalhe = detalhe || publico;
}
ErroAppmax.prototype = Object.create(Error.prototype);

async function lerJSON(r){
  var texto = await r.text();
  try { return texto ? JSON.parse(texto) : {}; }
  catch (e) { return { _cru: texto.slice(0, 400) }; }
}

/* Traduz o erro da Appmax para uma frase que o cliente entende. */
function mensagemDoErro(dados, padrao){
  var e = dados && (dados.error || dados.errors);
  if (!e) return padrao;
  if (typeof e.message === "string") return e.message;

  /* 422 vem assim: { errors: { message: { campo: ["motivo"] } } } */
  if (e.message && typeof e.message === "object"){
    var primeiro = Object.keys(e.message)[0];
    var lista = e.message[primeiro];
    if (Array.isArray(lista) && lista.length) return lista[0];
  }
  if (typeof e === "string") return e;
  return padrao;
}

async function chamar(caminho, corpo, opcoes){
  opcoes = opcoes || {};
  var t = await token();

  var r = await fetch(ambiente().api + caminho, {
    method: opcoes.metodo || "POST",
    headers: {
      "Authorization": "Bearer " + t,
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });

  var dados = await lerJSON(r);

  if (!r.ok){
    throw new ErroAppmax(
      mensagemDoErro(dados, opcoes.erroPadrao || "Não foi possível concluir o pagamento."),
      r.status,
      caminho + " -> " + r.status + " " + JSON.stringify(dados).slice(0, 600)
    );
  }

  return dados.data || dados;
}

/* --- Chamadas do fluxo -------------------------------------- */

function criarCliente(cliente){
  return chamar("/v1/customers", cliente, {
    erroPadrao: "Não foi possível registrar seus dados. Confira nome, e-mail e telefone."
  });
}

function criarPedido(pedido){
  return chamar("/v1/orders", pedido, {
    erroPadrao: "Não foi possível criar seu pedido."
  });
}

function pagarPix(corpo){
  return chamar("/v1/payments/pix", corpo, {
    erroPadrao: "Não foi possível gerar o Pix. Tente novamente."
  });
}

function pagarCartao(corpo){
  return chamar("/v1/payments/credit-card", corpo, {
    erroPadrao: "Não foi possível processar o cartão. Confira os dados ou tente outro cartão."
  });
}

/* Tokeniza pelo servidor. So use no sandbox, para teste: em producao
   o cartao deve ser tokenizado no navegador pelo appmax.js, senao o
   numero do cartao passa pelo seu servidor (exige PCI-DSS). */
function tokenizarCartao(cartao){
  return chamar("/v1/payments/tokenize", { payment_data: { credit_card: cartao } }, {
    erroPadrao: "Dados do cartão inválidos."
  });
}

function consultarPedido(id){
  return chamar("/v1/orders/" + encodeURIComponent(id), null, {
    metodo: "GET",
    erroPadrao: "Não foi possível consultar o pedido."
  });
}

module.exports = {
  ambiente: ambiente,
  ErroAppmax: ErroAppmax,
  criarCliente: criarCliente,
  criarPedido: criarPedido,
  pagarPix: pagarPix,
  pagarCartao: pagarCartao,
  tokenizarCartao: tokenizarCartao,
  consultarPedido: consultarPedido
};
