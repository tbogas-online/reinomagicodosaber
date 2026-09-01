# Roadmap — Knowledge Repository

**Objetivo:** a IA deixa de ser fonte primária de factos. Passa a ser **formatador/gerador de perguntas** a partir de conhecimento verificado.

**Regra de ouro**

```
Fonte confiável → facto → IA → pergunta → validação → jogador
```

**Nunca:** `IA → facto → pergunta`

---

## Estado actual (baseline)

| Componente | Papel hoje | Limitação |
|------------|------------|-----------|
| `generateQuestion()` (`index.html`) | Prompt → LLM → JSON | LLM inventa o facto |
| `question-engine.js` + módulos | Validação pós-geração | Não valida proveniência |
| `factual-verify.js` | Segunda passagem IA em categorias de risco | Ainda é LLM a verificar LLM |
| `known-facts.js` | Regras de reportes manuais | Lista fixa, não escala |
| `question_bank` (Supabase) | Cache de perguntas `source='ai'` | Sem ligação a fonte verificável |
| `knowledge` JSON na resposta IA | `entity/concept/relation` opcional | Metadados fracos, não auditáveis |

---

## Arquitectura alvo

```
KNOWLEDGE REPOSITORY
        │
   ┌────┼────┐
   ↓    ↓    ↓
Fontes PT   Fontes gerais   Fontes específicas
   │    │    │
   └────┼────┘
        ↓
  FACTO VERIFICADO (record normalizado)
        ↓
   SELECÇÃO (categoria, idade, formato, não repetido)
        ↓
   IA (só formulação — q, clues, distractors, tom)
        ↓
   VALIDADORES (question-engine existente)
        ↓
   JOGO + persistência (knowledgeId, source, sourceId)
```

### Prioridade de fontes (global)

1. Institucional portuguesa / PT-PT  
2. Especializada de elevada qualidade  
3. Wikidata / bases estruturadas  
4. Outras referência  
5. LLM — **apenas** transformação linguística, nunca facto primário  

### Fontes transversais

| Fonte | Função |
|-------|--------|
| Wikidata | Base factual estruturada |
| RTP / RTP Arquivos | Conteúdo PT e histórico |
| Arquivo.pt | Pesquisa Web PT |
| BNP | Literatura, história, cultura |
| Museus e Monumentos PT | Arte e património |
| Academia das Ciências | Língua PT |
| Priberam | PT-PT, vocabulário |
| UNESCO | Património mundial |
| Wikipedia | Investigação, **não** fonte final |
| LLM | Formulação/adaptação |

---

## Modelo de dados — `KnowledgeRecord`

Cada entrada do repositório (antes da pergunta):

```json
{
  "knowledgeId": "knw-cat20-adv-000123",
  "category": 20,
  "topic": "adivinha tradicional",
  "subtopic": "objectos do quotidiano",
  "fact": "Charada tradicional: tem dentes mas não morde.",
  "answer": "Pente",
  "clues": ["tem dentes", "não morde", "penteia o cabelo"],
  "source": "MemóriaMedia",
  "sourceId": "mm:adivinha:12345",
  "sourceUrl": "https://…",
  "license": "CC-BY-4.0",
  "confidence": 0.95,
  "priorityPt": 98,
  "ageBands": ["6-9", "10-15"],
  "allowedFormats": ["ADIVINHA", "CURIOSIDADE"],
  "tags": ["folclore", "portugal"],
  "verifiedAt": "2026-09-01",
  "verifiedBy": "import-script-v1"
}
```

Cada pergunta gerada (depois da IA + validação):

```json
{
  "knowledgeId": "knw-cat20-adv-000123",
  "category": 20,
  "topic": "adivinha tradicional",
  "fact": "…",
  "answer": "Pente",
  "source": "MemóriaMedia",
  "sourceId": "mm:adivinha:12345",
  "confidence": 0.95,
  "ageBands": ["6-9"],
  "allowedFormats": ["ADIVINHA"],
  "q": "Tenho dentes mas não mordo. O que sou?",
  "clues": ["…"],
  "formatId": "ADIVINHA",
  "generatedAt": "…",
  "validationScore": 100
}
```

**Repetição:** `knowledgeId` + `sourceId` substituem/complementam `knowledgeKey` heurístico.

---

## Fases globais (macro-roadmap)

| Fase | Nome | Entregável |
|------|------|------------|
| **KR-0** | Fundações | Schema, tipos, manifest de fontes, política de confiança |
| **KR-1** | Categoria 20 — Adivinhas | Import + jogo só com repositório |
| **KR-2** | Categoria 20 — Curiosidades | Idem + regra 50/50 V/F |
| **KR-3** | Pipeline IA restrito | Prompt «formula a partir deste facto» (sem inventar) |
| **KR-4** | Integração jogo | `generateQuestion` escolhe facto → IA → valida |
| **KR-5** | Persistência | Supabase `knowledge_records` + `question_bank` ligado |
| **KR-6** | Admin & auditoria | Painel: origem, confiança, re-import, desactivar |
| **KR-7+** | Categorias 1–19 | Uma a uma (fontes fornecidas pelo utilizador) |

