/* ============================================================
   NAVYA — nucleo da loja
   Fonte unica de precos e da sacola. Usado pelo produto.html
   e pelo checkout.html, para os dois nunca divergirem.

   ATENCAO: isto roda no navegador, entao serve para MOSTRAR
   valores. Quando o pagamento entrar (Appmax), o servidor
   precisa recalcular o total por conta propria — nunca
   confiar no numero que o navegador mandar.
   ============================================================ */

/* --- Tabela de precos: mexa so aqui ------------------------- */
var PRECO_CHEIO = 58.90;                          /* riscado, por unidade */
var TOTAIS      = { 1: 37.90, 2: 58.90, 3: 84.90 };
var UNIT_ACIMA  = 22.95;                          /* a partir de 4 unidades */
var QTD_MAX     = 99;
var PARCELAS    = 3;    /* teto de parcelas: espelha PARCELAS_MAX em api/_precos.js */

/* --- Cores reais do produto -------------------------------- */
var CORES_HEX = { "Branco":"#f2f1f3", "Verde":"#ade1d4", "Rosa":"#f8a0aa" };
var COR_PADRAO = "Branco";
var FOTO_ITEM = "./img/desc-cores.jpg";

var PRODUTO_NOME = "Escova Mágica Retrátil Premium";

/* --- Order bump: oferta que so aparece dentro da sacola ------
   O preco tambem vive em api/_precos.js. Mexeu aqui, mexa la:
   se divergirem, o cliente ve um valor e paga outro. */
var BUMP = {
  sku:  "NAVYA-TOUCA-CETIM-3",
  nome: "Touca de Cetim Antifrizz",
  kit:  "Kit 3 und",
  desc: "Dupla face, para dormir e para o banho",
  de:   49.90,
  por:  26.90,
  foto: "./img/bump-touca.jpg"
};

/* Parcelamento COM JUROS: quem manda na conta e a tabela da
   Appmax, consultada em /api/parcelas. O valor calculado aqui e
   so um provisorio para a tela nao nascer vazia — assim que a
   consulta responde, ele e substituido pelo valor real. */

/* --- Calculo ------------------------------------------------ */
function precoTotal(q){
  return TOTAIS[q] !== undefined ? TOTAIS[q] : UNIT_ACIMA * q;
}

function brl(v){
  var p = v.toFixed(2).split(".");
  return "R$ " + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + p[1];
}

/* --- Sacola (guardada no navegador) ------------------------- */
var CHAVE = "navya_pedido";
var carrinho = [];

/* Chave propria: a sacola gravada e um array de cores, e enfiar o
   bump dentro dela faria a versao antiga do filtro descartar tudo. */
var CHAVE_BUMP = "navya_bump";
var bumpNaSacola = false;

function salvarBump(){
  try { localStorage.setItem(CHAVE_BUMP, bumpNaSacola ? "1" : "0"); } catch(e){}
}

function alternarBump(){
  bumpNaSacola = !bumpNaSacola;
  salvarBump();
  return bumpNaSacola;
}

function salvarCarrinho(){
  /* aba anonima / cookies bloqueados fazem isto lancar erro */
  try { localStorage.setItem(CHAVE, JSON.stringify(carrinho)); } catch(e){}
}

function carregarCarrinho(){
  try {
    var bruto = localStorage.getItem(CHAVE);
    if (!bruto) return;
    var dados = JSON.parse(bruto);
    if (!Array.isArray(dados)) return;
    /* descarta cor que nao existe mais (ex.: "Bege" de uma versao antiga) */
    carrinho = dados.filter(function(i){
      return i && CORES_HEX[i.cor] && typeof i.qtd === "number" && i.qtd > 0;
    });
  } catch(e){ carrinho = []; }

  /* Bump sozinho nao e pedido: sem escova na sacola, ele cai fora. */
  try { bumpNaSacola = localStorage.getItem(CHAVE_BUMP) === "1"; } catch(e){ bumpNaSacola = false; }
  if (carrinho.length === 0 && bumpNaSacola){ bumpNaSacola = false; salvarBump(); }
}

function limparCarrinho(){
  carrinho = [];
  salvarCarrinho();
  bumpNaSacola = false;
  salvarBump();
}

function totalUnidades(){
  return carrinho.reduce(function(s, i){ return s + i.qtd; }, 0);
}

/* Resumo completo do pedido.
   O desconto vale pelo TOTAL de unidades, somando todas as cores.
   As linhas sao arredondadas uma a uma e a ultima recebe a
   diferenca, para a soma bater exatamente com o total. */
function resumoPedido(){
  var unidades = totalUnidades();
  if (unidades === 0){
    return { unidades:0, total:0, cheio:0, economia:0, unit:0, off:0, parcela:0, linhas:[], bump:null };
  }

  var escovas = precoTotal(unidades);
  var unit    = escovas / unidades;
  var cheioEscovas = PRECO_CHEIO * unidades;

  /* O bump entra como linha extra: nao conta para a faixa de
     desconto por quantidade, que e so das escovas. */
  var bump  = bumpNaSacola ? { nome:BUMP.nome, de:BUMP.de, valor:BUMP.por } : null;
  var total = escovas + (bump ? bump.valor : 0);
  var cheio = cheioEscovas + (bump ? bump.de : 0);

  var soma = 0;
  var linhas = carrinho.map(function(item, i){
    var valor;
    if (i === carrinho.length - 1){
      valor = escovas - soma;
    } else {
      valor = Math.round(unit * item.qtd * 100) / 100;
      soma += valor;
    }
    return { cor:item.cor, qtd:item.qtd, valor:valor };
  });

  return {
    unidades: unidades,
    total: total,
    cheio: cheio,
    economia: cheio - total,
    unit: unit,
    off: Math.round((1 - escovas / cheioEscovas) * 100),
    parcela: total / PARCELAS,
    linhas: linhas,
    bump: bump
  };
}
