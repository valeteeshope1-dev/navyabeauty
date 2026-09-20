/* ============================================================
   POST /api/checkout
   Recebe a sacola e os dados do cliente, REFAZ a conta do total por
   conta propria e cria a cobranca Pix no BravoPay.

   Corpo esperado:
   {
     itens:    [{ cor:"Branco", qtd:2 }],
     cliente:  { nome, email, cpf, tel },
     endereco: { cep, rua, numero, compl, bairro, cidade, uf }
   }

   So Pix. Cartao no BravoPay sai 9,90% + R$ 3,60 com retencao de
   90 dias — inviavel para o ticket desta loja.
   ============================================================ */

var bravo   = require("./_bravopay.js");
var qr      = require("./_qr.js");
var precos  = require("./_precos.js");
var validar = require("./_validar.js");

async function lerCorpo(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string"){
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  var cru = "";
  for await (var pedaco of req) cru += pedaco;
  try { return cru ? JSON.parse(cru) : {}; } catch (e) { return {}; }
}

/* O numero do pedido é NOSSO, nao do gateway. Ele vira o
   external_reference no BravoPay e e por ele que consultamos o
   pagamento depois — o id interno deles nunca precisa circular pelo
   navegador. Formato: NV + tempo em base36 + 3 caracteres ao acaso,
   curto o bastante para o cliente ditar por telefone. */
function novoNumero(){
  var tempo = Date.now().toString(36).toUpperCase();
  var acaso = Math.random().toString(36).slice(2, 5).toUpperCase();
  return "NV" + tempo + acaso;
}

/* Tudo o que precisa sobreviver ate o webhook viaja aqui.

   Endereco, porque o BravoPay e gateway de cobranca e nao guarda
   para onde enviar. E os dados do Meta, porque quando o pagamento
   confirma — horas depois, num outro processo — nao existe mais
   navegador para perguntar de qual anuncio veio a venda.

   O limite deles e 20 chaves; usamos 12. Valores curtos, porque
   metadata nao e lugar de texto longo. */
function montarMetadata(dados, pedido, meta){
  meta = meta || {};

  var m = {
    cep: dados.endereco.postcode,
    rua: dados.endereco.street,
    numero: dados.endereco.number,
    complemento: dados.endereco.complement || "",
    bairro: dados.endereco.district,
    cidade: dados.endereco.city,
    uf: dados.endereco.state,
    itens: pedido.produtos.map(function(p){
      return p.quantity + "x " + p.name;
    }).join(" | ").slice(0, 200)
  };

  if (meta.eventId) m.meta_event_id = String(meta.eventId).slice(0, 80);
  if (meta.fbp)     m.meta_fbp = String(meta.fbp).slice(0, 120);
  if (meta.fbc)     m.meta_fbc = String(meta.fbc).slice(0, 200);
  if (meta.url)     m.meta_url = String(meta.url).slice(0, 200);

  return m;
}

/* Os UTMs vem do navegador, entao nao sao confiaveis: alguem pode
   chamar a rota direto com o que quiser. Nao da para "validar" a
   origem de uma visita, mas da para limitar o estrago — so os
   campos conhecidos, texto curto, sem objeto aninhado. */
var CAMPOS_UTM = ["source", "medium", "campaign", "content", "term", "fbclid", "ttclid", "gclid"];

function limparUtm(bruto){
  if (!bruto || typeof bruto !== "object") return null;

  var limpo = {};
  CAMPOS_UTM.forEach(function(campo){
    var v = bruto[campo];
    if (typeof v === "string" && v.trim()){
      limpo[campo] = v.trim().slice(0, 200);
    }
  });

  return Object.keys(limpo).length ? limpo : null;
}

module.exports = async function handler(req, res){
  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  var corpo = await lerCorpo(req);
  var dados, pedido;

  /* --- 1. Conferencia: nada passa daqui sem estar valido ----- */
  try {
    dados  = validar.conferirDados(corpo);
    pedido = precos.conferirPedido(corpo.itens);
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message });
  }

  var numero = novoNumero();

  try {
    /* --- 2. Cobranca Pix ----------------------------------- */
    var tx = await bravo.criarPix({
      centavos: pedido.total,
      referencia: numero,
      descricao: precos.PRODUTO_NOME + " — " + pedido.unidades +
                 (pedido.unidades > 1 ? " unidades" : " unidade"),
      cliente: {
        nome: dados.cliente.first_name + " " + dados.cliente.last_name,
        email: dados.cliente.email,
        cpf: dados.cliente.document_number,
        telefone: dados.cliente.phone
      },
      /* O endereco de entrega viaja aqui. O BravoPay e um gateway de
         cobranca, nao um sistema de pedidos: se nao guardarmos o
         endereco junto da transacao, a venda chega sem saber para
         onde enviar. A documentacao garante que metadata volta
         intacta no webhook e na consulta. */
      metadata: montarMetadata(dados, pedido, corpo.meta),

      /* O que a UTMify precisa para atribuir a venda ao anuncio. */
      utm: limparUtm(corpo.utm),
      produtoId: process.env.BRAVOPAY_PRODUCT_ID || null
    });

    var emv = tx && tx.pix && tx.pix.copy_paste;
    if (!emv){
      throw new bravo.ErroBravo(
        "O Pix não foi gerado. Tente novamente.", 502,
        "resposta sem copy_paste: " + JSON.stringify(tx).slice(0, 300)
      );
    }

    /* --- 3. Desenho do QR ----------------------------------- */
    var svg = "";
    try {
      svg = qr.gerarSvg(emv);
    } catch (e) {
      /* Sem a imagem, o copia-e-cola ainda resolve a compra. Falhar
         a venda inteira por causa do desenho seria desproporcional. */
      console.error("[checkout] falha ao gerar o QR:", e.message);
    }

    console.log("[checkout] pedido " + numero + " criado — " +
                pedido.total + " centavos, tx " + (tx.id || "?"));

    return res.status(200).json({
      ok: true,
      pedido: { numero: numero, id: tx.id },
      total: pedido.total,
      pix: {
        svg: svg,
        emv: emv,
        expiraEm: tx.pix.expires_at || ""
      }
    });

  } catch (e) {
    console.error("[checkout]", e.detalhe || e.stack || e.message);
    var codigo = e.status && e.status >= 400 && e.status < 500 ? 400 : 502;
    return res.status(codigo).json({
      ok: false,
      erro: e.message || "Não foi possível concluir o pedido."
    });
  }
};
