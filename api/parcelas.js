/* ============================================================
   GET /api/parcelas?total=5890

   Devolve as opcoes de parcelamento COM JUROS, do jeito que a
   Appmax cobra desta loja. Serve so para MOSTRAR na tela.

   Nao ha risco em receber o total pelo parametro: quem cobra e
   /api/checkout, e la o total e recalculado do zero a partir da
   sacola. Aqui e uma calculadora de taxas, nada mais.
   ============================================================ */

var appmax = require("./_appmax.js");
var precos = require("./_precos.js");

var TETO = 200000;   /* R$ 2.000: acima disso e chamada sem proposito */

module.exports = async function handler(req, res){
  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  var total = Number((req.query && req.query.total) || 0);
  if (!Number.isInteger(total) || total < 100 || total > TETO){
    return res.status(400).json({ ok: false, erro: "Total inválido." });
  }

  try {
    var opcoes = await appmax.consultarParcelas(total, precos.PARCELAS_MAX);

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ ok: true, total: total, opcoes: opcoes });

  } catch (e) {
    console.error("[parcelas]", e.detalhe || e.message);

    /* Se a consulta falhar, devolvemos so a vista. E melhor a pessoa
       ver uma opcao a menos do que ver uma parcela calculada com
       juros chutados — o valor cobrado tem que ser o que ela viu. */
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      total: total,
      parcial: true,
      opcoes: [{ parcelas: 1, total: total, valorParcela: total, juros: 0 }]
    });
  }
};
