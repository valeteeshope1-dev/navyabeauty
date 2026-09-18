/* ============================================================
   POST /api/checkout
   O coracao do pagamento. Recebe a sacola e os dados do cliente,
   REFAZ a conta do total por conta propria e executa o fluxo da
   Appmax: cliente -> pedido -> pagamento.

   Corpo esperado:
   {
     itens:     [{ cor:"Branco", qtd:2 }],
     cliente:   { nome, email, cpf, tel },
     endereco:  { cep, rua, numero, compl, bairro, cidade, uf },
     pagamento: "pix" | "cartao",
     ip:        "1.2.3.4",                  // vem do appmax.js
     cartao:    { token, parcelas, titular } // so quando for cartao
   }
   ============================================================ */

var appmax   = require("./_appmax.js");
var precos   = require("./_precos.js");
var validar  = require("./_validar.js");

var PARCELAS_MAX = 12;

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
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  var corpo = await lerCorpo(req);
  var dados, pedido;

  /* --- 1. Conferencia: nada sai daqui sem estar valido -------- */
  try {
    dados  = validar.conferirDados(corpo);
    pedido = precos.conferirPedido(corpo.itens);
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message });
  }

  var forma = corpo.pagamento === "cartao" ? "cartao" : "pix";
  var ip = validar.ipDoCliente(req, corpo.ip);

  var parcelas = 1;
  var tokenCartao = null;

  if (forma === "cartao"){
    tokenCartao = corpo.cartao && corpo.cartao.token;

    /* Sem token, so aceitamos o cartao cru no SANDBOX, para dar para
       testar antes de existir o external_id do appmax.js. Em producao
       isso e bloqueado: numero de cartao no nosso servidor exigiria
       certificacao PCI-DSS. */
    if (!tokenCartao && corpo.cartao && corpo.cartao.numero){
      if (appmax.ambiente().nome !== "sandbox"){
        return res.status(400).json({ ok: false, erro: "Não foi possível processar o cartão." });
      }
      try {
        var t = await appmax.tokenizarCartao({
          number: String(corpo.cartao.numero).replace(/\D/g, ""),
          cvv: String(corpo.cartao.cvv || ""),
          expiration_month: String(corpo.cartao.mes || ""),
          expiration_year: String(corpo.cartao.ano || ""),
          holder_name: String(corpo.cartao.titular || "").trim()
        });
        tokenCartao = t && t.token;
      } catch (e) {
        console.error("[checkout] tokenizacao", e.detalhe || e.message);
        return res.status(400).json({ ok: false, erro: e.message || "Dados do cartão inválidos." });
      }
    }

    if (!tokenCartao){
      return res.status(400).json({ ok: false, erro: "Preencha os dados do cartão." });
    }
    parcelas = Number(corpo.cartao.parcelas) || 1;
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > PARCELAS_MAX){
      return res.status(400).json({ ok: false, erro: "Número de parcelas inválido." });
    }
  }

  try {
    /* --- 2. Cliente ------------------------------------------ */
    var respCliente = await appmax.criarCliente({
      first_name: dados.cliente.first_name,
      last_name:  dados.cliente.last_name,
      email:      dados.cliente.email,
      phone:      dados.cliente.phone,
      document_number: dados.cliente.document_number,
      ip: ip,
      address: dados.endereco,
      products: pedido.produtos
    });

    var customerId = respCliente && respCliente.customer && respCliente.customer.id;
    if (!customerId) throw new appmax.ErroAppmax(
      "Não foi possível registrar seus dados.", 502,
      "resposta sem customer.id: " + JSON.stringify(respCliente).slice(0, 300)
    );

    /* --- 3. Pedido ------------------------------------------- */
    var respPedido = await appmax.criarPedido({
      customer_id: customerId,
      products: pedido.produtos,
      products_value: pedido.produtos_valor,
      shipping_value: pedido.frete,
      discount_value: pedido.desconto
    });

    var orderId = respPedido && respPedido.order && respPedido.order.id;
    if (!orderId) throw new appmax.ErroAppmax(
      "Não foi possível criar seu pedido.", 502,
      "resposta sem order.id: " + JSON.stringify(respPedido).slice(0, 300)
    );

    /* --- 4. Pagamento ---------------------------------------- */
    if (forma === "pix"){
      var respPix = await appmax.pagarPix({
        order_id: orderId,
        payment_data: { pix: { document_number: dados.cliente.document_number } }
      });

      var pix = normalizarPix(respPix);
      if (!pix.emv) throw new appmax.ErroAppmax(
        "O Pix não foi gerado. Tente novamente.", 502,
        "resposta pix sem codigo: " + JSON.stringify(respPix).slice(0, 300)
      );

      return res.status(200).json({
        ok: true,
        forma: "pix",
        pedido: { id: orderId, status: (respPix.order && respPix.order.status) || "pendente" },
        total: pedido.total,
        pix: pix
      });
    }

    var respCartao = await appmax.pagarCartao({
      order_id: orderId,
      customer_id: customerId,
      payment_data: {
        credit_card: {
          token: String(tokenCartao),
          holder_document_number: dados.cliente.document_number,
          holder_name: String(corpo.cartao.titular || "").trim()
            || (dados.cliente.first_name + " " + dados.cliente.last_name),
          installments: parcelas,
          soft_descriptor: "NAVYA"
        }
      }
    });

    /* A resposta do pagamento NAO traz o status do pedido — traz
       pay_reference e upsell_hash. Quem recusa devolve 403, entao
       chegar aqui ja significa cobranca aceita. Confirmamos o
       status consultando o pedido, e se a consulta falhar valemos
       o que a propria resposta 200 significa. */
    var status = (respCartao.order && respCartao.order.status) || "";

    if (!status){
      try {
        var conferencia = await appmax.consultarPedido(orderId);
        status = (conferencia && conferencia.order && conferencia.order.status) || "aprovado";
      } catch (e) {
        console.error("[checkout] consulta pos-pagamento falhou:", e.detalhe || e.message);
        status = "aprovado";
      }
    }

    var recusados = ["cancelado", "estornado", "reprovado"];

    return res.status(200).json({
      ok: true,
      forma: "cartao",
      pedido: { id: orderId, status: status },
      total: pedido.total,
      pagamento: {
        aprovado: recusados.indexOf(String(status).toLowerCase()) === -1,
        parcelas: parcelas,
        status: status
      }
    });

  } catch (e) {
    /* O detalhe fica no log do Vercel; o cliente ve so a frase. */
    console.error("[checkout]", e.detalhe || e.stack || e.message);
    var codigo = e.status && e.status >= 400 && e.status < 500 ? 400 : 502;
    return res.status(codigo).json({
      ok: false,
      erro: e.message || "Não foi possível concluir o pagamento."
    });
  }
};

/* A documentacao mostra o Pix em dois formatos diferentes
   (data.payment.pix_* na referencia, data.pix.* no guia).
   Aceitamos os dois para nao quebrar se a API variar. */
function normalizarPix(resp){
  var p = resp.payment || {};
  var alt = resp.pix || {};
  var qr = p.pix_qrcode || alt.qr_code || "";

  return {
    qrcode: qr ? (qr.indexOf("data:") === 0 ? qr : "data:image/png;base64," + qr) : "",
    emv: p.pix_emv || alt.emv_code || "",
    expiraEm: p.pix_expiration_date || alt.expires_at || ""
  };
}
