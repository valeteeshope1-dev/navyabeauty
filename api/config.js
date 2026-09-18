/* ============================================================
   GET /api/config
   O que o navegador precisa saber para inicializar o appmax.js.
   So valores publicos: o external_id identifica a instalacao da
   loja, nao autentica nada. O client_secret nunca sai do servidor.
   ============================================================ */

var appmax = require("./_appmax.js");

module.exports = function handler(req, res){
  res.setHeader("Cache-Control", "no-store");

  /* Diagnostico: diz se cada variavel CHEGOU na funcao, nunca o
     valor dela. Sem isto, variavel faltando aparece como
     "Pagamento indisponivel" e nao da para saber o motivo. */
  var conf = {
    credenciais: Boolean(process.env.APPMAX_CLIENT_ID && process.env.APPMAX_CLIENT_SECRET),
    envDefinido: Boolean(process.env.APPMAX_ENV),
    segredoWebhook: Boolean(process.env.APPMAX_WEBHOOK_SECRET),
    externalIdDefinido: Boolean(process.env.APPMAX_EXTERNAL_ID)
  };

  return res.status(200).json({
    externalId: process.env.APPMAX_EXTERNAL_ID || "",
    ambiente: appmax.ambiente().nome,
    parcelasMax: 12,
    configurado: conf
  });
};
