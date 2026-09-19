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

/* A recusa do cartao chega assim:
     "Pagamento não autorizado: AuthAndCapture failed: Transação nao
      autorizada pela operadora do cartão, confira seus dados..."
   O miolo e uma frase boa para o cliente; o "AuthAndCapture failed"
   e nome de rotina interna do gateway e nao diz nada a ninguem. */
function limpar(frase){
  return String(frase)
    .replace(/\b[A-Za-z]{2,} failed:\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Traduz o erro da Appmax para uma frase que o cliente entende. */
function mensagemDoErro(dados, padrao){
  var e = dados && (dados.error || dados.errors);
  if (!e) return padrao;
  if (typeof e.message === "string") return limpar(e.message);

  /* 422 vem assim: { errors: { message: { campo: ["motivo"] } } } */
  if (e.message && typeof e.message === "object"){
    var primeiro = Object.keys(e.message)[0];
    var lista = e.message[primeiro];
    if (Array.isArray(lista) && lista.length) return lista[0];
  }
  if (typeof e === "string") return e;
  return padrao;
}

/* Erros que uma segunda tentativa pode resolver:
   - 502/503/504: o servidor deles caiu ou demorou (o caso do Pix).
   - 429: passamos do limite de chamadas; esperar e a resposta certa.

   NAO repetimos 4xx: cartao recusado, CPF invalido e pedido
   inexistente vao dar o mesmo erro na segunda tentativa, e insistir
   so faz o cliente esperar mais para ver a mesma recusa.

   Isto diz apenas que o ERRO e passageiro. Se a CHAMADA pode ser
   repetida sem risco e outra pergunta, respondida por `repetivel`
   em cada uma — um 504 numa cobranca pode significar que ela
   passou e a resposta se perdeu. */
function valeRepetir(status){
  return status === 429 || (status >= 500 && status <= 599);
}

function esperar(ms){
  return new Promise(function(ok){ setTimeout(ok, ms); });
}

var TENTATIVAS = 3;
var ESPERA_BASE = 400;   /* 400ms, 800ms — cabe no tempo de uma pessoa esperando */

async function chamar(caminho, corpo, opcoes){
  opcoes = opcoes || {};
  var metodo = opcoes.metodo || "POST";
  var ultimoErro = null;

  for (var tentativa = 1; tentativa <= TENTATIVAS; tentativa++){
    var t = await token();
    var r, dados, erroRede = null;

    try {
      r = await fetch(ambiente().api + caminho, {
        method: metodo,
        headers: {
          "Authorization": "Bearer " + t,
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      dados = await lerJSON(r);
    } catch (e) {
      erroRede = e;
    }

    if (!erroRede && r.ok) return dados.data || dados;

    var status = erroRede ? 0 : r.status;

    /* Token recusado: pode ter expirado entre o cache e a chamada.
       Descartamos e pedimos outro na proxima volta. */
    if (status === 401){
      tokenCache = { valor: null, expiraEm: 0 };
    }

    ultimoErro = new ErroAppmax(
      erroRede
        ? (opcoes.erroPadrao || "Não foi possível concluir o pagamento.")
        : mensagemDoErro(dados, opcoes.erroPadrao || "Não foi possível concluir o pagamento."),
      status || 502,
      caminho + " -> " + (erroRede ? "falha de rede: " + erroRede.message
                                   : status + " " + JSON.stringify(dados).slice(0, 600))
    );

    /* Repetir so quando a chamada é segura de repetir. Um 504 quer
       dizer "o servidor nao respondeu a tempo", NAO "o servidor nao
       processou" — repetir uma cobranca nessa situacao pode debitar
       o cliente duas vezes. Por isso cada chamada diz se aceita ser
       repetida, e o cartao nao aceita.

       O 401 é exceção: token recusado significa que a requisicao
       nao passou da porta, entao repetir com token novo e seguro
       mesmo numa cobranca. */
    var insistir = (status === 401 && tentativa === 1) ||
                   (opcoes.repetivel && (erroRede || valeRepetir(status)));
    if (!insistir || tentativa === TENTATIVAS) break;

    var espera = ESPERA_BASE * Math.pow(2, tentativa - 1);
    console.warn("[appmax] " + caminho + " falhou (" + (status || "rede") +
                 "), tentativa " + tentativa + "/" + TENTATIVAS +
                 " — repetindo em " + espera + "ms");
    await esperar(espera);
  }

  throw ultimoErro;
}

/* --- Chamadas do fluxo -------------------------------------- */

function criarCliente(cliente){
  /* Seguro repetir: a Appmax identifica o cliente pela combinacao
     nome + email + telefone + ip e atualiza em vez de duplicar. */
  return chamar("/v1/customers", cliente, {
    repetivel: true,
    erroPadrao: "Não foi possível registrar seus dados. Confira nome, e-mail e telefone."
  });
}

function criarPedido(pedido){
  /* No pior caso sobra um pedido pendente duplicado no painel — que
     nao cobra ninguem e expira. Perder a venda seria pior. */
  return chamar("/v1/orders", pedido, {
    repetivel: true,
    erroPadrao: "Não foi possível criar seu pedido."
  });
}

/* Repetir e seguro: gera as instrucoes de um pedido que ja existe,
   nao movimenta dinheiro. Era exatamente o caso do 504 do dia 18. */
function pagarPix(corpo){
  return chamar("/v1/payments/pix", corpo, {
    repetivel: true,
    erroPadrao: "Não foi possível gerar o Pix. Tente novamente."
  });
}

/* SEM repeticao, de proposito. Um timeout aqui pode significar que
   a cobranca passou e a resposta se perdeu; repetir debitaria o
   cliente duas vezes. Falhar e pedir para tentar de novo, com a
   pessoa decidindo, e o comportamento correto. */
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
    repetivel: true,
    erroPadrao: "Não foi possível consultar o pedido."
  });
}

/* Tabela de parcelas COM juros, do jeito que a Appmax cobra desta
   loja. A Appmax nao aplica juros sozinha: quem monta o pedido com o
   valor ja ajustado somos nos. Por isso esta consulta e obrigatoria
   antes de cobrar parcelado — chutar a taxa significa cobrar a mais
   ou a menos do cliente.

   Atencao ao formato: a documentacao mostra "installments" com totais
   em centavos, mas a API responde "parcels" com valores em REAIS
   (58.9, 61.24...). Aceitamos os dois. */
async function consultarParcelas(totalCentavos, maxParcelas){
  var resp = await chamar("/v1/payments/installments", {
    installments: maxParcelas,
    total_value: totalCentavos,
    settings: true
  }, { repetivel: true, erroPadrao: "Não foi possível calcular as parcelas." });

  var bruto = resp.parcels || resp.installments || {};
  var opcoes = [];

  for (var n = 1; n <= maxParcelas; n++){
    var valor = bruto[n] !== undefined ? bruto[n] : bruto[String(n)];
    if (valor === undefined || valor === null) continue;

    var total;
    if (typeof valor === "object"){
      total = Number(valor.total);              /* formato da documentacao: centavos */
    } else {
      total = Math.round(Number(valor) * 100);  /* formato real: reais */
    }
    if (!Number.isFinite(total) || total <= 0) continue;

    opcoes.push({
      parcelas: n,
      total: total,
      valorParcela: Math.round(total / n),
      juros: total - totalCentavos
    });
  }

  if (!opcoes.length){
    throw new ErroAppmax(
      "Não foi possível calcular as parcelas.", 502,
      "resposta de parcelas sem valores: " + JSON.stringify(resp).slice(0, 300)
    );
  }

  return opcoes;
}

module.exports = {
  ambiente: ambiente,
  ErroAppmax: ErroAppmax,
  criarCliente: criarCliente,
  criarPedido: criarPedido,
  pagarPix: pagarPix,
  pagarCartao: pagarCartao,
  tokenizarCartao: tokenizarCartao,
  consultarPedido: consultarPedido,
  consultarParcelas: consultarParcelas
};
