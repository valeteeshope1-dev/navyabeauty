/* ============================================================
   POST /api/appmax-validar   (e GET, para voce testar no navegador)

   A URL de validacao da instalacao. Durante o
   POST /app/client/generate, a Appmax chama AQUI, de servidor
   para servidor. Se esta rota nao responder 200 com um UUID
   valido, a instalacao aborta e nenhuma credencial e emitida.

   Cadastre este endereco no painel do app, no campo
   "URL de validacao":
       https://navyabeauty.com/api/appmax-validar

   Sobre o external_id: a Appmax exige um UUID novo a cada
   instalacao e guarda o que devolvermos aqui. Esse mesmo valor e
   exigido depois pelo appmax.js no navegador, para tokenizar
   cartao — ou seja, precisamos saber qual foi.

   A primeira versao sorteava o UUID e gravava no log. Nao funciona:
   no plano Hobby da Vercel o log de runtime vive cerca de uma hora,
   e o valor se perde junto. Entao invertemos — voce define
   APPMAX_EXTERNAL_ID ANTES de instalar, e o health check devolve
   exatamente esse valor. O UUID ja esta guardado onde precisa estar.

   Sem a variavel definida, sorteamos (e a instalacao funciona, mas
   o valor se perde). Antes de CADA nova instalacao, gere um UUID
   novo: a Appmax rejeita valor repetido.
   ============================================================ */

var crypto = require("crypto");

var ALIAS = "Navya Beauty";

async function lerCorpo(req){
  if (req.body && typeof req.body === "object") return req.body;

  var cru = typeof req.body === "string" ? req.body : "";
  if (!cru){
    try { for await (var pedaco of req) cru += pedaco; } catch (e) { cru = ""; }
  }
  if (!cru) return {};

  try { return JSON.parse(cru); } catch (e) {}

  /* Pode vir como formulario em vez de JSON — aqui nao existe
     "formato errado": o que nao der para ler vira {} e seguimos. */
  try {
    var obj = {};
    new URLSearchParams(cru).forEach(function(v, k){ obj[k] = v; });
    return obj;
  } catch (e) { return {}; }
}

module.exports = async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");

  /* GET e so para voce conferir no navegador que a rota existe.
     A Appmax sempre chama por POST. */
  if (req.method === "GET"){
    return res.status(200).json({
      external_id: crypto.randomUUID(),
      alias: ALIAS,
      _aviso: "Resposta de teste. A Appmax chama esta rota por POST."
    });
  }

  var corpo = {};
  try { corpo = await lerCorpo(req); } catch (e) { corpo = {}; }

  /* O valor combinado vence o sorteio: e o unico que continua
     conhecido depois que o log expirar. */
  var combinado = String(process.env.APPMAX_EXTERNAL_ID || "").trim();
  var valido = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(combinado);

  if (combinado && !valido){
    console.error("[appmax-validar] APPMAX_EXTERNAL_ID nao e um UUID valido; sorteando um novo");
  }

  var externalId = valido ? combinado : crypto.randomUUID();

  /* Este handler SEMPRE responde 200 com um UUID novo, venha o que
     vier no corpo. Recusar a chamada — por falta de app_id, por
     formato inesperado, por qualquer motivo — derruba a instalacao
     inteira, e a mensagem de erro da Appmax nao diz qual foi o
     problema. Entao registramos tudo e deixamos passar. */
  console.log("[appmax-validar] ===== HEALTH CHECK =====");
  console.log("[appmax-validar] metodo: " + req.method);
  console.log("[appmax-validar] content-type: " + (req.headers["content-type"] || "(nenhum)"));
  console.log("[appmax-validar] corpo: " + JSON.stringify(corpo).slice(0, 600));
  console.log("[appmax-validar] EXTERNAL_ID DEVOLVIDO: " + externalId +
              (valido ? "  (vindo de APPMAX_EXTERNAL_ID)" : "  (sorteado — o log expira, guarde agora!)"));
  /* O payload pode trazer as credenciais do merchant. NAO registramos
     o valor: log nao e lugar de segredo, e essas credenciais nao
     expiram. Registramos so que vieram. */
  if (corpo.client_id || corpo.client_secret){
    console.log("[appmax-validar] o payload trouxe credenciais de merchant (valores omitidos do log)");
  }

  return res.status(200).json({ external_id: externalId, alias: ALIAS });
};
