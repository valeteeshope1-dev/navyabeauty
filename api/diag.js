/* ============================================================
   GET /api/diag?k=SEGREDO   — temporario, para diagnostico

   Tenta autenticar na Appmax e conta o que aconteceu, sem mostrar
   nenhum segredo: so tamanhos, prefixo do client_id (que e um
   identificador, nao uma chave) e o status HTTP da resposta.

   Protegido pelo mesmo segredo do webhook. APAGUE este arquivo
   quando o pagamento estiver funcionando.
   ============================================================ */

var appmax = require("./_appmax.js");

module.exports = async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");

  var segredo = process.env.APPMAX_WEBHOOK_SECRET;
  if (!segredo || !req.query || req.query.k !== segredo){
    return res.status(404).json({ erro: "não encontrado" });
  }

  var id     = process.env.APPMAX_CLIENT_ID || "";
  var secret = process.env.APPMAX_CLIENT_SECRET || "";
  var amb    = appmax.ambiente();

  /* Espaco ou quebra de linha colada junto com o valor e a causa
     mais comum de credencial "certa" que nao autentica. */
  var relato = {
    ambiente: amb.nome,
    auth: amb.auth,
    id: {
      tamanho: id.length,
      prefixo: id.slice(0, 6),
      temEspacoOuQuebra: /\s/.test(id),
      temAspas: /["']/.test(id)
    },
    secret: {
      tamanho: secret.length,
      temEspacoOuQuebra: /\s/.test(secret),
      temAspas: /["']/.test(secret)
    }
  };

  try {
    var r = await fetch(amb.auth + "/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id.trim(),
        client_secret: secret.trim()
      }).toString()
    });

    var texto = await r.text();
    var dados = {};
    try { dados = texto ? JSON.parse(texto) : {}; } catch (e) {}

    relato.autenticacao = {
      status: r.status,
      recebeuToken: Boolean(dados.access_token),
      erro: dados.error || null,
      descricao: dados.error_description || null
    };
  } catch (e) {
    relato.autenticacao = { falhaDeRede: e.message };
  }

  return res.status(200).json(relato);
};
