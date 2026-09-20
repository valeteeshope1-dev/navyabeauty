/* ============================================================
   GET /api/config

   Diz quais variaveis CHEGARAM na funcao — nunca o valor delas.
   Sem isto, variavel faltando ou com nome errado aparece so como
   "Pagamento indisponivel" e nao da para saber qual e.

   O prefixo e o tamanho da chave aparecem porque nao sao segredo
   util: servem para flagrar o erro classico de colar a linha
   inteira (CHAVE=valor) no campo do valor.
   ============================================================ */

module.exports = function handler(req, res){
  res.setHeader("Cache-Control", "no-store");

  var chave = process.env.BRAVOPAY_API_KEY || "";
  var segredo = process.env.BRAVOPAY_WEBHOOK_SECRET || "";
  var token = process.env.META_CAPI_TOKEN || "";
  var dataset = process.env.META_DATASET_ID || "";

  return res.status(200).json({
    ok: true,
    bravopay: {
      chave: {
        presente: Boolean(chave),
        tamanho: chave.length,
        prefixo: chave.slice(0, 8),
        comEspacoOuQuebra: /\s/.test(chave)
      },
      webhook: {
        presente: Boolean(segredo),
        tamanho: segredo.length,
        prefixo: segredo.slice(0, 6)
      }
    },
    meta: {
      dataset: dataset,
      token: {
        presente: Boolean(token),
        tamanho: token.length,
        prefixo: token.slice(0, 6)
      }
    },

    /* Ajuda a descobrir nome errado: lista os nomes das variaveis da
       loja, sem nenhum valor. O filtro precisa cobrir TODOS os
       prefixos — ja me enganei procurando so por BRAVO e concluindo
       que as do Meta nao existiam. */
    nomesEncontrados: Object.keys(process.env)
      .filter(function(k){ return /^(BRAVOPAY|META|APPMAX)_/.test(k.toUpperCase()); })
      .sort()
  });
};
