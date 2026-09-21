# Navya Beauty — como esta loja funciona

Loja de um produto só (Escova Mágica Retrátil Premium), em
`navyabeauty.com`. HTML e JavaScript puros, sem framework, sem build.
Hospedada na Vercel, com funções serverless em `api/`.

Este documento existe para quem pegar o projeto depois — inclusive
você mesmo daqui a um mês. Ele explica **por que** as coisas são como
são, não só o que elas fazem.

---

## As páginas

| Arquivo | O que é |
|---|---|
| `index.html` | Página de venda. É onde o anúncio cai |
| `produto.html` | Escolha de cor e quantidade, avaliações completas |
| `checkout.html` | Dados do cliente, Pix, confirmação |
| `js/loja.js` | **Fonte única de preços e da sacola.** Usado pelas duas últimas |
| `js/pixel.js` | Meta Pixel e captura de UTMs. Carregado nas três |

Preços ficam em `js/loja.js`:

```
1 unidade   R$ 37,90
2 unidades  R$ 58,90
3 unidades  R$ 84,90
4 ou mais   R$ 22,95 cada
```

⚠️ **`api/_precos.js` é um espelho desses valores, no servidor.**
Mexeu no preço? Mexa nos dois. Se divergirem, o cliente vê um valor
e paga outro.

---

## O pagamento

Gateway: **BravoPay**, somente Pix. Cartão lá custa 9,90% + R$ 3,60
com retenção de 90 dias — inviável para um ticket de R$ 37,90.

**Taxa medida na API** (não está na documentação deles, e o
`GET /me` não retorna): **5,99% + R$ 1,99**. Numa venda de R$ 37,90
dá R$ 4,26, ou 11,2%. Saque custa R$ 9,90 fixo, mínimo R$ 30.

Pix **não fica retido**: cai como disponível na hora. (A API tem um
campo `pending_pix_cents`, mas no teste real ele ficou zerado.)

### O caminho de uma venda

```
1. navegador  POST /api/checkout   { itens, cliente, endereço, utm, meta }
2. servidor   REFAZ a conta do total a partir de cor + quantidade
3. servidor   valida CPF, e-mail, telefone, endereço
4. servidor   cria a cobrança no BravoPay
5. servidor   desenha o QR Code em SVG
6. navegador  mostra QR + copia-e-cola + relógio de expiração
7. navegador  pergunta /api/status a cada 5s
8. BravoPay   chama /api/webhook quando o pagamento confirma
9. servidor   envia a compra ao Meta pela API de Conversões
```

**O servidor nunca aceita o total vindo do navegador.** Recebe só cor
e quantidade e refaz a conta. Qualquer um pode chamar `/api/checkout`
direto com o preço que quiser.

**O número do pedido é nosso** (`NV` + base36), usado como
`external_reference`. O id interno do gateway não circula pelo
navegador.

**Endereço de entrega viaja em `metadata` da transação.** O BravoPay
é gateway de cobrança, não sistema de pedidos: sem isso, a venda
chega sem saber para onde enviar.

---

## O rastreamento

| Evento | De onde sai |
|---|---|
| PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo | navegador |
| **Purchase** | **servidor**, no webhook |

A compra sai do servidor de propósito: bloqueador de anúncio, aba
fechada e as restrições do iPhone derrubam boa parte dos eventos do
navegador — e a compra é justamente o evento com que o Meta aprende a
quem mostrar o anúncio.

Os dois lados compartilham um `event_id`, senão o Meta conta a mesma
venda duas vezes e o custo por compra aparece pela metade.

**UTMs:** capturados quando a pessoa chega pelo anúncio e guardados
30 dias no navegador. Sem isso eles se perdem no caminho até o
checkout, e a UTMify recebe a venda sem origem.

---

## Os arquivos de servidor

