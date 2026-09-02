# Reino Mágico do Saber — GitHub + Netlify (recomendado) ou Cloudflare Pages

**Versão de deploy actual:** ver `public/version.json` (gerada por `npm run build`)  
**Site (legado):** [reinomagicodosaber.netlify.app](https://reinomagicodosaber.netlify.app)

---

## Documentação: manual vs este ficheiro

| Documento | Público | Conteúdo |
|-----------|---------|----------|
| **[`public/manual.html`](public/manual.html)** — `/manual.html` | Jogadores, testadores, admins | Como usar o jogo, definições, IA, reportes, teste de IA e painel admin (passo a passo na interface). Ligação no ecrã **ⓘ Sobre** do jogo. |
| **Este `LEIA-ME.md`** | Quem faz deploy e manutenção | Alojamento, variáveis de ambiente, Functions, APIs, scripts, arquitectura e fluxos técnicos. |

O manual **não substitui** este ficheiro: o manual é orientado à utilização; o `LEIA-ME.md` é orientado à configuração e operação do projecto.

---

## Duas formas de alojar, a mesma lógica de IA

Este projeto já vem preparado para correr em **duas plataformas** sem alterares nada no `index.html`:

- **Netlify** → usa `netlify/functions/`
- **Cloudflare Pages** → usa `functions/api/`

Em qualquer uma delas, o jogo chama sempre `/api/generate` e podes configurar **até três fornecedores de IA em simultâneo**: Groq, Anthropic (Claude) e OpenAI (GPT).

### Comportamento da IA no jogo

- **Não são feitas chamadas de IA em massa ao iniciar o jogo** — cada pergunta é gerada quando é necessária.
- O **banco local** é usado apenas se a IA falhar após várias tentativas e validação.
- O indicador no rodapé mostra **IA Online** ou **IA Offline** e o **fornecedor/modelo reais** da última chamada com sucesso (cor por fornecedor); **clicar no selo** verifica o estado (não abre as Definições).
- O jogo abre em modo **Automática** por defeito; ao mudar fornecedor nas Definições, o selo reflecte a preferência até haver nova chamada à IA.
- Ao passar o rato sobre **IA Offline**, pode aparecer o motivo da última falha.
- Groq e OpenAI usam `response_format: { type: 'json_object' }` para respostas mais previsíveis; o cliente normaliza chaves em português (`pergunta`, `opções`, `resposta`) e prefixos `A)`/`B)` nas opções.
- Validação em `public/question-engine.js` rejeita perguntas inadequadas (idade, factos errados, opções incoerentes, etc.).
- Gate **binário**: qualquer issue reprova; score 0–100 é só diagnóstico (UI/testes).
- **Novo Jogo** limpa histórico de sessão (perguntas, respostas, formatos, knowledgeKeys, posições MC).

### Multijogador e histórico de partidas

- **Individual:** histórico de partidas em `localStorage` (`reino_magico_game_history_v1`) — menu **📚 Histórico de partidas**. Ao terminar uma partida local, um resumo é enviado ao Supabase (`game_matches`, `mode: single`) para estatísticas no admin.
- **Multijogador:** salas sincronizadas via **Supabase Realtime** (vários dispositivos, mesmo estado); partidas MP também em `game_matches`.
- **Configuração Supabase:**
  1. Criar projecto em [supabase.com](https://supabase.com)
  2. **Authentication → Providers** → activar **Anonymous sign-ins**
  3. **SQL Editor** → colar e executar, **por esta ordem**:
     - `supabase/schema.sql`
     - `supabase/fix-rls-recursion.sql`
     - `supabase/update-multiplayer-players.sql`
     - `supabase/get-room-players.sql`
     - `supabase/fix-host-authority.sql` *(corrige coroa/anfitrião)*
     - `supabase/rooms-host-only-update.sql` *(RLS: só o anfitrião actualiza `rooms`)*
     - `supabase/expire-rooms-24h.sql` *(expira salas inactivas após 24h)*
     - `supabase/question-bank.sql`
     - `supabase/knowledge-repository.sql` *(repositório de factos verificados — Knowledge Repository)*
     - `supabase/knowledge-import-queue.sql` *(fila de importação diária — estado no Supabase)*
     - `supabase/seed-knowledge-cat20-sample.sql` *(opcional — 5 registos de teste cat. 20)*
  4. **Project Settings → API** → copiar URL e `anon` key para `public/supabase-config.js`
  5. **Database → Replication** → confirmar `rooms` e `room_players` no Realtime

---

## Opção A — GitHub + Netlify (recomendado)

O código fica no **GitHub**; o repositório pode continuar ligado ao Netlify, mas **por defeito o `git push` já não publica em live** (poupa créditos). Testa primeiro em local (`npm run dev`); publica só quando quiseres.

- **Estático:** pasta `public/`
- **API serverless:** `netlify/functions/`
- **Armazenamento de reportes:** Netlify Blobs (automático)

### 1. Repositório GitHub

A raiz do repo deve ser a pasta `reino-magico-deploy` (com `netlify.toml`, `public/`, `scripts/` na raiz).

```powershell
cd reino-magico-deploy
git add .
git commit -m "Alterações"
git push origin main
```

### 2. Netlify — ligação ao Git

1. [app.netlify.com](https://app.netlify.com) → o teu site → **Site configuration → Build & deploy → Link repository**
2. Escolhe o repo `reinomagicodosaber` e a branch `main`

**Build settings** (ou deixa o `netlify.toml` aplicar):

| Campo | Valor |
|-------|--------|
| Base directory | *(vazio)* |
| Build command | `node scripts/generate-version.js` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

### 3. Variáveis de ambiente no Netlify

**Site configuration → Environment variables:**

```text
GROQ_API_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY
REPORTS_ADMIN_USER
REPORTS_ADMIN_PASS
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são necessários para os separadores **Salas multijogador** e **Banco de perguntas** no painel admin (`/admin-reports.html`). A service role **nunca** vai para o browser — só nas Netlify Functions.

### 4. Fluxo: dev local → live (recomendado)

| Passo | Comando | Netlify |
|-------|---------|---------|
| 1. Desenvolver e testar | `npm run dev` → http://localhost:8888 | Zero créditos |
| 2. Guardar no Git | `git push origin main` | **Build ignorado** (sem tag) |
| 3. Publicar em live | `npm run deploy:live` | Deploy manual (pede confirmação) |

**Deploy automático via Git** (opcional): inclui `[deploy]` ou `[live]` na mensagem de commit:

```powershell
git commit -m "Corrigir validação COMPLETA [deploy]"
git push origin main
```

O ficheiro `scripts/should-netlify-build.js` (em `netlify.toml` → `[build].ignore`) decide se o Netlify constrói ou ignora o push.

**Deploy manual** (não depende do Git):

```powershell
npm run deploy:live
# ou: .\scripts\deploy-netlify.ps1
```

Na **primeira vez** após activar o ignore, publica esta alteração com `npm run deploy:live` ou um commit com `[deploy]`.

### Testar após deploy

```text
GET  https://reinomagicodosaber.netlify.app/api/ai-status
POST https://reinomagicodosaber.netlify.app/api/generate   # requer Basic Auth fora do jogo
```

Ferramentas admin e testes: `/admin-reports.html`, `/admin/test-ai.html`, `/admin/test-questions.html`.

---

## Desenvolvimento local (sem créditos Netlify)

Para testar **todas as funcionalidades** (jogo, IA, admin, reportes, telemetria, repositório) **sem deploy** e **sem gastar invocações** no Netlify em produção:

```powershell
# 1. Copiar credenciais (uma vez)
copy .env.example .env.local
# Preenche GROQ_API_KEY, SUPABASE_*, REPORTS_ADMIN_*, etc.

# 2. Arrancar servidor local
npm run dev
# ou: .\scripts\dev-local.ps1
```

Abre **http://localhost:8888** (porta configurável com `DEV_PORT` no `.env.local`).

| URL local | Equivalente produção |
|-----------|----------------------|
| `/` | Jogo |
| `/admin-reports.html` | Painel admin |
| `/admin/test-ai.html` | Teste de IA |
| `/admin/test-questions.html` | Teste do motor |
| `/api/*` | Netlify Functions (correm na tua máquina) |

**Como funciona:** `netlify dev --offline` serve a pasta `public/` e executa `netlify/functions/` localmente. Nada é enviado para o Netlify em produção — logo **não consome créditos** de Functions.

**Dados locais:**

- **Reportes** (Netlify Blobs) → pasta `.netlify/` no projeto (gitignored).
- **IA** (Groq/OpenAI/Anthropic) → em modo `--offline` **não** herda as chaves do Netlify; copia-as para `.env.local` (`GROQ_API_KEY`, etc.) e reinicia `npm run dev`. Sem chaves, o jogo mostra «IA offline — nenhuma chave configurada».
- **Supabase** (salas, banco, telemetria, repositório) → usa o projecto configurado em `.env.local` (podes usar o mesmo de produção ou um projecto de teste).
- **IA** (quotas) → chamadas directas às APIs dos fornecedores (quotas próprias, não Netlify).

**Alternativa sem copiar chaves:** `netlify link` (uma vez) + `DEV_LIVE=1` no `.env.local` **sem** chaves de IA locais — o CLI usa `--context production`. Se tiveres chaves em `.env.local`, o `npm run dev` ignora `DEV_LIVE` e corre em `--offline` para não sobrescrever valores válidos.

`GENERATE_ALLOW_PUBLIC=true` é activado automaticamente em local para facilitar testes sem Basic Auth.

**Opcional:** `DEV_LIVE=1` no `.env.local` liga o CLI ao site Netlify para herdar variáveis remotas; as functions continuam locais.

**Produção vs local:** `public/version.json` inclui `"environment": "local"` quando corres `npm run dev`.

---

## Opção B — Cloudflare Pages (alternativa)

1. **Build command:** `node scripts/generate-version.js`
2. **Build output directory:** `public`
3. **Environment variables:** chaves de IA + `REPORTS_ADMIN_USER` / `REPORTS_ADMIN_PASS`
4. **KV binding:** `REPORTS_KV` para reportes

O Cloudflare publica `functions/api/*.js` em `/api/*`.

**Testar:** `GET https://TEU-SITE.pages.dev/api/ai-status`

### Deploy manual Netlify (sem Git)

```powershell
.\scripts\deploy-netlify.ps1
```

⚠️ Deploy por zip no Netlify **não** actualiza as Functions — usa Git ou o script acima.

---

## Fornecedores de IA (variáveis no servidor)

No jogo: **Definições → Inteligência Artificial**

| Modo | Comportamento |
|------|----------------|
| **Automática** | Ordem `AI_PROVIDER_ORDER` ou `groq → openai → anthropic` por defeito |
| **Groq / Anthropic / OpenAI** | Força um único fornecedor (se a chave existir); mostra selector de **modelo** |
| **Banco local** | Sem chamadas à IA; selector de modelo oculto |

O selector de **modelo** nas Definições só aparece com fornecedor manual (Groq, Anthropic ou OpenAI), não em Automática nem Banco local.

```text
AI_PROVIDER          -> "groq", "anthropic" ou "openai" (força um; desliga fallback)
AI_PROVIDER_ORDER    -> ex.: "groq,openai,anthropic"
GROQ_MODEL           -> default: openai/gpt-oss-20b
ANTHROPIC_MODEL      -> default: claude-haiku-4-5-20251001
OPENAI_MODEL         -> default: gpt-4o-mini
```

### Páginas de teste (admin)

URLs: **`/admin/test-ai.html`** e **`/admin/test-questions.html`** (ligação em **Definições → Administração**).

- Requerem as mesmas credenciais do painel admin (`REPORTS_ADMIN_USER` / `REPORTS_ADMIN_PASS`); sessão partilhada via `public/admin-auth.js`.
- **`/api/generate`** aceita pedidos do jogo (mesma origem) ou com cabeçalho `Authorization: Basic …` (ferramentas admin). Sem credenciais válidas → 403.
- Em desenvolvimento local sem login: `GENERATE_ALLOW_PUBLIC=true` no `.env.local` (nunca em produção).
- URLs antigas `/test-ai.html` e `/test-questions.html` devolvem **404** (`public/_redirects`).

**Teste de IA** — ligação JSON simples, pergunta trivia e as 3 faixas etárias; quotas, chaves configuradas e modelo em uso.

Documentação de utilização: secções 9 e 10 do [manual](public/manual.html).

---

## Arquitetura

```text
Browser
   ↓ POST /api/generate  (mesma origem no jogo, ou Basic Auth nas ferramentas /admin/)
Netlify Function  OU  Cloudflare Pages Function
   ↓ fornecedor preferido + fallback automático
Groq API  /  Anthropic API  /  OpenAI API
   ↓ JSON normalizado
Browser  →  question-engine.js (validação)  →  pergunta ou banco local
```

Ficheiros principais:

| Ficheiro | Função |
|----------|--------|
| `public/index.html` | Jogo, definições, Sobre, reportes |
| `public/question-engine.js` | Formatos, prompts e validação de perguntas |
| `public/admin-auth.js` | Basic Auth partilhada (painel admin e `/admin/*`) |
| `public/admin/test-questions.html` | Gerar, validar e dar feedback ao motor (credenciais admin) |
| `scripts/test-question-engine.js` | 57 testes unitários do motor (`node scripts/test-question-engine.js`) |
| `scripts/list-open-reports.js` | Lista reportes por tratar no servidor (requer credenciais admin) |
| `public/manual.html` | Manual do utilizador |
| `public/admin/test-ai.html` | Diagnóstico de IA (credenciais admin) |
| `public/admin-reports.html` | Painel admin (reportes, salas, banco de perguntas) |
| `netlify/functions/lib/question-bank-store.js` | Estatísticas do banco Supabase para o admin |
| `netlify/functions/lib/rooms-store.js` | Salas abertas e estatísticas de jogos (MP + locais) |
| `netlify/functions/generate.js` | Geração IA (Netlify) |
| `netlify/functions/lib/reports-store.js` | Armazenamento de reportes (Blobs) |

---

## Versão automática no About

A versão **não deve ser editada à mão** no `index.html`.

```text
node scripts/generate-version.js
```

Gera:

- `public/version.json` — versão e data/hora (Portugal)
- `public/changelog.json` — copiado de `scripts/changelog.json`
- Cache bust em `question-engine.js?v=…`, `app-build`, `sw.js`

### Atualizar o changelog antes de cada release

Edita `scripts/changelog.json` (`current` + `history`), depois:

```text
npm run build
```

ou `npm run zip` para gerar também o zip estático.

---

## Atualização automática (Service Worker)

| Componente | Função |
|------------|--------|
| `app-update.js` | Compara `version.json` com `localStorage`; banner «Atualizar agora» |
| `sw.js` | Cache por versão (`reino-static-BUILD`); limpa caches antigas |
| `generate-version.js` | Sincroniza build em cada deploy |

Verificação: ao abrir, ao voltar ao separador e a cada 5 minutos.

**Nunca em cache:** `/api/*`, `version.json`, `changelog.json`.

---

## Manual do site (`manual.html`)

Guia completo em português (PT-PT) para:

- Menu, jogo, dados, categorias, faixas etárias
- Perguntas (MC, aberta, V/F), Saber Mais, temporizador
- Definições (tempo, sons, tema, categorias, IA)
- Ecrã Sobre e reportes (pergunta vs site)
- Teste de IA, teste de perguntas e painel admin (reportes, salas, banco)
- Teste de IA e teste de perguntas (`/admin/test-ai.html`, `/admin/test-questions.html`) — credenciais admin

**Acesso:** [manual.html](public/manual.html) ou **ⓘ Sobre → Manual completo do site** no jogo.

---

## Reportes de problemas

### Jogador

- **Pergunta:** botão 🚩 na pergunta — tipos (resposta errada, confusa, português, sugestão, etc.).
- **Site/app:** **Sobre → Reportar problema no site** — bugs, UI, lentidão, sugestão; opcional **imagem** (galeria ou câmara).
- Cada dispositivo tem `reporterId` anónimo em `localStorage`.
- Reportes enviados ao servidor; lista local no Sobre com **Por tratar** / **Corrigido**.
- Resolvidos e cancelados são **removidos da lista local após 24 horas**.

### Painel admin

URL: **`/admin-reports.html`** — utilizador e palavra-passe (`REPORTS_ADMIN_USER` / `REPORTS_ADMIN_PASS`).

**Separador Reportes**

- Dashboard: gráficos temporais (24 h / 3 / 7 / 14 dias), por tratar vs resolvidos, tipo, idade, dispositivo, top categorias (incl. **Site/app**).
- Clicar num tipo ou estado filtra gráficos e tabela.
- Tabela com estado, **Resolvido em** (hora Portugal), detalhe, copiar, imagem anexada.
- Acções em lote: Resolver, Cancelar, Reabrir, Apagar (só cancelados).
- **Exportar CSV** — exporta visíveis; colunas `estado`, `resolvidoEm`; **não marca como resolvido**.
- Actualização automática a cada 30 s.

**Separador Salas multijogador**

- Salas em aberto (código, estado, jogadores, anfitrião), botão **Desligar** (individual ou em lote).
- Gráfico temporal: salas criadas, jogos multijogador e **jogos locais** (partidas single sincronizadas com `game_matches`).
- Totais: salas criadas, jogos MP e jogos locais.

**Separador Banco de perguntas**

- Gráfico de perguntas guardadas no tempo (1 h / 3 h / 6 h / 12 h / 24 h / 3 d / 7 d / total) — guardadas no banco vs geradas via IA.
- Gráfico por categoria e faixa etária no período seleccionado.
- Matriz categoria × faixa (6–9, 10–15, 15+) com cores por quantidade; destaque de **lacunas** (categorias/faixas com poucas perguntas).
- Resumo «Lacunas no banco» e alerta para perguntas activas sem opções válidas.

**Estados dos reportes:** `open` (por tratar) → `resolved` (corrigido) ou `cancelled` (cancelado). Cancelados fora dos gráficos; apagáveis permanentemente.

Documentação de utilização do admin: secção 11 do [manual](public/manual.html).

### Fluxo de correção (equipa / Cursor)

1. Analisar reportes (texto ou CSV exportado do admin).
2. Corrigir validação em `public/question-engine.js` (e `index.html` se necessário).
3. Marcar resolvidos via script (não ao exportar CSV no painel):

```text
node scripts/resolve-reports-from-csv.js --ids rpt-abc,rpt-def
```

ou com CSV: `node scripts/resolve-reports-from-csv.js "caminho\reportes.csv"`

**Credenciais locais (Cursor / scripts):** copia `.env.example` → `.env.local` e preenche `REPORTS_ADMIN_USER` / `REPORTS_ADMIN_PASS` (as mesmas do painel admin). Os scripts carregam `.env.local` automaticamente. O ficheiro está no `.gitignore` — nunca o commits.

**Listar por tratar:** `node scripts/list-open-reports.js`

Regra detalhada: `.cursor/rules/reportes-ia.mdc`.

### APIs de reportes

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/api/generate` | POST | Geração IA — jogo (mesma origem) ou Basic Auth admin |
| `/api/report` | POST | Jogador envia reporte |
| `/api/report-status` | GET | Sobre — estado dos reportes do jogador |
| `/api/report-attachment` | POST/GET | Imagem anexada (reportes do site) |
| `/api/reports-admin` | GET/PATCH/DELETE | Painel admin — reportes (Basic Auth) |
| `/api/rooms-admin` | GET/PATCH | Painel admin — salas e estatísticas de jogos (Basic Auth + Supabase service role) |
| `/api/question-bank-admin` | GET/POST | Painel admin — banco de perguntas Supabase: estatísticas, pesquisa, apagar, purge sem opções (Basic Auth + service role) |

Redirects em `netlify.toml` e `public/_redirects`.

Armazenamento Netlify: **Netlify Blobs** (`question-reports`). Cloudflare: **KV** (`REPORTS_KV`).

---

## Controlo de perguntas e formatos

- Perguntas não se repetem na mesma sessão por faixa etária; respostas e `knowledgeKey` também são controlados.
- A IA rejeita repetições e exige adequação à categoria (ex.: transportes/espaço fora de Tecnologia).
- Formatos variados por categoria (Quem é, O que é, Completa, Quando, Curiosidade, MC, V/F, etc.).
- Linguagem **PT-PT**; futebol com vocabulário português (guarda-redes, relvado, golo).
- Adequação por idade (6–9, 10–15, 15+).
- Histórico persistente em `localStorage` (`reino_magico_q_history_v3`) entre jogos; sessão reinicia no Novo Jogo.

### Testar o motor

```text
node scripts/test-question-engine.js
```

Página interactiva: `/admin/test-questions.html` (credenciais admin; requer IA online para gerar; revalidação manual funciona offline).

---

## Scripts úteis

| Script | Uso |
|--------|-----|
| `scripts/deploy-github.ps1` | Testes + push para GitHub (dispara Actions → Cloudflare Pages) |
| `scripts/deploy-netlify.ps1` | Deploy produção Netlify (manual) |
| `npm run deploy:live` | Igual, com confirmação interactiva |
| `scripts/generate-version.js` | Versão, changelog, cache bust |
| `scripts/test-question-engine.js` | Testes unitários do motor (57 casos) |
| `scripts/resolve-reports-from-csv.js` | Marcar reportes como resolvidos na API |
| `scripts/create-zip.js` | Zip estático (`npm run zip`) |

---

## Resolução rápida de problemas

| Sintoma | Causa provável |
|---------|----------------|
| IA Offline | Chaves em falta, quota esgotada, deploy sem Functions |
| Groq com OpenAI seleccionado | Deploy só por zip — Functions antigas |
| Escolha múltipla indisponível | IA offline; jogo usa resposta aberta temporariamente |
| Site antigo após deploy | Ctrl+Shift+R; verificar banner de actualização (SW) |
| Admin sem reportes | `REPORTS_ADMIN_*` em falta ou Blobs/KV não configurado |
| `/api/generate` 403 | Chamada externa sem Basic Auth; em local usar `GENERATE_ALLOW_PUBLIC=true` |
| Export CSV não resolve | Comportamento correcto — usar `resolve-reports-from-csv.js` |

Para utilização do jogo e testes passo a passo, consulta o **[manual](public/manual.html)**.
