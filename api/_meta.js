/* ============================================================
   META — API de Conversoes (server-side)

   Envia a COMPRA direto do nosso servidor para o Meta, sem passar
   pelo navegador. Bloqueador de anuncio, modo anonimo e as
   restricoes do iPhone derrubam boa parte dos eventos do lado do
   cliente — e a compra e justamente o evento que o Meta usa para
   otimizar a entrega. Evento de compra perdido vira anuncio mal
   direcionado e dinheiro gasto a toa.

   Variaveis de ambiente:
     META_DATASET_ID      id do conjunto de dados (o mesmo do pixel)
     META_CAPI_TOKEN      token da API de Conversoes — SEGREDO
     META_TEST_EVENT_CODE opcional, so enquanto voce valida no
                          Gerenciador de Eventos

   O token nunca sai daqui. Se ele aparecer em qualquer arquivo
   dentro de js/ ou no HTML, esta errado.
   ============================================================ */

var crypto = require("crypto");

var VERSAO = "v21.0";

/* O Meta exige os dados pessoais em SHA-256, nunca em claro.
   Normalizar antes e obrigatorio: "Maria@Email.com " e
   "maria@email.com" precisam gerar o mesmo hash, senao o Meta nao
   reconhece a mesma pessoa e a atribuicao do anuncio se perde. */
function hash(valor){
  if (!valor) return undefined;
  var limpo = String(valor).trim().toLowerCase();
  if (!limpo) return undefined;
  return crypto.createHash("sha256").update(limpo, "utf8").digest("hex");
}

function soNumeros(v){
  return String(v || "").replace(/\D/g, "");
}

/* Telefone o Meta quer com o codigo do pais e sem sinais: um
   numero brasileiro vira 5519982428797. Sem o 55 na frente, ele
   trata como outro pais e a correspondencia falha. */
function hashTelefone(tel){
  var n = soNumeros(tel);
  if (!n) return undefined;
  if (n.length <= 11) n = "55" + n;
  return hash(n);
}

function configurado(){
  return Boolean(process.env.META_DATASET_ID && process.env.META_CAPI_TOKEN);
}

/* Monta e envia o evento de compra.

   Falhar aqui NAO pode derrubar nada: o dinheiro ja entrou, o
   pedido ja existe. Um erro de rastreamento vira aviso no log e a
   vida segue. Por isso a funcao nunca lanca. */
async function enviarCompra(dados){
  if (!configurado()){
    console.warn("[meta] META_DATASET_ID/META_CAPI_TOKEN nao configurados — evento nao enviado");
    return { enviado: false, motivo: "nao configurado" };
  }

  var usuario = {};

  if (dados.email)    usuario.em = [hash(dados.email)];
  if (dados.telefone) usuario.ph = [hashTelefone(dados.telefone)];
  if (dados.nome){
    var partes = String(dados.nome).trim().split(/\s+/);
    if (partes[0]) usuario.fn = [hash(partes[0])];
    if (partes.length > 1) usuario.ln = [hash(partes[partes.length - 1])];
  }
  if (dados.cidade) usuario.ct = [hash(String(dados.cidade).replace(/\s/g, ""))];
  if (dados.uf)     usuario.st = [hash(dados.uf)];
  if (dados.cep)    usuario.zp = [hash(soNumeros(dados.cep))];
  usuario.country = [hash("br")];

  /* Estes dois nao sao hasheados — sao identificadores do
     navegador, e o Meta os usa para casar com quem viu o anuncio.
     Quando existem, a atribuicao fica muito melhor. */
  if (dados.fbp) usuario.fbp = dados.fbp;
  if (dados.fbc) usuario.fbc = dados.fbc;
  if (dados.ip)  usuario.client_ip_address = dados.ip;
  if (dados.userAgent) usuario.client_user_agent = dados.userAgent;

  var evento = {
    event_name: "Purchase",
    event_time: Math.floor((dados.quando ? new Date(dados.quando).getTime() : Date.now()) / 1000),
    action_source: "website",
    event_source_url: dados.url || "https://navyabeauty.com/checkout",
    user_data: usuario,
    custom_data: {
      currency: "BRL",
      value: Number((dados.centavos / 100).toFixed(2)),
      content_type: "product",
      order_id: dados.pedido
    }
  };

  /* O mesmo id usado no navegador. E o que impede a compra de ser
     contada duas vezes quando os dois caminhos funcionam. */
  if (dados.eventId) evento.event_id = dados.eventId;

  var corpo = { data: [evento] };
  if (process.env.META_TEST_EVENT_CODE){
    corpo.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  var url = "https://graph.facebook.com/" + VERSAO + "/" +
            process.env.META_DATASET_ID + "/events?access_token=" +
            encodeURIComponent(process.env.META_CAPI_TOKEN);

  try {
    var r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    });

    var texto = await r.text();
    var resposta;
    try { resposta = JSON.parse(texto); } catch (e) { resposta = { _cru: texto.slice(0, 300) }; }

    if (!r.ok){
      console.error("[meta] recusou o evento (" + r.status + "): " +
                    JSON.stringify(resposta).slice(0, 400));
      return { enviado: false, motivo: "http " + r.status };
    }

    console.log("[meta] compra enviada — pedido " + dados.pedido +
                ", recebidos: " + (resposta.events_received || "?"));
    return { enviado: true, resposta: resposta };

  } catch (e) {
    console.error("[meta] falha de rede ao enviar o evento:", e.message);
    return { enviado: false, motivo: "rede" };
  }
}

module.exports = {
  enviarCompra: enviarCompra,
  configurado: configurado,
  hash: hash,
  hashTelefone: hashTelefone
};
