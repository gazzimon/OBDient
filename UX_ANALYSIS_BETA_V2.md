# Análise UX/UI — OBDient Beta V2.0.0

> Documento de trabalho para o lançamento. Consolida as decisões de produto já
> tomadas, mapeia cada uma no código atual e propõe melhorias de UX/UI para o
> lançamento em português. Nada de código de app foi alterado ainda — este é o
> plano.

---

## 0. Decisões confirmadas (rev. 1)

1. **Rede de conhecimento P2P:** não é removida — é **renomeada e sempre ativa**,
   apresentada como recurso/diferencial: **"Memória distribuída embebida"**.
   "Embebida" = faz parte do produto, sem toggle de liga/desliga. (Detalhe em §2.4.)
2. **Um único nível de assistente:** a UI **não** mostra "júnior" vs "sênior". Há
   **um assistente**, e o **usuário seleciona** como ele responde (offline no
   aparelho × na nuvem). (Detalhe em §2.3.)
3. **Credencial do assistente na nuvem:** **proxy backend via serverless**
   (recomendado: Cloudflare Worker). A key da NVIDIA nunca vai ao app. (Detalhe em §4.)
4. **Idiomas:** **pt-BR / ES / EN**, com **seletor de idioma dentro de Settings**.
   pt-BR como primário. (Detalhe em §3.)

---

## 1. Princípio norteador do lançamento

O OBDient passa de "app de hackathon/dev" para **produto de consumo**. A régua
muda: o usuário final não sabe (nem deve saber) o que é Claude, Qwen3, Nemotron,
CARpsy, RAG federado ou Hypercore. Ele vê **um assistente que entende de carro**.

Consequência direta que atravessa todas as decisões abaixo:

> **Regra de ouro:** a UI nunca revela o modelo nem o provedor. Nenhum texto
> visível pode conter "Claude", "Anthropic", "CARpsy", "Qwen3", "Nemotron",
> "NVIDIA", "GPT", "API key", "token" ou versão de modelo.

Nomenclatura (rev. 1 — **um único assistente**, o usuário seleciona a fonte):

| Na UI | O usuário escolhe | O que é por trás (interno, nunca exposto) |
|---|---|---|
| **Assistente Sr** (um só nome) | **Offline** — rápido de custo, lento de resposta, funciona sem internet | modelo on-device (Qwen3-1.7B / CARpsy) |
| **Assistente Sr** (mesmo nome) | **Na nuvem** — resposta forte e completa | endpoint cloud (Nemotron/NVIDIA via proxy) |

Ou seja: **não** há "júnior" e "sênior" como dois personagens. Há **o Assistente
Sr**, e o usuário decide se ele responde offline (no aparelho) ou na nuvem. A
diferença exposta é de **modo/fonte**, nunca de modelo.

---

## 2. Decisões de produto → mapa no código

### 2.1 Remover a "visão de desenvolvedor"

**O que muda:** eliminar por completo a superfície de desenvolvedor. O usuário
não vê toggle, nem painel de instrumentação, nem teste de P2P.

