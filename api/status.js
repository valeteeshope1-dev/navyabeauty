/* ============================================================
   GET /api/status?pedido=123
   A tela do Pix chama isto de tempos em tempos para saber se
   o pagamento caiu. Devolve so o status — nenhum dado pessoal,
   porque o id do pedido e um numero adivinhavel.
   ============================================================ */

var appmax = require("./_appmax.js");

var PAGOS = ["aprovado", "pago", "integrado", "autorizado"];

module.exports = async function handler(req, res){
  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  var id = (req.query && req.query.pedido) || "";
  if (!/^\d+$/.test(String(id))){
    return res.status(400).json({ ok: false, erro: "Pedido inválido." });
  }

  try {
    var resp = await appmax.consultarPedido(id);
    var status = (resp && resp.order && resp.order.status) || "pendente";

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      status: status,
      pago: PAGOS.indexOf(String(status).toLowerCase()) > -1
    });
  } catch (e) {
    console.error("[status]", e.detalhe || e.message);
    return res.status(200).json({ ok: false, status: "desconhecido", pago: false });
  }
};