---

## KR-0 — Fundações (pré-requisito)

### KR-0.1 Schema e armazenamento — **Supabase** (decisão tomada)
- [x] Tabela `knowledge_records` — `supabase/knowledge-repository.sql`
- [x] RPC `pick_knowledge_record`, `import_knowledge_batch`, `disable_knowledge_record`, `get_knowledge_repository_stats`
- [x] Colunas `knowledge_id`, `source_id`, `confidence` em `question_bank`
- [x] Cliente browser `public/knowledge-repository.js`
- [ ] Executar SQL no projecto Supabase + seed de amostra (`seed-knowledge-cat20-sample.sql`)

### KR-0.2 Módulo `knowledge-repository.js`
- [ ] `loadRecords(category, filters)`
- [ ] `pickRecord(ctx)` — respeita idade, formato, não repetido, prioridade PT
- [ ] `getRecordById(knowledgeId)`
- [ ] `markUsed(knowledgeId, ageBandKey, sessionId)`

### KR-0.3 Política de confiança
- [ ] `confidence` mínimo por categoria (ex.: adivinhas ≥ 0.90)
- [ ] Bloquear geração se `source` não estiver na allowlist da categoria
- [ ] Campo `blocked` / `supersededBy` para correcções

### KR-0.4 Contrato IA
- [x] Novo prompt: `buildPromptFromFact(record, formatId, ageBandKey)` — **facto fornecido no prompt**
- [x] Proibir no system: «inventa um facto», «cria uma curiosidade»
- [x] Validador: resposta IA não pode contradizer `record.answer` / `record.fact`

---

## KR-1 — Categoria 20: Adivinhas

**Prioridade Portugal:** 95–100%  
**Regra:** sem geração livre pelo LLM.

### Fontes (fase 1)
| Fonte | Tipo | Notas |
|-------|------|-------|
| MemóriaMedia / Adivinhário | Primária | Coleção digital PT |
| Fundo Michel Giacometti | Primária | Folclore |
| Biblioteca Nacional de Portugal | Secundária | Validação / enriquecimento |
| Coleções tradicionais portuguesas | Primária | Manual + CSV após curadoria |
| Outras coleções folclore PT | Secundária | Por acordo de licença |

### KR-1.1 Inventário e import
- [ ] Definir formato de import (`scripts/import-knowledge-adivinhas.js`)
- [ ] Campos obrigatórios: `fact`, `answer`, `clues[]`, `source`, `sourceId`
- [ ] Normalização PT-PT (Priberam para variantes ortográficas)
- [ ] Deduplicação por `answer` + similaridade de `fact`
- [ ] Meta: **≥ 200 adivinhas** verificadas para MVP

### KR-1.2 Validação de import
- [ ] Testes automáticos: clues não revelam resposta
- [ ] Idade mínima por vocabulário
- [ ] Rejeitar adivinhas ambíguas (regras `known-facts` + heurísticas)

### KR-1.3 Jogo (só adivinhas)
- [x] Em `category.n === 20` + formato `ADIVINHA`: **só** `pickRecord` do repositório
- [x] IA recebe `record` completo; gera apenas `q` + reordena `clues` + `distractors`
- [x] Fallback: banco local de perguntas já validadas — **não** LLM livre
- [ ] Telemetria: `% perguntas com source ≠ ai`

### KR-1.4 Critérios de aceitação
- [ ] 0 perguntas de adivinha sem `knowledgeId` em produção
- [ ] Reporte de pergunta mau → desactiva `knowledgeId` no repositório
- [ ] Testes 150+ passam; novos testes KR-1 (import + pick + no-hallucination)

---

## KR-2 — Categoria 20: Curiosidades

**Prioridade Portugal:** ~50–60%  
**Formato:** CURIOSIDADE + **50% Verdadeiro/Falso**

### Fontes
| Fonte | Peso PT |
|-------|---------|
| RTP / RTP Ensina | Alto |
| Ciência Viva | Alto |
| Museus portugueses | Alto |
| Instituições científicas PT | Médio |
| UNESCO | Médio |
| Wikidata | Estruturado |
| Repositório próprio curiosidades | Crescimento contínuo |

### Critérios da curiosidade
- Verdadeira e verificável  
- Surpreendente mas clara  
- Não controversa  
- Adequada à idade  
- Em PT-PT natural  

### KR-2.1 Import curiosidades
- [ ] Schema: `fact` + `answer` (ou `statement` + `isTrue` para V/F)
- [ ] Flag `supportsTrueFalse: true`
- [ ] Meta: **≥ 150 curiosidades** MVP

