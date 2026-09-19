/* ============================================================
   QR CODE — desenhado no servidor

   O BravoPay devolve so o codigo copia-e-cola; a imagem do QR nao
   vem. Entao geramos aqui e entregamos pronta para a tela.

   Por que SVG e nao PNG: o QR e um desenho de quadrados pretos e
   brancos. Em SVG isso sao retangulos — texto puro, sem precisar
   de compressao de imagem, e nitido em qualquer tamanho de tela.
   Um PNG exigiria implementar zlib a mao para nada.

   Por que no servidor e nao no navegador: a biblioteca tem 56 KB.
   Gerando aqui, o cliente recebe so a imagem final.
   ============================================================ */

var qrcode = require("./_qrcode-lib.js");

/* Nivel de correcao de erro:
   L = 7%, M = 15%, Q = 25%, H = 30% do codigo pode estar danificado
   e ainda assim ser lido.

   M e o equilibrio certo aqui: o codigo Pix e longo (~190
   caracteres), e subir para Q ou H aumentaria muito a densidade dos
   quadrados — o que atrapalha a leitura em tela de celular com
   brilho baixo mais do que a correcao extra ajuda. */
var CORRECAO = "M";

function gerarSvg(texto, opcoes){
  opcoes = opcoes || {};
  /* Coordenadas em MODULOS, nao em pixels: o SVG e vetor, quem
     define o tamanho final e o CSS da pagina. Numeros de um ou dois
     digitos em vez de tres encolhem o arquivo quase pela metade. */
  var celula = 1;
  var margem = opcoes.margem || 4;

  if (!texto || typeof texto !== "string"){
    throw new Error("QR sem conteúdo.");
  }

  /* Versao 0 = a biblioteca escolhe a menor que caiba o texto. */
  var q = qrcode(0, CORRECAO);
  q.addData(texto);
  q.make();

  var n = q.getModuleCount();
  var lado = (n + margem * 2) * celula;

  var partes = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + lado + '" height="' + lado +
      '" viewBox="0 0 ' + lado + ' ' + lado + '" shape-rendering="crispEdges">',
    '<rect width="100%" height="100%" fill="#ffffff"/>'
  ];

  /* Uma linha de retangulos por faixa contigua de modulos escuros.
     Juntar os vizinhos na horizontal deixa o SVG bem menor do que
     um retangulo por quadradinho. */
  for (var linha = 0; linha < n; linha++){
    var inicio = -1;

    for (var coluna = 0; coluna <= n; coluna++){
      var escuro = coluna < n && q.isDark(linha, coluna);

      if (escuro && inicio === -1){
        inicio = coluna;
      } else if (!escuro && inicio !== -1){
        partes.push(
          '<rect x="' + ((inicio + margem) * celula) +
          '" y="' + ((linha + margem) * celula) +
          '" width="' + ((coluna - inicio) * celula) +
          '" height="' + celula + '" fill="#000000"/>'
        );
        inicio = -1;
      }
    }
  }

  partes.push("</svg>");
  return partes.join("");
}

/* Pronto para usar direto no src de uma <img>. */
function dataUri(texto, opcoes){
  var svg = gerarSvg(texto, opcoes);
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
}

module.exports = { gerarSvg: gerarSvg, dataUri: dataUri };
