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
  if (typeof req.body === "string"){
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  var cru = "";
  for await (var pedaco of req) cru += pedaco;
  try { return cru ? JSON.parse(cru) : {}; } catch (e) { return {}; }
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

  if (req.method !== "POST"){
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ erro: "Método não permitido." });
  }

  var corpo = await lerCorpo(req);

  /* app_id e o unico campo garantido no payload. Todo o resto
     (client_id, client_secret, external_key) pode nao vir — a
     documentacao pede explicitamente para nao tratar como erro. */
  if (corpo.app_id === undefined || corpo.app_id === null || corpo.app_id === ""){
    console.error("[appmax-validar] health check sem app_id:", JSON.stringify(corpo).slice(0, 300));
    return res.status(400).json({ erro: "app_id ausente." });
  }

  var esperado = process.env.APPMAX_APP_ID_NUMERICO;
  if (esperado && String(corpo.app_id) !== String(esperado)){
    console.error("[appmax-validar] app_id inesperado: recebi " + corpo.app_id + ", esperava " + esperado);
    return res.status(400).json({ erro: "app_id não confere." });
  }

  var externalId = crypto.randomUUID();

  /* Este log e o unico registro do valor. Vercel > Logs. */
  console.log("[appmax-validar] ===== INSTALACAO =====");
  console.log("[appmax-validar] app_id recebido: " + corpo.app_id);
  console.log("[appmax-validar] EXTERNAL_ID GERADO: " + externalId);
  if (corpo.client_id){
    console.log("[appmax-validar] merchant client_id tambem veio no payload: " + corpo.client_id);
  }
  console.log("[appmax-validar] Guarde o external_id em APPMAX_EXTERNAL_ID.");

  return res.status(200).json({ external_id: externalId, alias: ALIAS });
};
