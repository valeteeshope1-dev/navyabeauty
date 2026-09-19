/* ============================================================
   PRECOS — versao do SERVIDOR
   Espelho de js/loja.js. Existe para o servidor nunca precisar
   acreditar no total que o navegador mandou: ele recebe so
   cor + quantidade e refaz a conta sozinho.

   MEXEU NO PRECO? Altere nos DOIS lugares: aqui e em js/loja.js.
   Se divergirem, o cliente ve um valor e paga outro.
   ============================================================ */

var PRECO_CHEIO = 58.90;
var TOTAIS      = { 1: 37.90, 2: 58.90, 3: 84.90 };
var UNIT_ACIMA  = 22.95;
var QTD_MAX     = 99;

var CORES = ["Branco", "Verde", "Rosa"];
var PRODUTO_NOME = "Escova Mágica Retrátil Premium";
var SKU_BASE = "NAVYA-ESCOVA";

var FRETE_CENTAVOS = 0;   /* frete gratis hoje; se mudar, mexa aqui */

function precoTotal(q){
  return TOTAIS[q] !== undefined ? TOTAIS[q] : UNIT_ACIMA * q;
}

/* Reais -> centavos. O arredondamento protege do classico
   0.1 + 0.2 = 0.30000000000000004 do ponto flutuante. */
function centavos(reais){
  return Math.round(reais * 100);
}

/* Recebe o carrinho cru do navegador e devolve o pedido conferido.
   Lanca Error com mensagem para o cliente se algo nao fechar. */
function conferirPedido(itens){
  if (!Array.isArray(itens) || itens.length === 0){
    throw new Error("Sua sacola está vazia.");
  }

  /* Junta cores repetidas: o navegador pode mandar a mesma cor
     em duas linhas, e o total tem que valer pelo somatorio. */
  var porCor = {};
  itens.forEach(function(item){
    if (!item || CORES.indexOf(item.cor) === -1){
      throw new Error("Há um item inválido na sacola.");
    }
    var q = Number(item.qtd);
    if (!Number.isInteger(q) || q < 1){
      throw new Error("Quantidade inválida na sacola.");
    }
    porCor[item.cor] = (porCor[item.cor] || 0) + q;
  });

  var linhas = Object.keys(porCor).map(function(cor){
    return { cor: cor, qtd: porCor[cor] };
  });

  var unidades = linhas.reduce(function(s, l){ return s + l.qtd; }, 0);
  if (unidades > QTD_MAX){
    throw new Error("Quantidade acima do limite de " + QTD_MAX + " unidades.");
  }

  var totalReais = precoTotal(unidades);
  var totalCent  = centavos(totalReais);

  /* O desconto vale pelo total de unidades, entao o valor unitario
     depende do pedido inteiro. Rateia em centavos e joga a sobra na
     ultima linha, para a soma das linhas bater com o total exato. */
  var unitCent = Math.floor(totalCent / unidades);
  var soma = 0;

  var produtos = linhas.map(function(linha, i){
    var valorLinha = (i === linhas.length - 1)
      ? totalCent - soma
      : unitCent * linha.qtd;
    soma += valorLinha;

    return {
      sku: SKU_BASE + "-" + linha.cor.toUpperCase(),
      name: PRODUTO_NOME + " — " + linha.cor,
      quantity: linha.qtd,
      unit_value: Math.round(valorLinha / linha.qtd),
      type: "physical",
      _valor_linha: valorLinha
    };
  });

  /* products_value manda no total: e a soma exata das linhas,
     imune a qualquer sobra de centavo no unit_value acima. */
  var produtosValor = produtos.reduce(function(s, p){ return s + p._valor_linha; }, 0);
  produtos.forEach(function(p){ delete p._valor_linha; });

  return {
    unidades: unidades,
    produtos: produtos,
    produtos_valor: produtosValor,
    frete: FRETE_CENTAVOS,
    desconto: 0,
    total: produtosValor + FRETE_CENTAVOS,
    total_reais: (produtosValor + FRETE_CENTAVOS) / 100,
    cheio: centavos(PRECO_CHEIO * unidades)
  };
}

/* Teto de parcelas da loja. Acima de 3x os juros ficam altos demais
   para o ticket deste produto. Mude aqui e em js/loja.js juntos. */
var PARCELAS_MAX = 3;

/* Parcelado com juros: a Appmax exige o pedido ja com os juros
   embutidos, "distribuidos entre os produtos proporcionalmente".
   Esta funcao refaz as linhas para somarem o total novo, mantendo a
   proporcao e jogando a sobra de centavos na ultima linha — assim a
   soma bate exatamente, sem centavo perdido nem sobrando. */
function aplicarJuros(pedido, totalComJuros){
  if (!Number.isInteger(totalComJuros) || totalComJuros < pedido.total){
    throw new Error("Valor com juros inválido.");
  }

  var baseProdutos = pedido.produtos_valor;
  var novoProdutos = totalComJuros - pedido.frete;
  var soma = 0;

  var produtos = pedido.produtos.map(function(p, i, todos){
    var fatia;
    if (i === todos.length - 1){
      fatia = novoProdutos - soma;
    } else {
      fatia = Math.round(novoProdutos * (p.unit_value * p.quantity) / baseProdutos);
      soma += fatia;
    }
    return {
      sku: p.sku,
      name: p.name,
      quantity: p.quantity,
      unit_value: Math.round(fatia / p.quantity),
      type: p.type,
      _valor_linha: fatia
    };
  });

  var produtosValor = produtos.reduce(function(s, p){ return s + p._valor_linha; }, 0);
  produtos.forEach(function(p){ delete p._valor_linha; });

  return Object.assign({}, pedido, {
    produtos: produtos,
    produtos_valor: produtosValor,
    total: produtosValor + pedido.frete,
    total_reais: (produtosValor + pedido.frete) / 100,
    juros: totalComJuros - pedido.total,
    total_sem_juros: pedido.total
  });
}

module.exports = {
  conferirPedido: conferirPedido,
  aplicarJuros: aplicarJuros,
  PRODUTO_NOME: PRODUTO_NOME,
  PARCELAS_MAX: PARCELAS_MAX
};
