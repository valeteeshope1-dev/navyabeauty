/* ============================================================
   GET /api/config
   O que o navegador precisa saber para inicializar o appmax.js.
   So valores publicos: o external_id identifica a instalacao da
   loja, nao autentica nada. O client_secret nunca sai do servidor.
   ============================================================ */

var appmax = require("./_appmax.js");

module.exports = function handler(req, res){
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    externalId: process.env.APPMAX_EXTERNAL_ID || "",
    ambiente: appmax.ambiente().nome,
    parcelasMax: 12
  });
};