### KR-2.2 Alternância 50/50
- [ ] `chooseFormat` para cat. 20 curiosidade: 50% `CURIOSIDADE`, 50% `VERDADEIRO_FALSO` derivado do mesmo `fact`
- [ ] V/F: gerar afirmação a partir de `record.fact`; resposta = Verdadeiro/Falso

### KR-2.3 Validação reforçada
- [ ] `validateFactualConsistency` + comparar resposta IA com `record`
- [ ] Opcional: factual-verify só como **último recurso** para curiosidades Wikidata

---

## KR-3 — Pipeline IA restrito

### Novo fluxo em `generateQuestion`
```
1. pickRecord(category, ageBand, format, history)
2. if (!record) → fallback banco / mensagem «sem stock» (NÃO LLM livre em cat. 20)
3. prompt = buildPromptFromFact(record, …)
4. parsed = await callAI(prompt)
5. assertAnswerMatchesRecord(parsed, record)
6. validateQuestion(parsed, ctx)
7. persistQuestion + markUsed(knowledgeId)
8. saveToQuestionBank com source, sourceId, knowledgeId
```

### Módulos novos
| Ficheiro | Responsabilidade |
|----------|------------------|
| `knowledge-repository.js` | Load, pick, usage |
| `knowledge-prompt.js` | Prompts «só formulação» |
| `knowledge-assert.js` | IA não alterou o facto/resposta |

---

## KR-4 — Integração com motor actual

- [ ] `collectRepetitionIssues`: priorizar `knowledgeId` sobre heurística
- [ ] `persistent-history`: guardar `knowledgeId`, `source`, `sourceId`
- [ ] `question-bank` SQL: colunas `knowledge_id`, `source_id`, `confidence`
- [ ] Admin reports: mostrar origem da pergunta

---

## KR-5 — Admin e auditoria

- [ ] Painel: listar `knowledge_records` por categoria/fonte
- [ ] Acção: desactivar registo após reporte
- [ ] Export CSV para curadoria
- [ ] Métricas: cobertura por categoria (% jogos com repositório vs fallback)

---

## KR-7+ — Restantes categorias (template)

Para cada categoria **1–19**, repetir mini-roadmap:

### Template `KR-CAT-XX`

1. **Definir fontes** (utilizador fornece URLs, APIs, dumps)  
2. **Prioridade PT** (% alvo)  
3. **Formatos permitidos** (da matriz `engine-config`)  
4. **Import script** (`import-knowledge-catXX.js`)  
5. **Meta de stock** (N registos MVP)  
6. **Validadores específicos** (se necessário)  
7. **Activar no jogo** (flag `useKnowledgeRepository[category]`)  
8. **Desactivar LLM livre** quando stock ≥ limiar  

### Ordem sugerida (após cat. 20)

| Ordem | Cat. | Motivo |
|-------|------|--------|
| 1 | 2 Geografia | Wikidata forte, factual-verify já activo |
| 2 | 3 História | BNP, Arquivo.pt |
| 3 | 4–6 Ciência/Natureza/Espaço | Ciência Viva, NASA/ESA |
| 4 | 8–10 Literatura/PT/Arte | BNP, museus |
| 5 | 12 Música | MusicBrainz |
| 6 | 14–15 Gastronomia/Desporto | Fontes PT + Wikidata |
| 7 | 17 Tecnologia | Inventos + Wikidata (cuidado com datas) |
| 8 | Restantes | Conforme fontes disponíveis |

**Placeholder por categoria** — preencher quando o utilizador fornecer fontes:

| Cat. | Nome | Fontes (a definir) | Prioridade PT | Stock MVP |
|------|------|-------------------|---------------|-----------|
| 1 | Conhecimentos Gerais | | | |
| 2 | Geografia | Wikidata, … | | |
| … | … | | | |
| 19 | Transportes | | | |

---

## Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Stock insuficiente | MVP cat. 20 grande; fallback banco, não LLM livre |
| Licenças | Campo `license` + allowlist por fonte |
| IA altera facto | `assertAnswerMatchesRecord` + rejeição automática |
| Duplicados | `knowledgeId` + dedup na importação |
| Manutenção | `verifiedAt`, re-import incremental, admin |

---

## Métricas de sucesso

- **≥ 95%** perguntas cat. 20 com `knowledgeId` e `source` ≠ `ai`
- **0** adivinhas geradas sem registo de repositório
- Tempo médio de geração ≤ actual + 10%
- Reportes «facto errado» ↓ vs baseline LLM-livre

---

## Próximo passo imediato

1. **Supabase SQL Editor** — executar `supabase/knowledge-repository.sql` e `supabase/seed-knowledge-cat20-sample.sql`
2. Fornecer formato/export da primeira fonte real (MemóriaMedia ou CSV)
3. **KR-2** — curiosidades + 50/50 V/F a partir do repositório