```
api/_bravopay.js    cliente da API + verificação HMAC do webhook
api/_meta.js        API de Conversões (hash SHA-256 dos dados)
api/_precos.js      recalcula o total (espelho de js/loja.js)
api/_validar.js     revalida CPF, e-mail, telefone, endereço
api/_qr.js          desenha o QR em SVG
api/_qrcode-lib.js  qrcode-generator 1.4.4 (MIT), vendorizado
api/checkout.js     POST — cria o pedido
api/status.js       GET  — a tela do Pix pergunta se pagou
api/webhook.js      POST — o BravoPay avisa que pagou
api/config.js       GET  — diagnóstico das variáveis de ambiente
```

Os arquivos `appmax*` ficaram de uma integração abandonada. Estão
desligados; podem ser apagados.

---

## Rodar no seu PC

```
cd Navya
node server.js
```

Abre em `http://localhost:3000`, e o `server.js` serve as rotas
`/api` do mesmo jeito que a Vercel — o que funciona local funciona lá.

Ele lê as credenciais de `.env.local`, que fica fora do Git.

```
node scripts/testar-retry.js    testa a política de repetição
```

---

## Publicar

```
git add -A
git commit -m "..."
git push origin main
```

A Vercel publica sozinha a cada push na `main`.

⚠️ **Variável de ambiente nova só vale em deploy novo.** Cadastrou
algo no painel? Faça um commit vazio:

```
git commit --allow-empty -m "redeploy" && git push origin main
```

Para conferir o que chegou: `https://navyabeauty.com/api/config`.
Ele mostra o **tamanho** de cada variável, nunca o valor.

---

## Armadilhas que já custaram caro

**O campo de variável da Vercel corta caracteres na colagem.**
Aconteceu quatro vezes num dia: um nome perdeu a última letra, um ID
perdeu o primeiro dígito. **Sempre confira o tamanho depois de
salvar** — é para isso que o `/api/config` existe.

**Desligue a tradução do Chrome** na página de variáveis. Ela chegou
a exibir `APPMAX_CLIENT_ID` como `ID_do_CLIENTE_APPMAX`.

**O log de runtime da Vercel, no plano Hobby, vive cerca de uma hora.**
Não dependa dele para guardar valor nenhum.

**Gateway cai e volta sozinho.** Um ambiente devolveu `504` por mais
de uma hora e no dia seguinte estava de pé, sem nenhuma mudança de
código. Antes de investigar um `5xx` de terceiro, tente de novo mais
tarde.

**A assinatura do webhook é sobre o corpo CRU.** A Vercel entrega o
corpo já convertido em objeto; reconstruí-lo muda espaços e a
assinatura não bate. Quando isso acontece, `api/webhook.js` pergunta
à API se o pedido está pago, em vez de confiar ou descartar.

**Cobrança não se repete.** O retry cobre `429` e `5xx`, mas um
timeout numa cobrança pode significar que ela passou e só a resposta
se perdeu. Repetir debitaria o cliente duas vezes.

---

## O que ainda falta

1. **`BRAVOPAY_PRODUCT_ID`** — criar um produto real no painel do
   BravoPay. Sem ele a venda aparece na UTMify como "API Charge", e
   com filtro por produto ligado ela some do relatório.
2. **Confirmar os IPs da Vercel** no painel de chaves do BravoPay. Se
   bloquearem por precaução, a loja para de gerar Pix sem aviso.
3. **O nome do recebedor.** O cliente vê `FLORIDANEGOCIOS` no app do
   banco, não "Navya Beauty". Isso derruba conversão e gera
   contestação — vale insistir com o suporte deles.
4. **Política de privacidade.** Com pixel instalado, a LGPD exige. A
   loja não tem.
5. **Trocar o plano da Vercel.** O Hobby é para projetos não
   comerciais, e esta loja vende.

---

## Credenciais

Ficam em `Drop/CREDENCIAIS-NAVYA/LEIA-ME.md`, **fora deste
repositório de propósito**: aqui dentro, um deslize no `.gitignore`
publicaria tudo no GitHub.

As mesmas chaves vivem em três lugares — `.env.local`, painel da
Vercel, e aquele arquivo. Trocou uma? Troque nos três.
