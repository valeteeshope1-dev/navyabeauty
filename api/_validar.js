/* ============================================================
   VALIDACAO — versao do SERVIDOR
   O navegador ja valida tudo isso, mas a validacao de la e
   conforto, nao seguranca: qualquer um pode chamar /api/checkout
   direto. Aqui e onde a regra vale de verdade.
   ============================================================ */

function soNumeros(s){ return String(s || "").replace(/\D/g, ""); }

function cpfValido(cpf){
  cpf = soNumeros(cpf);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  var soma = 0, resto, i;
  for (i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i-1, i), 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(9, 10), 10)) return false;

  soma = 0;
  for (i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i-1, i), 10) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf.substring(10, 11), 10);
}

function emailValido(e){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());
}

var UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
           "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

function texto(v, max){
  return String(v == null ? "" : v).trim().slice(0, max || 120);
}

/* Devolve { cliente, endereco } limpos ou lanca Error com o
   motivo, ja escrito para aparecer na tela do cliente. */
function conferirDados(corpo){
  var c = corpo.cliente || {};
  var e = corpo.endereco || {};

  var nome = texto(c.nome, 120);
  var partes = nome.split(/\s+/).filter(Boolean);
  if (partes.length < 2 || partes[0].length < 2){
    throw new Error("Informe seu nome e sobrenome.");
  }

  var email = texto(c.email, 120).toLowerCase();
  if (!emailValido(email)) throw new Error("E-mail inválido.");

  var cpf = soNumeros(c.cpf);
  if (!cpfValido(cpf)) throw new Error("CPF inválido.");

  var tel = soNumeros(c.tel);
  if (tel.length < 10 || tel.length > 11) throw new Error("Telefone inválido.");

  var cep = soNumeros(e.cep);
  if (cep.length !== 8) throw new Error("CEP inválido.");

  var uf = texto(e.uf, 2).toUpperCase();
  if (UFS.indexOf(uf) === -1) throw new Error("Estado inválido.");

  var rua    = texto(e.rua, 120);
  var numero = texto(e.numero, 20);
  var bairro = texto(e.bairro, 80);
  var cidade = texto(e.cidade, 80);
  if (!rua)    throw new Error("Informe a rua.");
  if (!numero) throw new Error("Informe o número.");
  if (!bairro) throw new Error("Informe o bairro.");
  if (!cidade) throw new Error("Informe a cidade.");

  return {
    cliente: {
      first_name: partes[0],
      last_name: partes.slice(1).join(" "),
      email: email,
      phone: tel,
      document_number: cpf
    },
    endereco: {
      postcode: cep,
      street: rua,
      number: numero,
      complement: texto(e.compl, 80),
      district: bairro,
      city: cidade,
      state: uf
    }
  };
}

/* O IP tem que ser o do comprador, coletado pelo appmax.js.
   Se o script nao devolveu (bloqueador de anuncio, por exemplo),
   caimos no IP que o proprio Vercel enxerga da conexao. */
function ipDoCliente(req, informado){
  var ip = String(informado || "").trim();
  if (/^[0-9.]{7,15}$/.test(ip) || ip.indexOf(":") > -1) return ip;

  var cab = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "";
  var primeiro = String(cab).split(",")[0].trim();
  return primeiro || "127.0.0.1";
}

module.exports = { conferirDados: conferirDados, ipDoCliente: ipDoCliente, soNumeros: soNumeros };
