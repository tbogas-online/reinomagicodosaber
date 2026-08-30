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
- O indicador no rodapé mostra **IA Online** ou **IA Offline**; **clicar no selo** verifica o estado (não abre as Definições).
- Ao passar o rato sobre **IA Offline**, pode aparecer o motivo da última falha.
- Groq e OpenAI usam `response_format: { type: 'json_object' }` para respostas mais previsíveis.
- Validação em `public/question-engine.js` rejeita perguntas inadequadas (idade, factos errados, opções incoerentes, etc.).
- Gate **binário**: qualquer issue reprova; score 0–100 é só diagnóstico (UI/testes).
- **Novo Jogo** limpa histórico de sessão (perguntas, respostas, formatos, knowledgeKeys, posições MC).

### Multijogador e histórico de partidas

- **Individual:** histórico de partidas em `localStorage` (`reino_magico_game_history_v1`) — menu **📚 Histórico de partidas**.
- **Multijogador:** salas sincronizadas via **Supabase Realtime** (vários dispositivos, mesmo estado).
- **Configuração Supabase:**
  1. Criar projecto em [supabase.com](https://supabase.com)
  2. **Authentication → Providers** → activar **Anonymous sign-ins**
  3. **SQL Editor** → colar e executar, **por esta ordem**:
     - `supabase/schema.sql`
     - `supabase/fix-rls-recursion.sql`
     - `supabase/update-multiplayer-players.sql`
     - `supabase/get-room-players.sql`
     - `supabase/fix-host-authority.sql` *(corrige coroa/anfitrião)*
  4. **Project Settings → API** → copiar URL e `anon` key para `public/supabase-config.js`
  5. **Database → Replication** → confirmar `rooms` e `room_players` no Realtime

---

## Opção A — GitHub + Netlify (recomendado)

O código fica no **GitHub**; cada `push` para `main` dispara o deploy automático no **Netlify** (liga o repositório em *Site configuration → Build & deploy → Link repository*).

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
```

### 4. Deploy

Cada `git push origin main` publica automaticamente. Ou manualmente:

```powershell
.\scripts\deploy-netlify.ps1
```

### Testar após deploy

```text
GET  https://reinomagicodosaber.netlify.app/api/ai-status
POST https://reinomagicodosaber.netlify.app/api/generate
```

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
| **Groq / Anthropic / OpenAI** | Força um único fornecedor (se a chave existir) |

```text
AI_PROVIDER          -> "groq", "anthropic" ou "openai" (força um; desliga fallback)
AI_PROVIDER_ORDER    -> ex.: "groq,openai,anthropic"
GROQ_MODEL           -> default: openai/gpt-oss-20b
ANTHROPIC_MODEL      -> default: claude-haiku-4-5-20251001
OPENAI_MODEL         -> default: gpt-4o-mini
```

### Página de teste de IA

URL: **`/test-ai.html`** (também em Definições → Página de teste de IA).

- Testa ligação JSON simples, pergunta trivia e as 3 faixas etárias.
- Mostra quotas, chaves configuradas e modelo em uso.
- Documentação de utilização: secção 9 do [manual](public/manual.html).

---

## Arquitetura

```text
Browser
   ↓ POST /api/generate
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
| `public/test-questions.html` | Gerar, validar e dar feedback ao motor |
| `scripts/test-question-engine.js` | 46 testes unitários do motor (`node scripts/test-question-engine.js`) |
| `scripts/list-open-reports.js` | Lista reportes por tratar no servidor (requer credenciais admin) |
| `public/manual.html` | Manual do utilizador |
| `public/test-ai.html` | Diagnóstico de IA |
| `public/admin-reports.html` | Painel admin de reportes |
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
- Teste de IA e painel admin
- Teste de perguntas (`/test-questions.html`)

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

- Dashboard: gráficos temporais (24 h / 3 / 7 / 14 dias), por tratar vs resolvidos, tipo, idade, dispositivo, top categorias (incl. **Site/app**).
- Clicar num tipo ou estado filtra gráficos e tabela.
- Tabela com estado, **Resolvido em** (hora Portugal), detalhe, copiar, imagem anexada.
- Acções em lote: Resolver, Cancelar, Reabrir, Apagar (só cancelados).
- **Exportar CSV** — exporta visíveis; colunas `estado`, `resolvidoEm`; **não marca como resolvido**.
- Actualização automática a cada 30 s.

**Estados:** `open` (por tratar) → `resolved` (corrigido) ou `cancelled` (cancelado). Cancelados fora dos gráficos; apagáveis permanentemente.

Documentação de utilização do admin: secção 10 do [manual](public/manual.html).

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
| `/api/report` | POST | Jogador envia reporte |
| `/api/report-status` | GET | Sobre — estado dos reportes do jogador |
| `/api/report-attachment` | POST/GET | Imagem anexada (reportes do site) |
| `/api/reports-admin` | GET/PATCH/DELETE | Painel admin (Basic Auth) |

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

Página interactiva: `/test-questions.html` (requer IA online para gerar; revalidação manual funciona offline).

---

## Scripts úteis

| Script | Uso |
|--------|-----|
| `scripts/deploy-github.ps1` | Testes + push para GitHub (dispara Actions → Cloudflare Pages) |
| `scripts/deploy-netlify.ps1` | Deploy produção Netlify (legado) |
| `scripts/generate-version.js` | Versão, changelog, cache bust |
| `scripts/test-question-engine.js` | Testes unitários do motor (43 casos) |
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
| Export CSV não resolve | Comportamento correcto — usar `resolve-reports-from-csv.js` |

Para utilização do jogo e testes passo a passo, consulta o **[manual](public/manual.html)**.
