/* ============================================================
   Teste do fluxo Appmax no SANDBOX, sem navegador e sem deploy.

   Uso:  node scripts/testar-appmax.js           (Pix)
         node scripts/testar-appmax.js cartao    (cartao aprovado)
         node scripts/testar-appmax.js recusado  (cartao recusado)

   Le as credenciais de .env.local (que fica fora do Git).
   ============================================================ */

var fs   = require("fs");
var path = require("path");

/* --- .env.local: um "CHAVE=valor" por linha ----------------- */
(function carregarEnv(){
  var arq = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(arq)){
    console.error("\n  Falta o arquivo .env.local na pasta do projeto.\n");
    console.error("  Crie com este conteudo (sem aspas):\n");
    console.error("    APPMAX_CLIENT_ID=seu_client_id");
    console.error("    APPMAX_CLIENT_SECRET=seu_client_secret");
    console.error("    APPMAX_ENV=sandbox\n");
    process.exit(1);
  }
  fs.readFileSync(arq, "utf8").split(/\r?\n/).forEach(function(linha){
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
})();

var appmax  = require("../api/_appmax.js");
var precos  = require("../api/_precos.js");
var validar = require("../api/_validar.js");

var CARTOES = {
  cartao:   { numero: "4000000000000010", rotulo: "aprovado e capturado" },
  recusado: { numero: "4000000000000002", rotulo: "recusado pelo emissor" }
};

var modo = (process.argv[2] || "pix").toLowerCase();

/* Cliente ficticio. O CPF e valido no digito verificador —
   sem isso a propria validacao do checkout barra antes da API. */
var ENTRADA = {
  itens: [{ cor: "Branco", qtd: 2 }],
  cliente: {
    nome: "Maria Teste Navya",
    email: "maria.teste+" + Date.now() + "@navyabeauty.com",
    cpf: "25226493029",
    tel: "51983655100"
  },
  endereco: {
    cep: "91520270", rua: "Rua Francisco Carneiro da Rocha", numero: "582",
    compl: "Casa", bairro: "Moinhos de Ventos", cidade: "Porto Alegre", uf: "RS"
  }
};

function passo(n, texto){ console.log("\n[" + n + "] " + texto); }
function brl(c){ return "R$ " + (c / 100).toFixed(2).replace(".", ","); }

(async function(){
  var amb = appmax.ambiente();
  console.log("\n===========================================");
  console.log("  TESTE APPMAX — ambiente: " + amb.nome.toUpperCase());
  console.log("  " + amb.api);
  console.log("  modo: " + modo);
  console.log("===========================================");

  if (amb.nome === "producao"){
    console.error("\n  PARE: APPMAX_ENV esta em producao. Este teste gera pedido real.");
    console.error("  Troque para sandbox no .env.local.\n");
    process.exit(1);
  }

  try {
    var dados  = validar.conferirDados(ENTRADA);
    var pedido = precos.conferirPedido(ENTRADA.itens);

    passo(1, "Conta do servidor");
    console.log("    " + pedido.unidades + " unidades  ->  " + brl(pedido.total));
    pedido.produtos.forEach(function(p){
      console.log("    " + p.quantity + "x " + p.name + " @ " + brl(p.unit_value));
    });

    passo(2, "Criando cliente");
    var rc = await appmax.criarCliente({
      first_name: dados.cliente.first_name,
      last_name:  dados.cliente.last_name,
      email:      dados.cliente.email,
      phone:      dados.cliente.phone,
      document_number: dados.cliente.document_number,
      ip: "127.0.0.1",
      address: dados.endereco,
      products: pedido.produtos
    });
    var customerId = rc.customer && rc.customer.id;
    console.log("    customer_id = " + customerId);

    passo(3, "Criando pedido");
    var rp = await appmax.criarPedido({
      customer_id: customerId,
      products: pedido.produtos,
      products_value: pedido.produtos_valor,
      shipping_value: pedido.frete,
      discount_value: pedido.desconto
    });
    var orderId = rp.order && rp.order.id;
    console.log("    order_id = " + orderId + "   status = " + (rp.order && rp.order.status));

    if (modo === "pix"){
      passo(4, "Gerando Pix");
      var rx = await appmax.pagarPix({
        order_id: orderId,
        payment_data: { pix: { document_number: dados.cliente.document_number } }
      });
      var p = rx.payment || rx.pix || {};
      var emv = p.pix_emv || p.emv_code || "";
      var qr  = p.pix_qrcode || p.qr_code || "";
      console.log("    copia-e-cola: " + (emv ? emv.slice(0, 60) + "..." : "(vazio!)"));
      console.log("    QR Code:      " + (qr ? qr.length + " caracteres em base64" : "(vazio!)"));
      console.log("    expira em:    " + (p.pix_expiration_date || p.expires_at || "?"));
    } else {
      var cartao = CARTOES[modo] || CARTOES.cartao;
      passo(4, "Tokenizando cartao " + cartao.numero + " (" + cartao.rotulo + ")");
      var rt = await appmax.tokenizarCartao({
        number: cartao.numero, cvv: "123",
        expiration_month: "12", expiration_year: "30",
        holder_name: dados.cliente.first_name + " " + dados.cliente.last_name
      });
      console.log("    token = " + rt.token);

      passo(5, "Cobrando no cartao");
      var rcc = await appmax.pagarCartao({
        order_id: orderId,
        customer_id: customerId,
        payment_data: {
          credit_card: {
            token: rt.token,
            holder_document_number: dados.cliente.document_number,
            holder_name: dados.cliente.first_name + " " + dados.cliente.last_name,
            installments: 1,
            soft_descriptor: "NAVYA"
          }
        }
      });
      console.log("    status do pedido = " + (rcc.order && rcc.order.status));
      console.log("    pagamento = " + JSON.stringify(rcc.payment || {}));
    }

    passo("fim", "Consultando o pedido");
    var rs = await appmax.consultarPedido(orderId);
    console.log("    status = " + (rs.order && rs.order.status));
    console.log("\n  OK — fluxo completo executou.\n");

  } catch (e) {
    console.error("\n  FALHOU: " + e.message);
    if (e.detalhe) console.error("  detalhe: " + e.detalhe);
    console.error("");
    process.exit(1);
  }
})();
