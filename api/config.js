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
    /* Ajuda a descobrir nome errado: lista os nomes de variaveis que
       comecam com BRAVO, sem nenhum valor. */
    nomesEncontrados: Object.keys(process.env)
      .filter(function(k){ return k.toUpperCase().indexOf("BRAVO") > -1; })
      .sort()
  });
};
