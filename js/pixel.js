/* ============================================================
   META PIXEL — Navya Beauty

   O ID do conjunto de dados e publico: ele aparece no codigo-fonte
   de qualquer loja que use o pixel. O que NUNCA pode aparecer aqui
   e o token da API de Conversoes — esse vive no servidor, em
   api/_meta.js.

   Divisao de trabalho entre os dois lados:

     navegador (este arquivo)  PageView, ViewContent, AddToCart,
                               InitiateCheckout
     servidor  (api/_meta.js)  Purchase

   A compra e enviada pelo servidor de proposito. Bloqueador de
   anuncio, modo anonimo e as restricoes do iPhone derrubam boa
   parte dos eventos do navegador — e justamente a compra e o
   evento que o Meta usa para otimizar a entrega dos anuncios.
   Perder compra significa treinar o algoritmo com dado errado.
   ============================================================ */

var PIXEL_ID = "1625440688993541";

(function(f, b, e, v, n, t, s){
  if (f.fbq) return;
  n = f.fbq = function(){
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  t = b.createElement(e);
  t.async = true;
  t.src = v;
  s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

fbq("init", PIXEL_ID);
fbq("track", "PageView");

/* --- Identificador de evento ---------------------------------
   O mesmo evento pode chegar ao Meta pelos dois caminhos (aqui e
   pelo servidor). Sem um identificador em comum, ele conta duas
   vezes e o seu custo por compra aparece pela metade — numero
   bonito e mentiroso, que leva a decisao errada de investimento.

   Este id viaja junto do pedido ate o servidor, que o reenvia no
   Purchase. O Meta compara e junta os dois numa compra so.
   ------------------------------------------------------------- */
function novoEventId(){
  return "nv-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

/* --- Eventos da loja ---------------------------------------- */

function pixelVerProduto(nome, valor){
  if (!window.fbq) return;
  fbq("track", "ViewContent", {
    content_name: nome,
    content_type: "product",
    value: valor,
    currency: "BRL"
  });
}

function pixelAdicionarCarrinho(nome, valor, quantidade){
  if (!window.fbq) return;
  fbq("track", "AddToCart", {
    content_name: nome,
    content_type: "product",
    contents: [{ id: "escova-navya", quantity: quantidade }],
    value: valor,
    currency: "BRL"
  });
}

function pixelIniciarCheckout(valor, quantidade){
  if (!window.fbq) return;
  fbq("track", "InitiateCheckout", {
    content_type: "product",
    num_items: quantidade,
    value: valor,
    currency: "BRL"
  });
}

/* Disparado quando o Pix e gerado — ainda nao e compra, e intencao
   firme. Serve para o Meta aprender com quem chegou ate aqui mesmo
   sem pagar. A compra de verdade sai do servidor. */
function pixelPixGerado(valor, eventId){
  if (!window.fbq) return;
  fbq("track", "AddPaymentInfo", {
    value: valor,
    currency: "BRL"
  }, { eventID: eventId });
}

/* ============================================================
   UTMs — de onde veio a visita

   O checkout hospedado do BravoPay captura os UTMs da URL sozinho.
   O nosso nao: a documentacao deles e explicita — na API, quem
   manda os UTMs em cada cobranca somos nos, e "sem isso a venda
   aparece na UTMify SEM origem".

   O problema pratico: a pessoa chega pelo anuncio em
   navyabeauty.com/?utm_source=fb&utm_campaign=..., navega ate o
   produto, vai para o checkout — e la a URL nao tem mais UTM
   nenhum. Por isso guardamos no navegador assim que ela chega.

   Guardamos por 30 dias: alguem que clicou no anuncio hoje e
   comprou depois de pensar uma semana veio daquele anuncio, e a
   campanha merece o credito.
   ============================================================ */

var CHAVE_UTM = "navya_utm";
var UTM_DIAS = 30;

var CAMPOS_UTM = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "ttclid", "gclid"
];

function capturarUtm(){
  var url = new URLSearchParams(location.search);
  var achou = {};
  var temAlgum = false;

  CAMPOS_UTM.forEach(function(campo){
    var v = url.get(campo);
    if (v){ achou[campo] = v; temAlgum = true; }
  });

  /* Sem UTM na URL, nao apaga o que ja estava guardado: a pessoa
     pode estar navegando entre as paginas da loja. */
  if (!temAlgum) return;

  achou._quando = Date.now();

  try { localStorage.setItem(CHAVE_UTM, JSON.stringify(achou)); } catch (e) {}
}

/* Devolve no formato que o BravoPay espera: sem o prefixo utm_ nos
   cinco primeiros, e os ids de clique com o nome cheio. */
function lerUtm(){
  var bruto = null;
  try { bruto = JSON.parse(localStorage.getItem(CHAVE_UTM) || "null"); } catch (e) {}
  if (!bruto) return null;

  var idade = Date.now() - (bruto._quando || 0);
  if (idade > UTM_DIAS * 24 * 60 * 60 * 1000) return null;

  var saida = {};
  if (bruto.utm_source)   saida.source   = bruto.utm_source;
  if (bruto.utm_medium)   saida.medium   = bruto.utm_medium;
  if (bruto.utm_campaign) saida.campaign = bruto.utm_campaign;
  if (bruto.utm_content)  saida.content  = bruto.utm_content;
  if (bruto.utm_term)     saida.term     = bruto.utm_term;
  if (bruto.fbclid)       saida.fbclid   = bruto.fbclid;
  if (bruto.ttclid)       saida.ttclid   = bruto.ttclid;
  if (bruto.gclid)        saida.gclid    = bruto.gclid;

  return Object.keys(saida).length ? saida : null;
}

capturarUtm();
