/* ============================================================
   POST /api/webhook

   O BravoPay avisa aqui quando a cobranca muda de estado. E o unico
   jeito confiavel de saber que o Pix foi pago: o cliente pode pagar
   e fechar a aba antes de a tela perceber.

   Cadastre em Dashboard → Integracoes:
       https://navyabeauty.com/api/webhook

   Cada URL cadastrada recebe um segredo proprio (whsec_...). Guarde
   esse valor em BRAVOPAY_WEBHOOK_SECRET: e com ele que a assinatura
   e conferida. Sem o segredo configurado, o endpoint recusa tudo —
   aceitar avisos de "pedido pago" sem verificar seria pedir para
   alguem forjar vendas.

   Regra da casa: responder 200 em menos de 5 segundos, senao eles
   reenviam. Por isso respondemos primeiro e processamos depois.
   ============================================================ */

var bravo = require("./_bravopay.js");
var meta  = require("./_meta.js");

/* O corpo tem que ser lido CRU, byte a byte: a assinatura e
   calculada sobre a string exata que eles enviaram. Um JSON.parse
   seguido de JSON.stringify muda espacos e ordem de chaves, e a
   conferencia passa a falhar sempre. */
async function corpoCru(req){
  if (typeof req.body === "string") return req.body;

  /* A Vercel ja entrega req.body pronto em objeto quando o
     Content-Type e JSON — e ai o cru se perdeu. Nesse caso
     reserializamos, sabendo que a assinatura pode nao bater; o
     ideal e ler do stream, que e o caminho abaixo. */
  if (req.body && typeof req.body === "object"){
    return { texto: JSON.stringify(req.body), reserializado: true };
  }

  var cru = "";
  for await (var pedaco of req) cru += pedaco;
  return { texto: cru, reserializado: false };
}

var INTERESSAM = [
  "transaction.paid",
  "transaction.expired",
  "transaction.refunded",
  "transaction.chargeback",
  "transaction.failed"
];

module.exports = async function handler(req, res){
  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }

  var segredo = process.env.BRAVOPAY_WEBHOOK_SECRET;
  if (!segredo){
    console.error("[webhook] BRAVOPAY_WEBHOOK_SECRET nao configurado — recusando");
    return res.status(503).json({ ok: false });
  }

  var lido = await corpoCru(req);
  var texto = typeof lido === "string" ? lido : lido.texto;
  var reserializado = typeof lido === "string" ? false : lido.reserializado;

  var cabecalho = req.headers["bravopay-signature"] ||
                  req.headers["x-bravopay-signature"] || "";

  var assinado = bravo.assinaturaValida(texto, cabecalho, segredo);

  /* Quando o corpo chega ja convertido em objeto, o texto cru se
     perdeu e a assinatura pode falhar mesmo vindo do BravoPay — um
     espaco a mais no JSON original basta. Perder o aviso de "pago"
     e pior do que parece: o cliente paga, fecha a aba, e a venda
     fica pendente para sempre.

     Entao, nesse caso especifico, em vez de confiar OU descartar,
     perguntamos a propria API com as nossas credenciais. Se ela
     disser que esta pago, o evento e legitimo — nao importa quem o
     enviou. Se nao disser, cai fora. Ninguem forja venda assim. */
  if (!assinado && reserializado){
    var conferido = false;
    try {
      var evt = JSON.parse(texto);
      var ref = evt && evt.data && evt.data.external_reference;

      if (ref){
        var r = await bravo.consultarPorReferencia(ref);
        var lista = (r && r.data) || [];
        conferido = lista.some(function(t){
          return String(t.status).toUpperCase() === "PAID";
        });
      }
    } catch (e) {
      console.error("[webhook] falha ao conferir na API:", e.message);
    }

    if (conferido){
      console.warn("[webhook] assinatura nao bateu (corpo reserializado), " +
                   "mas a API confirmou o pagamento — aceito");
      assinado = true;
    }
  }

  if (!assinado){
    console.warn("[webhook] assinatura invalida — recusado");
    return res.status(401).json({ ok: false });
  }

  /* Responde JA. O que vier depois nao pode segurar a resposta. */
  res.status(200).json({ ok: true });

  try {
    var evento = JSON.parse(texto);
    var tipo = evento.type || "desconhecido";
    var tx = evento.data || {};

    if (INTERESSAM.indexOf(tipo) === -1){
      console.log("[webhook] ignorado: " + tipo);
      return;
    }

    /* O id do evento e estavel entre reenvios: e por ele que se
       deduplica quando houver banco. Por enquanto vai para o log. */
    console.log("[webhook] " + JSON.stringify({
      evento_id: evento.id,
      tipo: tipo,
      pedido: tx.external_reference,
      transacao: tx.id,
      valor: tx.amount_cents,
      liquido: tx.net_cents,
      pago_em: tx.paid_at,
      entrega: tx.metadata || null
    }));

    /* --- Compra para o Meta ------------------------------------
       So em pagamento confirmado. Sai daqui, do servidor, e nao do
       navegador: aqui nao tem bloqueador de anuncio, nao tem aba
       fechada, nao tem restricao de iPhone. E este e o evento com
       que o Meta aprende a quem mostrar o anuncio.

       Se falhar, falhou o rastreamento — nao a venda. Por isso o
       enviarCompra nunca lanca. */
    if (tipo === "transaction.paid" && meta.configurado()){
      var m = tx.metadata || {};
      var c = tx.customer || {};

      await meta.enviarCompra({
        pedido: tx.external_reference,
        centavos: tx.amount_cents,
        quando: tx.paid_at,
        email: c.email,
        telefone: c.phone,
        nome: c.name,
        cidade: m.cidade,
        uf: m.uf,
        cep: m.cep,
        eventId: m.meta_event_id,
        fbp: m.meta_fbp,
        fbc: m.meta_fbc,
        url: m.meta_url
      });
    }

  } catch (e) {
    console.error("[webhook] falha ao processar:", e.message);
  }
};
