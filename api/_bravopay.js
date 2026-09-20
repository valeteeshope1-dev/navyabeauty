/* ============================================================
   BRAVOPAY — cliente da API (somente Pix)

   Muito mais simples que a Appmax: a chave de API e usada direto,
   sem OAuth, sem token de 1 hora, sem instalacao de aplicativo.

   Variaveis de ambiente (Vercel > Settings > Environment Variables):
     BRAVOPAY_API_KEY         chave do painel (bp_live_... ou de teste)
     BRAVOPAY_WEBHOOK_SECRET  segredo do webhook (whsec_...)

   Documentacao: https://bravopay.club/docs
   ============================================================ */

var crypto = require("crypto");

var BASE = "https://bravopay.club/api/v1";

/* O menor valor que eles aceitam. Nosso produto mais barato custa
   R$ 37,90, entao isto nunca deve barrar — mas se um dia alguem
   criar um combo promocional, a mensagem sai clara. */
var MINIMO_CENTAVOS = 500;

function ErroBravo(publico, status, detalhe){
  this.name = "ErroBravo";
  this.message = publico;
  this.status = status || 502;
  this.detalhe = detalhe || publico;
}
ErroBravo.prototype = Object.create(Error.prototype);

function esperar(ms){
  return new Promise(function(ok){ setTimeout(ok, ms); });
}

/* Erro passageiro: vale uma segunda tentativa. 4xx nao — vai dar o
   mesmo resultado e so faz o cliente esperar mais. */
function passageiro(status){
  return status === 429 || (status >= 500 && status <= 599);
}

var TENTATIVAS = 3;
var ESPERA_BASE = 400;

async function chamar(caminho, opcoes){
  opcoes = opcoes || {};

  var chave = process.env.BRAVOPAY_API_KEY;
  if (!chave){
    throw new ErroBravo(
      "Pagamento indisponível no momento.", 500,
      "BRAVOPAY_API_KEY nao configurada no ambiente"
    );
  }

  var ultimo = null;

  for (var tentativa = 1; tentativa <= TENTATIVAS; tentativa++){
    var r, dados, erroRede = null;

    try {
      r = await fetch(BASE + caminho, {
        method: opcoes.metodo || "GET",
        headers: {
          "Authorization": "Bearer " + chave,
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
      });

      var texto = await r.text();
      try { dados = texto ? JSON.parse(texto) : {}; }
      catch (e) { dados = { _cru: texto.slice(0, 400) }; }
    } catch (e) {
      erroRede = e;
    }

    if (!erroRede && r.ok) return dados;

    var status = erroRede ? 0 : r.status;

    ultimo = new ErroBravo(
      mensagem(dados, opcoes.erroPadrao),
      status || 502,
      caminho + " -> " + (erroRede
        ? "falha de rede: " + erroRede.message
        : status + " " + JSON.stringify(dados).slice(0, 500))
    );

    var insistir = opcoes.repetivel && (erroRede || passageiro(status));
    if (!insistir || tentativa === TENTATIVAS) break;

    var pausa = ESPERA_BASE * Math.pow(2, tentativa - 1);
    console.warn("[bravopay] " + caminho + " falhou (" + (status || "rede") +
                 "), tentativa " + tentativa + "/" + TENTATIVAS +
                 " — repetindo em " + pausa + "ms");
    await esperar(pausa);
  }

  throw ultimo;
}

/* Erro da API vira frase de cliente. O detalhe tecnico fica no log. */
function mensagem(dados, padrao){
  padrao = padrao || "Não foi possível concluir o pagamento.";
  if (!dados) return padrao;

  var m = dados.message || dados.error ||
          (dados.errors && (dados.errors.message || dados.errors[0]));

  if (typeof m === "string" && m.length < 160) return m;
  return padrao;
}

/* --- Cobranca Pix ------------------------------------------- */

/* Cria a cobranca. Repetir e seguro: no pior caso sobra um Pix
   pendente que ninguem paga e que expira sozinho — melhor do que
   perder a venda por uma instabilidade momentanea. */
function criarPix(dados){
  if (!Number.isInteger(dados.centavos) || dados.centavos < MINIMO_CENTAVOS){
    throw new ErroBravo(
      "Valor do pedido inválido.", 400,
      "valor " + dados.centavos + " abaixo do minimo de " + MINIMO_CENTAVOS
    );
  }

  var corpo = {
    amount_cents: dados.centavos,
    method: "pix",
    external_reference: dados.referencia,
    description: dados.descricao,
    customer: {
      email: dados.cliente.email,
      name: dados.cliente.nome,
      cpf: dados.cliente.cpf,
      phone: dados.cliente.telefone
    }
  };

  if (dados.metadata) corpo.metadata = dados.metadata;
  if (dados.utm) corpo.utm = dados.utm;

  /* Sem product_id a cobranca e acoplada a um produto interno
     (ghost) do BravoPay. A documentacao deles avisa o que isso
     causa na UTMify: o nome do produto vira "API Charge", e se
     houver filtro por produto na UTMify a venda e descartada —
     some do relatorio sem aviso. */
  if (dados.produtoId) corpo.product_id = dados.produtoId;

  return chamar("/transactions", {
    metodo: "POST",
    corpo: corpo,
    repetivel: true,
    erroPadrao: "Não foi possível gerar o Pix. Tente novamente."
  });
}

/* A consulta e por external_reference (o nosso numero de pedido),
   nao por id — e o que a API oferece, e tambem o que nos protege:
   o id deles nao circula pelo navegador. */
function consultarPorReferencia(referencia){
  return chamar("/transactions?external_reference=" + encodeURIComponent(referencia), {
    repetivel: true,
    erroPadrao: "Não foi possível consultar o pedido."
  });
}

function conta(){
  return chamar("/me", { repetivel: true, erroPadrao: "Não foi possível consultar a conta." });
}

function saldo(){
  return chamar("/balance", { repetivel: true, erroPadrao: "Não foi possível consultar o saldo." });
}

/* --- Webhook ------------------------------------------------ *
   Diferente da Appmax, aqui a assinatura existe e e forte:
   HMAC-SHA256 sobre "<timestamp>.<corpo cru>". Duas exigencias que
   nao podem ser relaxadas:

   1. o corpo tem que ser o CRU, byte a byte. JSON.parse seguido de
      JSON.stringify muda espacos e ordem, e a assinatura nao bate.
   2. comparar com timingSafeEqual, nunca com ===. Comparacao comum
      para no primeiro byte diferente, e esse tempo vaza o segredo
      aos poucos para quem estiver medindo.                        */
function assinaturaValida(corpoCru, cabecalho, segredo, toleranciaSeg){
  toleranciaSeg = toleranciaSeg || 300;
  if (!corpoCru || !cabecalho || !segredo) return false;

  var partes = {};
  String(cabecalho).split(",").forEach(function(par){
    var i = par.indexOf("=");
    if (i > 0) partes[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });

  var t = Number(partes.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranciaSeg) return false;
  if (!partes.v1) return false;

  var esperado = crypto.createHmac("sha256", segredo)
                       .update(t + "." + corpoCru)
                       .digest("hex");

  var a = Buffer.from(esperado, "utf8");
  var b = Buffer.from(partes.v1, "utf8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  ErroBravo: ErroBravo,
  criarPix: criarPix,
  consultarPorReferencia: consultarPorReferencia,
  conta: conta,
  saldo: saldo,
  assinaturaValida: assinaturaValida,
  MINIMO_CENTAVOS: MINIMO_CENTAVOS
};
