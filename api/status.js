/* ============================================================
   GET /api/status?pedido=NVXXXXXX

   A tela do Pix pergunta aqui, de tempos em tempos, se o pagamento
   caiu. Devolve so o status — nenhum dado pessoal, nenhum valor,
   nada que sirva a quem ficar tentando numeros de pedido.
   ============================================================ */

var bravo = require("./_bravopay.js");

/* O BravoPay usa PENDING / PAID / EXPIRED / REFUNDED. */
var PAGO  = ["PAID"];
var MORTO = ["EXPIRED", "REFUNDED", "CHARGEBACK", "FAILED"];

module.exports = async function handler(req, res){
  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  var numero = String((req.query && req.query.pedido) || "").trim();

  /* O formato e NV + base36 maiusculo. Barrar aqui evita ida a API
     por qualquer coisa digitada na barra de endereco. */
  if (!/^NV[A-Z0-9]{6,20}$/.test(numero)){
    return res.status(400).json({ ok: false, erro: "Pedido inválido." });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    var r = await bravo.consultarPorReferencia(numero);
    var lista = (r && r.data) || [];

    if (!lista.length){
      return res.status(200).json({ ok: true, status: "NAO_ENCONTRADO", pago: false });
    }

    /* Se houver mais de uma cobranca com a mesma referencia (uma
       repeticao que virou duas), vale a que foi paga. */
    var tx = lista.filter(function(t){ return PAGO.indexOf(String(t.status).toUpperCase()) > -1; })[0]
             || lista[0];
    var status = String(tx.status || "").toUpperCase();

    return res.status(200).json({
      ok: true,
      status: status,
      pago: PAGO.indexOf(status) > -1,
      encerrado: MORTO.indexOf(status) > -1
    });

  } catch (e) {
    /* Falha de consulta nao pode virar "nao pago" na cara do cliente:
       a tela continua esperando e pergunta de novo daqui a pouco. */
    console.error("[status]", e.detalhe || e.message);
    return res.status(200).json({ ok: false, status: "DESCONHECIDO", pago: false });
  }
};
