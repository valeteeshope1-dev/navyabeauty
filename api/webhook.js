/* ============================================================
   POST /api/webhook
   A Appmax avisa aqui quando o pedido muda de estado — e o unico
   jeito confiavel de saber que o Pix foi pago, porque o cliente
   pode fechar a aba antes.

   A Appmax NAO assina os webhooks (sem HMAC, sem token). Por isso
   protegemos pelo proprio endereco: cadastre a URL com o segredo,
     https://navyabeauty.com/api/webhook?k=SEU_SEGREDO
   e guarde o mesmo valor em APPMAX_WEBHOOK_SECRET.

   Regra da Appmax: responder 200 em ate 5 segundos, senao ela
   reenvia (4 tentativas e desiste). Entao respondemos primeiro
   e so depois processamos.
   ============================================================ */

var INTERESSAM = [
  "order_paid", "order_paid_by_pix", "order_approved",
  "order_pix_created", "order_pix_expired",
  "order_refund", "order_partial_refund",
  "order_refused_by_risk", "payment_not_authorized",
  "order_billet_overdue", "order_integrated"
];

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
  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }

  var segredo = process.env.APPMAX_WEBHOOK_SECRET;
  if (segredo && (!req.query || req.query.k !== segredo)){
    console.warn("[webhook] chamada sem o segredo correto");
    return res.status(401).json({ ok: false });
  }

  var corpo = await lerCorpo(req);

  /* Responde JA. O que vier depois nao pode segurar a resposta. */
  res.status(200).json({ ok: true });

  try {
    var evento = corpo.event || "desconhecido";
    var pedido = (corpo.data && corpo.data.order) || {};
    var cliente = (corpo.data && corpo.data.customer) || {};

    if (INTERESSAM.indexOf(evento) === -1){
      console.log("[webhook] ignorado:", evento);
      return;
    }

    /* Por enquanto o registro e o log do Vercel — da para acompanhar
       em Vercel > Logs. Quando houver banco ou e-mail de confirmacao,
       e aqui que entram. */
    console.log("[webhook]", JSON.stringify({
      evento: evento,
      pedido: pedido.id,
      status: pedido.status,
      total_pago: pedido.total_paid,
      cliente: cliente.email
    }));
  } catch (e) {
    console.error("[webhook] falha ao processar:", e.message);
  }
};
