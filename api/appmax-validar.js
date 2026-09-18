/* ============================================================
   POST /api/appmax-validar   (e GET, para voce testar no navegador)

   A URL de validacao da instalacao. Durante o
   POST /app/client/generate, a Appmax chama AQUI, de servidor
   para servidor. Se esta rota nao responder 200 com um UUID
   valido, a instalacao aborta e nenhuma credencial e emitida.

   Cadastre este endereco no painel do app, no campo
   "URL de validacao":
       https://navyabeauty.com/api/appmax-validar

   Sobre o external_id: a Appmax exige um UUID NOVO a cada health
   check — repetido ela descarta. Como a loja e uma so e nao temos
   banco, geramos na hora e gravamos no log. Depois do health check
   voce copia o UUID do log do Vercel para a variavel
   APPMAX_EXTERNAL_ID, que e o valor que o appmax.js usa no
   navegador para tokenizar cartao.
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

  var externalId = crypto.randomUUID();

  /* Este handler SEMPRE responde 200 com um UUID novo, venha o que
     vier no corpo. Recusar a chamada — por falta de app_id, por
     formato inesperado, por qualquer motivo — derruba a instalacao
     inteira, e a mensagem de erro da Appmax nao diz qual foi o
     problema. Entao registramos tudo e deixamos passar. */
  console.log("[appmax-validar] ===== HEALTH CHECK =====");
  console.log("[appmax-validar] metodo: " + req.method);
  console.log("[appmax-validar] content-type: " + (req.headers["content-type"] || "(nenhum)"));
  console.log("[appmax-validar] corpo: " + JSON.stringify(corpo).slice(0, 600));
  console.log("[appmax-validar] EXTERNAL_ID GERADO: " + externalId);
  if (corpo.client_id){
    console.log("[appmax-validar] merchant client_id veio no payload: " + corpo.client_id);
  }
  if (corpo.client_secret){
    console.log("[appmax-validar] merchant client_secret veio no payload: " + corpo.client_secret);
  }

  return res.status(200).json({ external_id: externalId, alias: ALIAS });
};