**Onde está:**
- Flag `developerMode` no store — [settingsStore.ts:44](src/store/settingsStore.ts#L44), default `false`, ações em [settingsStore.ts:57](src/store/settingsStore.ts#L57) e [settingsStore.ts:92](src/store/settingsStore.ts#L92), persistência em [settingsStore.ts:112](src/store/settingsStore.ts#L112).
- Consumo na tela: [settings.tsx:73-74](src/app/(tabs)/settings.tsx#L73-L74).
- Painel "P2P engine test (C0)" gated por `developerMode` — [settings.tsx:476-502](src/app/(tabs)/settings.tsx#L476-L502).
- Painel "Instrumentation" + `AuditPanel` — [settings.tsx:504-510](src/app/(tabs)/settings.tsx#L504-L510).
- Toggle "Developer mode" na seção About — [settings.tsx:521-534](src/app/(tabs)/settings.tsx#L521-L534).
- Também `runP2PSpike`/estado `spikeRunning`/`spikeReport` — [settings.tsx:80-94](src/app/(tabs)/settings.tsx#L80-L94).

**Recomendação:** remover a flag do store e todo o JSX gated. Manter
`AuditPanel`/`p2p-spike` no repositório como ferramenta de QA fora do build de
produção (ou atrás de uma constante de build), mas **fora da UI do usuário**.

**Risco:** baixo. É remoção de superfície opcional; nada do fluxo principal depende disso.

---

### 2.2 Remover o campo de token do Claude

**O que muda:** some a seção inteira "Claude AI" com o `TextInput` de API key.
O acesso ao Assistente Sr deixa de depender de o usuário colar uma chave.

**Onde está:**
- Seção "Claude AI" completa (label "Anthropic API Key", status CONFIGURED/NOT SET, contador de knowledge, input `sk-ant-…`, botão olho) — [settings.tsx:346-400](src/app/(tabs)/settings.tsx#L346-L400).
- Estado local `apiKeyInput`/`showApiKey`/`knowledgeCount` — [settings.tsx:58-67](src/app/(tabs)/settings.tsx#L58-L67).
- Campo `claudeApiKey` + ação no store — [settingsStore.ts:38](src/store/settingsStore.ts#L38), [settingsStore.ts:55](src/store/settingsStore.ts#L55).
- Gate de disponibilidade do sênior lê essa chave — [claude-api.datasource.ts:31-33](src/data/datasources/claude-api.datasource.ts#L31-L33) e [claude-api.datasource.ts:95-102](src/data/datasources/claude-api.datasource.ts#L95-L102).
- Mensagem "Agregá tu clave de Claude en Settings" no fluxo de sessão — [diagnostic-intake-session.ts:609-614](src/domain/usecases/diagnostic-intake-session.ts#L609-L614).

**Recomendação:** remover a UI e o campo do store. O `isConfigured()` do sênior
passa a **não depender de chave do usuário** (ver §2.6). A mensagem de "sem
sênior configurado" vira código morto — remover.

**Atenção (ver §4):** isso só é possível porque a credencial vai passar a viver
no app/servidor, não no usuário. Isso é uma decisão de **segurança**, não de UI.

---

### 2.3 Renomear tudo para "Assistente Sr" e esconder o modelo

**O que muda:** aplicar a regra de ouro (§1) em todos os textos visíveis.

**Strings a trocar (inventário):**

| Texto atual | Onde | Texto proposto (pt-BR) |
|---|---|---|
| `Consult senior advisor (Claude)` / `Consulting senior…` | [diagnostics.tsx:300-302](src/app/(tabs)/diagnostics.tsx#L300-L302) | `Falar com o Assistente Sr` / `Consultando o Assistente Sr…` |
| `CARpsy` (indicador "digitando") | [diagnostics.tsx:271](src/app/(tabs)/diagnostics.tsx#L271) | `Assistente` |
| `CARpsy Assistant` (header) | [settings.tsx:289](src/app/(tabs)/settings.tsx#L289) | `Assistente local` |
| `CARpsy · Qwen3-1.7B · runs offline` | [settings.tsx:296](src/app/(tabs)/settings.tsx#L296) | `Funciona offline, no seu aparelho` |
| Seção "Claude AI" | [settings.tsx:347](src/app/(tabs)/settings.tsx#L347) | (removida — §2.2) |
| `and bring in the senior diagnostician` (empty state) | [diagnostics.tsx:249-252](src/app/(tabs)/diagnostics.tsx#L249-L252) | copy pt-BR sem citar modelo |
| Ícone `account-tie` + cor roxa `#7C6AFE` | [diagnostics.tsx:291-302](src/app/(tabs)/diagnostics.tsx#L291-L302) | manter o padrão visual, ajustar só o texto |
| Fonte `source: 'claude'` / `'carpsy'` (interno) | [multi-agent-chat.ts:35](src/domain/usecases/multi-agent-chat.ts#L35), intake | **não** é texto de UI — pode ficar como enum interno, mas conferir se aparece em algum lugar renderizado (ex.: `ChatBubble`) |

> **Ação de verificação:** varrer `ChatBubble.tsx` e qualquer badge de origem de
> mensagem — se o enum `source` ('claude'/'carpsy') for renderizado como rótulo,
> mapear para "Assistente Sr" / "Assistente" na camada de apresentação.

**Decisão rev. 1 — um único assistente, o usuário seleciona a fonte.** Não há
"júnior/sênior" na UI. Existe **o Assistente Sr**, e o usuário escolhe se ele
responde **offline** (no aparelho, rápido de custo mas lento) ou **na nuvem**
(resposta completa). O seletor é de **modo**, não de modelo — nunca aparece
"Qwen3", "Nemotron" etc.

**Onde vive o seletor — decisão rev. 1: no cabeçalho do chat.** Um segmented
control pequeno no header ("Offline · Nuvem"), decisão em contexto por conversa.
Lugar no código: cabeçalho de [diagnostics.tsx:158-172](src/app/(tabs)/diagnostics.tsx#L158-L172).
Como o offline é lento (§2.5), o **default é Nuvem**; o usuário troca para offline
quando está sem internet ou quer resposta instantânea. Guardar a última escolha no
`settingsStore` para persistir entre sessões.

> **Implicação no fluxo:** isso substitui o botão único "Falar com o Assistente
> Sr" por uma ação cujo destino depende do modo selecionado. O CTA de fecho do
> intake (§2.5) executa o Assistente Sr **na fonte escolhida**.

---

### 2.4 "RAG federado" → "Memória distribuída embebida" (renomear, sempre ativa)

**Decisão rev. 1:** o recurso **não é removido** — é **renomeado** e vira parte
embebida do produto, **sem toggle de liga/desliga**. Nome na UI: **"Memória
distribuída embebida"**. Some o jargão ("RAG", "Distributed RAG", "P2P", "peers",
"trust"); fica um recurso que "funciona sozinho" e pode até ser mostrado como
diferencial (ex.: uma linha informativa de status, não um controle).

**O que muda na UI:**
- Trocar o rótulo "Distributed RAG" e a descrição técnica — [settings.tsx:408-411](src/app/(tabs)/settings.tsx#L408-L411).
- **Remover o toggle** (`Switch`) e a telemetria crua de peers/trust — [settings.tsx:413-452](src/app/(tabs)/settings.tsx#L413-L452). Se quiser mostrar que está viva, substituir por uma única linha tipo "Memória distribuída embebida · ativa" (status, não controle).
- Card "Contribute cases": decidir se vira parte da mesma "memória embebida" (sem toggle) ou se **permanece opt-in** — [settings.tsx:454-471](src/app/(tabs)/settings.tsx#L454-L471). Ver nota de consentimento abaixo.

**Backend:** continua rodando igual — [container.ts:25-33](src/data/container.ts#L25-L33), [container.ts:51-80](src/data/container.ts#L51-L80). Nenhuma mudança de lógica.

**Ação necessária no store:** como o recurso passa a ser "embebido/sempre ativo",
`knowledgeNetworkEnabled` (hoje default `false` — [settingsStore.ts:69](src/store/settingsStore.ts#L69)) precisa passar a **`true` por default** (ou ser forçado no boot), senão a rede nunca liga e "embebida" vira só um rótulo. Isso é troca de uma linha, mas com peso de privacidade (ver abaixo).

> **⚠️ Consentimento (não pular):** ligar compartilhamento P2P por padrão, sem
> toggle visível, precisa estar **coberto no onboarding/disclaimer e na política
> de privacidade do beta**. O que sai do aparelho já é redigido (sem VIN/placa —
> `redactText`, e `contributeCases` passa por gate), mas *compartilhar por
> default* é uma decisão legal, não só de UX. Recomendo: manter **`contributeCases`
> como opt-in explícito** (casos são mais ricos que fatos) mesmo que a "memória
> distribuída embebida" de leitura/fatos fique sempre ativa.

**Texto abaixo (versão original do plano) — mantido para referência:**
somem da UI todos os controles e telemetria de rede P2P /
conhecimento distribuído. O backend (Hypercore, harvest, trust registry) **continua
rodando exatamente igual** — só deixa de ser exposto e configurável pelo usuário.

**Onde está (só UI):**
- Seção "Knowledge network" + toggle "Distributed RAG" + peers/trust stats — [settings.tsx:402-452](src/app/(tabs)/settings.tsx#L402-L452).
- Card "Contribute cases" — [settings.tsx:454-471](src/app/(tabs)/settings.tsx#L454-L471).
- Estados/efeitos que alimentam esses cards: `peerCount`, `trustStats`, intervalo de 5s — [settings.tsx:76-77](src/app/(tabs)/settings.tsx#L76-L77), [settings.tsx:106-116](src/app/(tabs)/settings.tsx#L106-L116).
- Imports só usados por esses cards: `hypercoreKnowledge`, `trustRegistry` — [settings.tsx:12-13](src/app/(tabs)/settings.tsx#L12-L13).

**Backend que NÃO se toca:**
- Boot da rede em [container.ts:25-33](src/data/container.ts#L25-L33) (lê `knowledgeNetworkEnabled` do store).
- `harvestOutbox`, `knowledgeReturn`/`claudeKnowledge`, `caseLog` — [container.ts:51-80](src/data/container.ts#L51-L80).

**Decisão pendente (produto):** ao remover o toggle, qual vira o **default** de
`knowledgeNetworkEnabled` e `contributeCases`?
- Hoje ambos default `false` — [settingsStore.ts:69-70](src/store/settingsStore.ts#L69-L70). Se ficarem escondidos e `false`, a rede **nunca liga** e o "backend segue funcionando" na prática não acontece.
- Para o backend seguir ativo sem UI, é preciso setar o default (ou forçar no boot) para ligado. **Isso é uma decisão de privacidade/consentimento:** ligar compartilhamento P2P sem toggle visível precisa estar coberto pelo disclaimer/onboarding e pela política de privacidade do beta.

> **Recomendação:** manter os campos no store (sem UI) e decidir explicitamente o
> default. Se o beta deve rodar a rede, ligar via boot e cobrir no consentimento;
> se não, aceitar que "backend intacto" significa "código presente, dormente".
> Não deixar isso implícito — é o único ponto das 6 decisões com implicação legal.

---

### 2.5 Assistente local é lento → botão do Assistente Sr como último passo do intake

**Problema:** o modelo local (CARpsy) é muito lento para o diagnóstico. Hoje o
fluxo **força** um diagnóstico local antes de oferecer o sênior:

```
intake (identidade → sintoma → sentidos → condições)
   → localDiagnosis()  ← roda o modelo local, LENTO
   → phase 'awaiting_senior'
   → só então aparece o botão "seniorOffer"
```

Ver [diagnostic-intake-session.ts:465-483](src/domain/usecases/diagnostic-intake-session.ts#L465-L483) (decisão de encerrar o intake) e
[diagnostic-intake-session.ts:562-598](src/domain/usecases/diagnostic-intake-session.ts#L562-L598) (`localDiagnosis` que chama o júnior lento).
O botão na UI é o `seniorOffer` — [diagnostics.tsx:286-305](src/app/(tabs)/diagnostics.tsx#L286-L305), estado em [useChatVM.ts:29](src/presentation/viewmodels/useChatVM.ts#L29).

**Mudança pedida:** quando o intake determinístico termina de coletar o caso, o
**último "passo" é o próprio botão do Assistente Sr** — não o diagnóstico local
lento. E o usuário **sempre** pode chamar o Assistente Sr.

**Como implementar (proposta):**
1. Ao concluir a régua determinística (identidade + ≥1 sintoma + condições), em
   vez de chamar `localDiagnosis()`, emitir uma mensagem-CTA de fechamento do
   tipo: *"Já montei o caso do seu veículo. Quer que eu chame o **Assistente Sr**
   para o diagnóstico completo?"* e ligar `seniorOffer = true` **sem** rodar o
   modelo local. → editar o ramo de conclusão em [diagnostic-intake-session.ts:465-483](src/domain/usecases/diagnostic-intake-session.ts#L465-L483).
2. Tornar o diagnóstico local **opcional/secundário** (ex.: link "prefiro uma
   resposta rápida offline") em vez do caminho padrão — assim quem não tem
   conexão ainda tem saída, mas ninguém espera o modelo lento por padrão.
3. Deixar o botão do Assistente Sr disponível **em qualquer ponto** do intake,
   não só no fim — o usuário pode pular a entrevista se já sabe o que quer.
   Hoje `seniorOffer` só aparece em `awaiting_senior`; passar a permitir o
   handoff a partir de `intake` também (o `requestSenior` monta o brief com o
   que houver — ver [diagnostic-intake-session.ts:604-683](src/domain/usecases/diagnostic-intake-session.ts#L604-L683), que já reconstrói o brief do estado atual).

**Efeito colateral positivo:** com o sênior sempre disponível (§2.6), o gate
`senior.isConfigured()` que hoje condiciona `seniorOffer` ([diagnostic-intake-session.ts:587-589](src/domain/usecases/diagnostic-intake-session.ts#L587-L589), [useChatVM.ts:181](src/presentation/viewmodels/useChatVM.ts#L181)) passa a ser sempre verdadeiro → o botão aparece sempre.

**Risco:** médio. Mexe na máquina de estados da sessão. Há testes em
[diagnostic-intake-session.test.ts](src/__tests__/diagnostic-intake-session.test.ts)
que vão precisar refletir o novo caminho de conclusão. Fazer com testes primeiro.

---

### 2.6 Endpoint do Assistente Sr → NVIDIA Nemotron

**O que muda:** o `converseSenior` deixa de falar com a API da Anthropic e passa
a falar com o endpoint OpenAI-compatível da NVIDIA (`nvidia/nemotron-3-ultra-550b-a55b`).

**Onde está:** todo o [claude-api.datasource.ts](src/data/datasources/claude-api.datasource.ts) — URL, modelo, headers, schema de resposta, `isConfigured`. Wiring do port em [container.ts:41-46](src/data/container.ts#L41-L46).

**Diferenças técnicas a tratar na reescrita:**
- **Schema:** Anthropic (`/v1/messages`, `x-api-key`, `system` separado, `content` em blocos) → OpenAI (`/v1/chat/completions`, `Authorization: Bearer`, `system` como mensagem `role:"system"`, `choices[].message.content`).
- **Streaming + reasoning:** o exemplo usa `stream: true` e `reasoning_content`. Para a UX, **descartar o `reasoning_content`** (é o "pensamento" do modelo — nunca mostrar ao usuário; expõe o modelo e polui o chat) e transmitir só o `content`. Se não formos fazer streaming incremental na UI agora, chamar sem `stream` simplifica a primeira versão.
- **Prompt-cache:** o mecanismo `cache_control: ephemeral` da Anthropic ([claude-api.datasource.ts:48-73](src/data/datasources/claude-api.datasource.ts#L48-L73)) não existe igual na NVIDIA — remover; reavaliar custo por chamada.
- **System prompt:** hoje em inglês ([claude-api.datasource.ts:16-21](src/data/datasources/claude-api.datasource.ts#L16-L21)). Manter a instrução "responda no idioma do dono" (bom para pt-BR automático) e "nunca peça VIN/placa/dados pessoais".
- **Contrato de dados:** o redaction upstream (VIN/placa/e-mail) continua valendo — [diagnostic-intake-session.ts:704-705](src/domain/usecases/diagnostic-intake-session.ts#L704-L705), `redactText`. Confirmar que segue aplicado no novo caminho.
- **`isConfigured()`:** com a credencial no app/servidor, retorna `true` sempre (não lê mais `claudeApiKey`).
- **Renomear o arquivo/datasource** para algo neutro (ex.: `senior-agent.datasource.ts`) para não carregar "claude" no código — cosmético, mas evita vazar o provedor em stack traces/logs.

**Nota de dependência:** o exemplo usa o SDK `openai`. Em React Native/Expo, o SDK
`openai` funciona mas puxa dependências de Node; muitas vezes é mais leve fazer
`fetch` direto no endpoint `/v1/chat/completions` (o código atual já usa `fetch`).
Recomendo `fetch` para não engordar o bundle. **Antes de codar, ler os docs
versionados do Expo (v56)** conforme AGENTS.md.

---

## 3. Localização pt-BR — o maior gap do lançamento

O lançamento é **em português**, mas hoje o app fala **só inglês e espanhol**.
Isso é maior que qualquer um dos itens acima e precisa entrar no escopo:

- **UI estática toda em inglês:** headers de Settings ("Vehicle Connection",
  "Alerts", "Polling", "About"), banners ("Adapter not connected…"), empty state
  do chat ([diagnostics.tsx:248-252](src/app/(tabs)/diagnostics.tsx#L248-L252)), placeholders ("Describe symptoms or ask anything…").
- **Régua de intake bilíngue ES/EN, sem PT:** todos os templates em
  [diagnostic-intake-session.ts:223-290](src/domain/usecases/diagnostic-intake-session.ts#L223-L290) e os nomes de campo [diagnostic-intake-session.ts:218-221](src/domain/usecases/diagnostic-intake-session.ts#L218-L221) só têm `es`/`en`.
- **Detecção de idioma sem PT:** `detectLanguage` e os dicionários `ES_WORDS`/`EN_WORDS` — [diagnostic-intake-session.ts:160-188](src/domain/usecases/diagnostic-intake-session.ts#L160-L188). Um usuário escrevendo em português cairá no fallback errado.
- **Mensagens de erro/sistema** hardcoded em ES/EN espalhadas pela sessão.
- **Disclaimer** (`DisclaimerNote`, `DisclaimerGate` de primeira execução) precisa de versão pt-BR.

> O **Assistente Sr** responde em português sozinho (o system prompt manda
> espelhar o idioma). O problema é toda a camada **determinística e estática**,
> que não passa por modelo. Sem tradução, o usuário brasileiro vê perguntas de
> intake em espanhol/inglês. **Recomendo tratar PT como idioma primário** e, se o
> tempo apertar, entregar o beta só em PT (ES/EN podem virar follow-up).

Sugestão estrutural: extrair as strings para um módulo de i18n leve (o app não
parece ter um ainda) em vez de continuar com o padrão `lang === 'es' ? … : …`.

**Decisão rev. 1 — seletor de idioma em Settings (pt-BR / ES / EN):**
- Adicionar `language: 'pt' | 'es' | 'en'` ao `settingsStore` (default `'pt'`) com sua ação e persistência — [settingsStore.ts:18-74](src/store/settingsStore.ts#L18-L74).
- Nova seção em Settings ("Idioma") com um segmented control de 3 opções, seguindo o padrão visual dos pills de Polling — [settings.tsx:238-286](src/app/(tabs)/settings.tsx#L238-L286) como referência de estilo.
- O idioma **escolhido** passa a mandar na régua de intake e na UI estática, em vez da detecção automática. A detecção (`detectLanguage`) vira **fallback** para quando o usuário não escolheu (ou sobrescreve por mensagem, se quisermos manter). Adicionar os três idiomas em `templateQuestion`, `FIELD_NAMES`, `GAP_OBJECTIVES` e nos dicionários de detecção — [diagnostic-intake-session.ts:160-290](src/domain/usecases/diagnostic-intake-session.ts#L160-L290).
- O Assistente Sr (nuvem) já responde no idioma do usuário; garantir que o system prompt do proxy receba/instrua o idioma selecionado para consistência.
- **Escopo:** as 3 traduções (pt/es/en) multiplicam o trabalho de i18n — é o item de maior esforço do beta. Se o cronograma apertar, entregar pt-BR completo + es/en no que já existe, e completar es/en depois.

---

## 4. Segurança — bloqueador do item 2.6 (ler antes de codar)

A arquitetura atual **propositalmente não embute nenhuma credencial** no cliente.
O comentário em [claude-api.datasource.ts:95-102](src/data/datasources/claude-api.datasource.ts#L95-L102) explica: uma env `EXPO_PUBLIC_*` é
inlinada pelo Metro no bundle JS público e **extraível do APK** (audit C1). A key
do usuário morava só no aparelho dele justamente por isso.

Ao mover para uma key da NVIDIA embutida no app, essa proteção **cai**: qualquer
um que baixe o APK extrai a `nvapi-…` e usa sua cota/gera custo em seu nome.

**Decisão rev. 1 — proxy backend no repositório `obdient-seed`.** Confirmado: o
proxy vive em `obdient-seed/src/proxy/` — que **já existe como slot de fase D**
(ver [obdient-seed/src/proxy/README.md](../obdient-seed/src/proxy/README.md)). O
app chama esse endpoint; a key da NVIDIA vive só no servidor.

**Por que no seed e não numa serverless isolada:** o design de fase D já fixou que
o proxy é um **segundo transporte para o mesmo ingest store** (`src/ingest/store.mjs`)
— casos gerados pela nuvem podem entrar no mesmo pipeline de curadoria que os
casos P2P. Co-localizar com o seed dá acesso ao store e ao contrato de dados
(PROTOCOL.md) sem duplicar nada. É um **serviço Node** (o seed é Node ≥20, `fetch`
global), não uma função Cloudflare.

**Contrato do proxy (para a reescrita do datasource em §2.6):** o app manda
`POST /v1/senior` com `{ messages, language }`; o proxy adiciona o system prompt,
o modelo e a key. Assim a UI nunca conhece modelo, provedor nem endpoint —
coerente com a regra de ouro (§1). O request de NVIDIA é `/v1/chat/completions`
(schema OpenAI); o proxy **descarta `reasoning_content`** e devolve só `{ answer }`.

**Adaptação necessária ao README de fase D:** ele foi escrito para "forwards to the
**Claude** API". Trocar para NVIDIA/Nemotron. O resto das restrições (nunca recebe
VIN/BT/identidade; offline-first não é violado; não cria storage próprio) continua valendo.

**Duas mudanças de consequência a registrar:**
1. **Uptime passa a importar para a nuvem.** Hoje cada device tinha sua própria key
   (BYOK) — se o hub caísse, o senior seguia via key do usuário. Removendo BYOK, o
   Assistente Sr **na nuvem depende do proxy estar de pé**. O caminho **offline**
   (modelo local) não é afetado — offline-first se mantém para ele. O seed continua
   "build-time" para harvest/curadoria; só o proxy é runtime (o próprio README de
   fase D já assume isso: "only makes sense with a subsidized/B2B product model").
2. **Armazenar casos gerados pela nuvem exige o gate em Node.** O `store.addCase()`
   rejeita qualquer caso com `gate.passed !== true` — e o gate determinístico hoje
   só existe on-device (`diagnostic-gate.ts`). Para o proxy alimentar o store como
   "segundo transporte", é preciso **portar o gate para o seed** (fase D.2). Para o
   **lançamento**, o proxy pode ser um **encaminhador puro**: o app continua rodando
   seu gate e contribuindo pelo caminho P2P opt-in que já existe (§2.4 / `contributeCases`).
   Storage no proxy fica como enriquecimento posterior.

**Hospedagem — ecossistema Google (rev. 2):** o hub roda **dois serviços de vida
longa** — o daemon P2P do seed (Hyperswarm/DHT, feeds persistentes em `data/`) e o
proxy HTTP. Formas de runtime diferentes:

- O **seed NÃO cabe em serverless** (Cloud Run / Cloud Functions escalam a zero e
  têm filesystem efêmero → o daemon morre e os feeds se perdem). Precisa de uma
  **VM sempre ligada** com disco persistente.
- O **proxy** caberia em Cloud Run, mas como a VM do seed existe de qualquer
  forma, o mais simples é rodar **os dois na mesma VM** (`GCP Compute Engine`,
  e2-micro é elegível ao free tier), compartilhando `data/` — que é o que a fase
  D.2 quer (proxy como segundo transporte no mesmo store).

**Já implementado no `obdient-seed` para isso:**
- `src/serve.mjs` — lançador único que sobe seed + proxy como processos-filho
  isolados (crash de um não derruba o outro; saída não-zero → supervisor
  reinicia). Script `npm start`.
- `Dockerfile` — imagem que roda a unidade completa; `VOLUME /app/data` para os
  feeds; `EXPOSE 8787` (o seed é só P2P outbound, sem porta inbound).

**Passos de deploy (Compute Engine):** VM e2-micro → Docker (ou Node nativo +
systemd) → `docker run` com disco persistente montado em `/app/data` e
`NVIDIA_API_KEY` via **Secret Manager** → **Caddy** na frente para HTTPS
automático (Let's Encrypt) OU um HTTPS Load Balancer do GCP. Alternativa "separação
limpa" (mais peças): proxy no **Cloud Run** + seed numa VM — mas aí perdem o store
compartilhado (só relevante na fase D.2).

**Onde a credencial vive (correção importante):**
- ✅ A key fica **só no ambiente do host do proxy** (Secret Manager / env da VM).
- ❌ **Remover `NVIDIA_API_KEY` do `.env` do app OBDient** — o app é um cliente RN,
  não tem processo servidor que leia essa variável; ela ali não faz nada e é risco
  latente (basta alguém prefixar `EXPO_PUBLIC_` e ela vaza no APK). O `.env` do app
  não está versionado (verificado), mas mesmo assim o lugar é o host.
- O app só precisa da **URL do proxy** — essa sim pode ser `EXPO_PUBLIC_SENIOR_PROXY_URL`
  (uma URL não é segredo).

**Nunca:** commitar a key. A key `nvapi-2J0…` (colada no chat) está
**comprometida** — desabilitá-la. A `nvapi-oeFAQ…` (no `.env` do app) → mover para
o host e apagar do repo do app.

**Ação imediata:** a key `nvapi-2J0…` colada no chat deve ser considerada
**comprometida** — rotacione-a antes de qualquer uso em produção.

---

## 5. Polimentos de UX/UI adicionais para o beta

Itens de menor esforço que elevam a percepção de "produto pronto":

- **Versão do app:** hoje hardcoded `v0.1.7 (VIN UI)` — [settings.tsx:518](src/app/(tabs)/settings.tsx#L518). Trocar por `Beta 2.0.0` e, idealmente, ler de `app.json`/`expo-constants` em vez de string fixa.
- **Onboarding de 1ª execução:** com o modelo escondido e o Assistente Sr como
  caminho principal, uma tela curta explicando "descreva o problema → eu monto o
  caso → chamo o Assistente Sr" reduz a fricção inicial. Reaproveitar o
  `DisclaimerGate` que já existe como primeiro passo.
- **Seção "Assistente local" em Settings:** se o local vira secundário, decidir se
  o card de "carregar modelo" ([settings.tsx:288-344](src/app/(tabs)/settings.tsx#L288-L344)) continua visível. Sugestão: manter, mas rotular como "Modo offline (opcional)" e deixar claro que é mais lento.
- **Estado de erro do Assistente Sr:** as mensagens de falha de rede hoje são
  ES/EN ([diagnostic-intake-session.ts:676-681](src/domain/usecases/diagnostic-intake-session.ts#L676-L681)) — pt-BR + tom de produto ("Não consegui falar com o Assistente Sr agora. Tenta de novo em instantes.").
- **Botão do Assistente Sr:** manter o destaque visual (cor/ícone), mas garantir
  estados claros: disponível / consultando / indisponível-offline.
- **Copy do empty state e placeholders** em pt-BR, com tom acolhedor e sem jargão.

---

## 6. Ordem de implementação sugerida

Da menor à maior dependência/risco:

1. **Decisão de segurança (§4)** — define se 2.6 é proxy ou key embutida. *Bloqueia o resto do item do Assistente Sr.* Rotacionar a key exposta.
2. **Remoções puras de UI (§2.1, §2.2, §2.4)** — dev mode, token do Claude, cards de RAG federado. Baixo risco, limpam a tela imediatamente. Decidir o default de `knowledgeNetworkEnabled` (§2.4).
3. **Renomeações/copy + esconder modelo (§2.3)** — varredura de strings, incluindo `ChatBubble`/badges de origem.
4. **Localização pt-BR (§3)** — idealmente extrair i18n; no mínimo, templates de intake + detecção de idioma + UI estática.
5. **Endpoint Nemotron (§2.6)** — reescrever o datasource (fetch, schema OpenAI, descartar `reasoning_content`), atualizar `isConfigured`, renomear arquivo.
6. **Fluxo do intake (§2.5)** — CTA do Assistente Sr como fecho determinístico + sênior sempre disponível. Com testes primeiro (a máquina de estados tem cobertura).

---

### Decisões resolvidas (rev. 1)

- ✅ **§2.4** — recurso renomeado "Memória distribuída embebida", sempre ativo (não removido).
- ✅ **§2.3** — um único assistente; o usuário seleciona a fonte (offline × nuvem).
- ✅ **§2.6 / §4** — proxy backend serverless (Cloudflare Worker recomendado).
- ✅ **§3** — pt-BR / ES / EN com seletor em Settings; pt-BR primário.

### Decisões resolvidas (rev. 2)

- ✅ **§2.3** — seletor de fonte (offline × nuvem) **no cabeçalho do chat**; default Nuvem.
- ✅ **§2.4** — `contributeCases` permanece **opt-in explícito**.
- ✅ **§4** — proxy em **`obdient-seed/src/proxy/`** (slot de fase D já existente), serviço Node.

### Decisões resolvidas (rev. 3)

- ✅ **§4 host** — ecossistema Google: **Compute Engine (VM e2-micro)** rodando
  seed + proxy juntos via `serve.mjs`/Docker; HTTPS por Caddy ou LB. Cloud Run não
  serve para o seed (P2P de vida longa).
- ✅ **§4 credencial** — key só no host (Secret Manager); removida do `.env` do app;
  app recebe `EXPO_PUBLIC_SENIOR_PROXY_URL`.

### Ainda em aberto

- **§4 / D.2** — portar o gate determinístico para o seed agora (proxy alimenta o
  store) ou depois (proxy encaminhador puro no lançamento)? Recomendado: **depois**.
