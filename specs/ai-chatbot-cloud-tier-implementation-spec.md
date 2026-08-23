# AI chatbot — cloud tier for `propose_ecriture` (design + verified facts)

## Why this exists

Two rounds of CPU-latency/reliability benchmarking (2026-08-17, see
`ai-chatbot-phase2-implementation-spec.md` §5/§5b and CLAUDE.md "AI
chatbot Phase 2") tried four local models across five prompt variants —
`qwen2.5:7b`, `qwen2.5:3b`, `llama3.2:3b`, `qwen2.5-coder:7b` — on the
invoice→`propose_ecriture` task specifically. All four failed to
reliably produce a valid, gate-checkable tool call: timeouts, empty
responses, prose instead of a call, fabricated pseudo-code, and (the
coder-tuned model) well-formed-looking JSON written as plain text
instead of a real structured tool call. The read side (Phase 1, the
16-tool `ReadToolsService`) is unaffected and stays local — this is a
verified, scoped finding about the WRITE path specifically, not a
reason to add cloud everywhere.

This spec covers the design reviewed and approved by the user
(2026-08-23) for a cloud-tier adapter scoped to `propose_ecriture`
only, plus the residency/DPA facts that consent copy depends on —
**verified against each provider's own current primary-source policy
pages this session, not inferred or carried over from training data**,
per the same "cite the primary source, don't re-derive from memory"
discipline this codebase already applies to the CGI, the PCG, and the
CA3/DSF forms.

## Approved architecture

- **`ChatModelPort`** (renamed from `LocalModelPort`, commit `79b8306`
  — pure mechanical rename, zero behavior change, 377 tests pass
  unmodified) is the one interface every model implementation speaks.
  `OllamaLocalModelAdapter` is unchanged and stays the only binding in
  `chat-model.module.ts`'s default DI — nothing about the default,
  read-side path changes.
- **Cloud adapters implement the same port**, injected at a SEPARATE,
  explicitly-gated call site (not the default binding) — `ChatModelPort`
  itself no longer asserts "never external network" the way
  `LocalModelPort` did; that constraint now lives on
  `OllamaLocalModelAdapter` specifically (see its own doc comment).
  Planned: `ClaudeCloudModelAdapter` (build first — verified terms, see
  below), `DeepSeekCloudModelAdapter` (build second — verified terms,
  but with a real training-data caveat, see below). Both host-pinned
  (`api.anthropic.com` / `api.deepseek.com` only, HTTPS enforced, no
  configurable base URL — unlike the local adapter's, which is meant to
  be pointed anywhere on the LAN).
- **OpenAI-compatible escape hatch is explicitly DEFERRED**, per the
  user's own instruction: a custom-endpoint adapter can't carry a
  stated residency/DPA guarantee (the endpoint is arbitrary), and it's
  the least-tested path. Ship the two providers whose terms can
  actually be stated first; if added later, its consent copy must say
  "vous êtes responsable du traitement des données par ce point de
  terminaison — nous ne pouvons pas indiquer où vont ces données",
  never inherit the Claude/DeepSeek copy by default.
- **A narrow, separate cloud tool registry** (`CloudProposeToolsService`
  or equivalent) — `propose_ecriture` plus only `search_accounts` and
  `list_vat_rates` (the resolution tools a proposal actually needs).
  Never the full 16-tool `ReadToolsService` — no code path lets a cloud
  turn reach `query_liasse`/`query_cash_flow`/any report. This is
  minimization BY CONSTRUCTION (the same "grep the module for proof"
  discipline Phase 1 used for its own write-incapability claim), not a
  filter that could have a bug.
- **Granularity: per-invocation, explicit action, bounded to one
  proposal thread** — not a global cloud toggle, not automatic on file
  attach. The composer's default send is always local. A second,
  distinct action ("☁️ Proposer avec [Provider]") appears only when
  cloud is configured AND there's something to propose from. Clicking
  it opens a bounded cloud-proposal thread that stays cloud-routed only
  for direct follow-ups within it, and reverts to 🔒 local the moment
  the proposal is confirmed, discarded, or the user sends anything
  unrelated — plus an explicit "Revenir au local" always available.
  **Enforced server-side**, not just by the UI: `engine: "cloud"` is
  only honored when a `CloudModelCredential` exists for that
  company+provider AND the turn carries a `filePrelude` or continues an
  already-open `cloudProposalThreadId` on the session.
- **Always-visible indicator, three places**: the composer (before
  sending, so the user knows the mode BEFORE committing), every
  persisted assistant message (a permanent badge next to the
  timestamp — a thread can start cloud and revert local mid-conversation,
  so history must show both truthfully), and the `ProposalCard` header
  (the highest-stakes surface, most visually loud). Badge vocabulary:
  🔒 Local (model name) / ☁️ Claude / ☁️ DeepSeek.

## Data minimization — exact cloud-proposal payload

| Sent | Not sent |
|---|---|
| Static system prompt (business logic only, no company data) | Prior local chat history from the session |
| `ChatContextService` injection: fiscal-year **ids + labels**, journal **codes + labels** | Any account balance, trial balance, or ledger total |
| `extract_invoice_facts` result: parsed fields + **rawText** (the full invoice document text) | Other invoices/attachments from earlier in the session |
| Whatever `search_accounts`/`list_vat_rates` results the model needs for THIS proposal | `query_liasse`/`query_cash_flow`/any report — the cloud registry can't reach them |
| The user's own typed message for that turn | The company's SIREN, address, or any field not needed for this écriture |

The invoice `rawText` is the single most sensitive item in that list —
the consent copy names it explicitly, not just "accounting data."

## Verified residency/DPA facts (2026-08-23) — cited, primary sources

**Anthropic / Claude API:**

- Server location / EU residency: Anthropic's own privacy article
  states inference traffic may route to "select countries in the US,
  Europe, Asia and Australia" depending on configuration, but **"data
  is stored in the US"** regardless of routing — there is no true EU
  data-residency option on the first-party API (`api.anthropic.com`);
  EU residency exists only via a different deployment path entirely
  (AWS Bedrock `eu-central-1`, GCP Vertex AI EU) that this adapter does
  not use. — [Where are your servers located? (privacy.claude.com)](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)
- DPA: Anthropic's Commercial Terms of Service, Section C: **"Data
  submitted through the Services will be processed in accordance with
  the Anthropic Data Processing Addendum ('DPA'), which is
  incorporated into these Terms by reference."** — [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms)
- Training on API data: same Commercial Terms, Section B: **"Anthropic
  may not train models on Customer Content from Services."** — no
  training on API prompts/completions by default.

**DeepSeek API:**

- Server location: DeepSeek's own Privacy Policy, both in the main
  "Where We Store Your Personal Data" section and the EEA supplemental
  section: **"we directly collect, process and store your Personal
  Data in People's Republic of China."** No EU or US data-residency
  option is offered for the API. Controlling entity: Hangzhou DeepSeek
  Artificial Intelligence Co., Ltd. (China). — [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- Training on submitted data — **a material fact beyond the original
  residency flag, found this session, not previously stated**:
  DeepSeek's Terms of Use, §4.3: **"we may, to a minimal extent, use
  Inputs and Outputs to provide, maintain, operate, develop or improve
  the Services or the underlying technologies supporting the
  Services."** An opt-out exists ("Improve the model for everyone")
  but is documented for the consumer product; **no API-specific
  opt-out is documented in the terms as fetched**. Unlike Anthropic,
  DeepSeek's terms do not state an exclusion for API customer content.
  — [DeepSeek Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html)
- No GDPR adequacy decision exists for the People's Republic of China.

**How to apply**: the DeepSeek consent dialog must disclose BOTH facts
— China-only storage with no adequacy decision, AND potential use of
submitted content (including invoice `rawText`) to improve DeepSeek's
own models with no confirmed API opt-out — not just the residency
line originally scoped. This is a stronger disclosure than Claude's
dialog needs, and the two must not be templated identically.

## Consent copy (French, final draft)

Settings → "Assistant IA" → "Propositions via un fournisseur cloud
(optionnel)", toggle default **OFF**. Enabling opens a dialog (not a
single click), checkbox required before "Activer" is enabled.

**DeepSeek:**

> **Activer les propositions via DeepSeek ?**
>
> En activant cette option, le contenu des factures que vous joignez
> (texte complet du document, montants, TVA, dates) ainsi que les
> identifiants d'exercices et de journaux de votre dossier seront
> envoyés aux serveurs de DeepSeek, en dehors de cet ordinateur, afin
> de générer une proposition d'écriture fiable. Le solde de vos
> comptes et l'historique de votre comptabilité ne sont **jamais**
> transmis. Chaque envoi est déclenché explicitement par vous via le
> bouton "☁️ Proposer avec DeepSeek" — l'assistant reste 100 % local
> pour toutes les autres questions.
>
> DeepSeek (Hangzhou DeepSeek Artificial Intelligence Co., Ltd.) stocke
> et traite ces données en République populaire de Chine, un pays sans
> décision d'adéquation RGPD. Les conditions d'utilisation de DeepSeek
> indiquent qu'elles peuvent être utilisées pour améliorer ses
> services, sans mécanisme de retrait documenté spécifique à l'API.
> Consultez sa politique de confidentialité avant d'activer : [lien].
>
> ☐ *J'ai compris que ces données quittent l'Union européenne, peuvent
> être utilisées par DeepSeek pour améliorer ses services, et j'accepte
> de les envoyer.*
>
> [Annuler] [Activer] *(désactivé tant que la case n'est pas cochée)*

**Claude:**

> **Activer les propositions via Claude (Anthropic) ?**
>
> En activant cette option, le contenu des factures que vous joignez
> (texte complet du document, montants, TVA, dates) ainsi que les
> identifiants d'exercices et de journaux de votre dossier seront
> envoyés aux serveurs d'Anthropic, en dehors de cet ordinateur, afin
> de générer une proposition d'écriture fiable. Le solde de vos
> comptes et l'historique de votre comptabilité ne sont **jamais**
> transmis. Chaque envoi est déclenché explicitement par vous via le
> bouton "☁️ Proposer avec Claude" — l'assistant reste 100 % local pour
> toutes les autres questions.
>
> Anthropic traite ces données conformément à son Data Processing
> Addendum (clauses contractuelles types incluses) et n'entraîne pas
> ses modèles sur le contenu envoyé via l'API. Les données sont
> stockées aux États-Unis (pas de résidence des données dans l'UE sur
> cette offre). Consultez sa politique de confidentialité avant
> d'activer : [lien].
>
> ☐ *J'ai compris que ces données quittent cet ordinateur (stockées
> aux États-Unis) et j'accepte de les envoyer à Anthropic.*
>
> [Annuler] [Activer] *(désactivé tant que la case n'est pas cochée)*

After enabling: a password-masked API-key field, "Enregistrer" as the
only action — the key is never redisplayed, only shown masked
(`sk-...ab12`) afterward.

## Credential storage — the real threat model

**"Encrypted at rest" is only as strong as where the encryption key
lives — stating that honestly, not implying more:**

- New `CloudModelCredential` table (`companyId` FK, unique on
  `companyId`+`provider`, `encryptedApiKey`, never a plaintext column)
  — same per-company scoping as every other domain table.
- Encrypted with AES-256-GCM (Node's `crypto`), using an application
  key kept OUTSIDE the database — a new `CLOUD_CREDENTIAL_ENCRYPTION_KEY`
  in `backend/.env` (gitignored, same as `DATABASE_URL`), never in the
  same place as the ciphertext it protects.
- **What this defends against**: a leaked/stolen database backup or
  `pg_dump`, casual inspection of the database, a DB-only compromise
  (e.g. a read-only SQL access path) — none of these alone can decrypt
  a stored key.
- **What this does NOT defend against, stated plainly rather than
  implied away**: a user/attacker with full filesystem access to the
  machine (who can read both `.env` and the database), or a compromise
  of the backend process itself (which necessarily decrypts the key in
  memory to call the provider). For a local-first, single-user desktop
  deployment this is judged **acceptable — "your own machine, your own
  key"** is the actual guarantee, not a stronger one.
- **This threat model does NOT hold if this app is ever deployed
  multi-tenant on shared/cloud infrastructure** — the multi-tenant data
  model already anticipates that as a future flag-flip (see CLAUDE.md
  "Multi-tenant data model"). If that happens, this needs revisiting
  (a real KMS, per-tenant key derivation) before cloud credentials ship
  in that configuration. Not a blocker now — a documented limit, same
  discipline as every other "known scope boundary" in this codebase.
- Key never logged (a build-time requirement: verify no request/error
  logger dumps the Authorization header), never included in any API
  response, export, or chat transcript, sent only to the pinned
  provider host over TLS in exactly one header.

## Build order (agreed)

1. ~~`ChatModelPort` rename~~ — done, commit `79b8306`, verified against
   the existing 377-test suite, zero behavior change.
2. `CloudModelCredential` + key handling, with this threat model as the
   actual implementation spec.
3. `ClaudeCloudModelAdapter` (Claude first — the provider whose terms
   are most clearly stated above).
4. `DeepSeekCloudModelAdapter`.
5. The narrow cloud tool registry.
6. Consent flow + always-visible indicator (frontend).
7. Granularity/thread enforcement (server-side gate on `engine: "cloud"`).

OpenAI-compatible adapter: deferred, not on this list.
