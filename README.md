# Gestão de Leads — Concessionária

Sistema para **filtrar os leads que chegam pelo Instagram**, separar quem tem potencial de quem não tem, acompanhar cada lead no **funil de vendas** e **encaminhar pelo WhatsApp** para o vendedor continuar a venda (compra, venda, troca e financiamento).

## Funcionalidades

- **Captura de leads do Instagram**
  - **Formulário "link na bio"** (`/formulario`): o cliente informa nome, WhatsApp, interesse (comprar / trocar / vender / financiar), veículo, orçamento, forma de pagamento e prazo. Aceita `?utm_source=...&utm_campaign=...` para identificar campanhas.
  - **Webhook de Direct (DM)** (`/webhooks/instagram`): integração com a API de mensagens do Instagram (Meta). Cada DM vira um lead e o texto é analisado para extrair telefone, interesse, forma de pagamento, prazo e valor.
  - Cadastro manual pelo painel.
- **Pontuação automática (0–100) e classificação de potencial**
  - 🔥 **Quente** (≥ 60) · 🌤️ **Morno** (35–59) · ❄️ **Frio** (< 35, baixo potencial).
  - Critérios: interesse, prazo de compra, forma de pagamento, WhatsApp válido, orçamento, veículo definido, carro para troca. A tela do lead mostra por que ele recebeu cada ponto.
  - Pesos ajustáveis em `server/scoring.js`.
- **Funil de vendas (Kanban)**: Novo → Em qualificação → Qualificado → Encaminhado → Negociação → Proposta → Venda fechada / Perdido. Arraste os cards entre as etapas; ao marcar como perdido, o sistema pede o motivo.
- **Encaminhamento para o WhatsApp**
  - Botão **"Encaminhar ao vendedor"**: escolhe o vendedor (ou usa **rodízio automático**) e abre o WhatsApp com um resumo completo do lead.
  - Botão **"Chamar cliente no WhatsApp"**: abre a conversa com o cliente já com uma mensagem de apresentação.
- **Histórico** de cada lead (DMs, notas, ligações, visitas, mudanças de etapa).
- **Dashboard**: total de leads, quentes/mornos/frios, funil, interesse, motivos de perda, conversão e desempenho por vendedor. Alerta de leads com potencial ainda sem vendedor.
- **Perfis**: administrador (vê tudo, distribui leads) e vendedor (vê apenas os próprios leads).
- Exportação para CSV (abre no Excel).

## Como rodar

Requer **Node.js 22.5+** (usa o SQLite nativo do Node).

```bash
npm install
npm start          # http://localhost:3000
```

Login inicial: `admin@loja.com` / `admin123` — **troque a senha** (ou defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` antes do primeiro start).

Primeiros passos:
1. Em **Vendedores**, cadastre cada vendedor com o número de WhatsApp.
2. Coloque o link `https://SEU-DOMINIO/formulario` na bio do Instagram (e nos stories/anúncios).
3. Acompanhe os leads em **Leads** e **Funil de vendas** e encaminhe os quentes/mornos.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `DB_FILE` | Caminho do banco SQLite (padrão `data/leads.db`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Usuário administrador criado no primeiro start |
| `IG_VERIFY_TOKEN` | Token de verificação do webhook do Instagram (você escolhe) |
| `IG_APP_SECRET` | App Secret do app Meta, para validar a assinatura dos webhooks |

## Integração com o Direct do Instagram (opcional)

1. Converta o Instagram da loja em conta **Profissional** e vincule a uma Página do Facebook.
2. Crie um app em developers.facebook.com com o produto **Instagram** / **Messenger** e permissão `instagram_manage_messages`.
3. Em Webhooks, configure a URL `https://SEU-DOMINIO/webhooks/instagram`, o token igual a `IG_VERIFY_TOKEN` e assine o campo `messages`.
4. O servidor precisa estar publicado com HTTPS (ex.: Render, Railway, VPS com Nginx).

Sem essa integração o sistema funciona normalmente com o formulário e o cadastro manual.

## Testes

```bash
npm test
```

## Estrutura

```
server/
  index.js      inicialização
  app.js        rotas da API, webhook do Instagram, autenticação
  db.js         banco SQLite e tabelas
  scoring.js    pontuação e leitura das mensagens
  whatsapp.js   links wa.me e mensagem de encaminhamento
public/
  index.html, app.js, styles.css   painel
  formulario.html                  formulário público (link na bio)
test/app.test.js
```
