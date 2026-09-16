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
var TOTAIS      = { 1: 33.90, 2: 52.90, 3: 76.90 };
var UNIT_ACIMA  = 22.95;                          /* a partir de 4 unidades */
var QTD_MAX     = 99;
var PARCELAS    = 12;

/* --- Cores reais do produto -------------------------------- */
var CORES_HEX = { "Branco":"#f2f1f3", "Verde":"#ade1d4", "Rosa":"#f8a0aa" };
var COR_PADRAO = "Branco";
var FOTO_ITEM = "./img/desc-cores.jpg";

var PRODUTO_NOME = "Escova Mágica Retrátil Premium";

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
}

function limparCarrinho(){
  carrinho = [];
  salvarCarrinho();
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
    return { unidades:0, total:0, cheio:0, economia:0, unit:0, off:0, parcela:0, linhas:[] };
  }

  var total = precoTotal(unidades);
  var unit  = total / unidades;
  var cheio = PRECO_CHEIO * unidades;

  var soma = 0;
  var linhas = carrinho.map(function(item, i){
    var valor;
    if (i === carrinho.length - 1){
      valor = total - soma;
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
    off: Math.round((1 - total / cheio) * 100),
    parcela: total / PARCELAS,
    linhas: linhas
  };
}
