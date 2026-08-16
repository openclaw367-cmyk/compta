# AI chatbot — Phase 1 (reads only) — design notes and go/no-go report

Built against an architecture reviewed and approved by the user before any
code was written (design pass: the local-inference abstraction, the
read/propose-write tool boundary, the write path's structural guarantee,
and the two-phase split). Phase 1 is the read-only half of that design:
`LocalModelPort` + `OllamaLocalModelAdapter`, the tool-calling
orchestration loop, the full read-only tool registry, local-only chat
persistence, and a chat UI showing tool-call traces. No write tool
exists anywhere in this pass — see §3.

**§6 and §6b below are the load-bearing sections.** They are the actual
input to the Phase 2 go/no-go decision — read them before building
anything on top of this module, the same way `resultat-fiscal.ts`'s own
doc comment insists its own "verified" claim be re-read before trusting
it. §6 records the original go/no-go finding; §6b records the two
follow-up experiments (a `llama3.1:8b` head-to-head, and a server-side
reference-resolution fix) that were run BEFORE any Phase 2 code, per
explicit instruction — read §6b's own scoping carefully, since it closes
one specific blocker (id resolution) and explicitly does not close
another (prose drift/fabrication over large payloads).

## §1 — The local-inference abstraction

`LocalModelPort` (`backend/src/modules/ai-chat/local-model/local-model.port.ts`)
is a plain interface — `complete()`, `isAvailable()` — with a normalized,
runtime-agnostic request/response shape (`LocalCompletionRequest`/
`LocalCompletionResult`/`LocalToolSpec`/`LocalToolCall`). Nothing outside
this file and its concrete adapters knows a specific local runtime
exists. `OllamaLocalModelAdapter` is the one implementation this pass
ships, talking to a local Ollama daemon's `/api/chat` over loopback HTTP
(`http://localhost:11434` by default — never a remote host without an
explicit env override).

**Deliberately no runtime factory** — `LocalModelModule` binds the
`LOCAL_MODEL_PORT` token to `OllamaLocalModelAdapter` with a plain
`useClass`, not a config-driven factory selecting between multiple
adapter classes. There is only one adapter today; building a selection
factory for a single implementation would be exactly the kind of
premature abstraction this codebase's own conventions rule out. Swapping
to a different local runtime later is: write a new class implementing
`LocalModelPort`, change the one line in `LocalModelModule`. Orchestration
code, the tool registry, and (in Phase 2) the confirmation gate never
change.

**Model name and connection are config, not code** — `LOCAL_MODEL_NAME`
(default `qwen2.5:7b`), `LOCAL_MODEL_BASE_URL` (default
`http://localhost:11434`), `LOCAL_MODEL_TIMEOUT_MS` (default `120000`),
see `backend/.env.example`. Picking a bigger or smaller local model later
needs no rebuild, just `ollama pull <name>` + an env change.

**Target model class**: 7-8B instruct, quantized, tool-calling-capable —
verified this pass against real installed models on the actual dev
machine (`qwen2.5:7b` Q4_K_M, `llama3.1:8b` Q4_K_M both present via
`ollama list`), not assumed. This is a real business-laptop-class model,
not a datacenter GPU model.

**Graceful degradation, verified two ways**: `isAvailable()` never
throws — a network error, an unreachable daemon, or a daemon reachable
but missing the configured model are all reported as
`{ available: false, detail }`, unit-tested for all three cases
(`ollama-local-model.adapter.spec.ts`). Live-verified: `GET
/ai-chat/availability` against the real running Ollama returned
`{"available":true,"detail":"qwen2.5:7b prêt via Ollama
(http://localhost:11434)."}`.

**A second, more important degradation path was found LIVE, not by
inspection — see §5.** A local-model timeout *mid-conversation* (not at
the availability check, but partway through an already-running
tool-calling turn) threw out of `ChatOrchestratorService.runTurn()`,
uncaught, and surfaced as a raw Nest `500 Internal server error` — the
same class of bug CLAUDE.md's VAT section already documents once before
("Guards must throw a NestJS exception, never a plain `Error`"). Fixed
in `AiChatService.sendMessage()`: the orchestrator call is now wrapped in
a try/catch, and a failure degrades to the exact same clean, persisted,
honest ASSISTANT-role message the "no model available" path already
used, never an opaque error. Covered by a dedicated regression test in
`ai-chat.service.spec.ts` ("degrades cleanly (never a raw 500) when the
orchestrator itself throws mid-turn") that reproduces the real failure
message observed live.

## §2 — The read tool registry

`ReadToolsService` (`backend/src/modules/ai-chat/tools/read-tools.service.ts`)
holds 16 tools, every one a thin dispatch onto an existing, already-tested
domain service method:

`search_accounts`, `list_tiers`, `list_journals`, `list_fiscal_years`,
`list_vat_rates`, `query_trial_balance`, `query_grand_livre`,
`query_vat_declaration`, `query_liasse` (+ `secondary` flag → the other
regime's comparison view), `query_cash_flow`, `query_financial_analysis`,
`query_resultat_fiscal`, `list_fixed_assets`,
`query_depreciation_schedule`, `search_ecritures`, `get_ecriture`.

**Enforced invariant: no tool's `execute` contains its own aggregation,
classification, or money arithmetic.** `search_accounts`'s only
non-passthrough logic is a plain substring filter over
`AccountsService.findAll()`'s own result (no money touched, no rows
combined) — the same presentational narrowing a `<select>` search box
already does client-side elsewhere in this app. `search_ecritures`'s only
non-passthrough logic is a plain equality filter on an already-present
field (`fiscalYearId`). Every other tool passes its arguments straight
into the underlying service call and returns the result untouched. A
question needing real new logic is a new/extended service method,
reviewed and tested on its own — not a shortcut taken here. Verified by
`read-tools.service.spec.ts`, which asserts each tool's underlying
service mock was called with the tool's own arguments and that the
tool's result is exactly what the mock returned.

**Errors are the underlying service's own errors, never swallowed into a
generic failure.** `ReadToolsService.execute()` catches whatever a tool
throws and returns `{ ok: false, error: err.message }` — the SAME message
a human would get calling the same REST endpoint (e.g. `"Fiscal year xyz
not found"`), fed back to the model as a tool result so it can retry or
explain. A missing required argument is caught the same way (see
`chat-tool.ts`'s `requireString`/`optionalString` helpers) rather than
crashing the turn.

## §3 — The write boundary (Phase 1: absent)

There is no `propose_ecriture` tool, no `EntriesService.create()` call
anywhere in this module's own code, and no import of any
write-capable service beyond what the read tools listed above need
(`EntriesService.findAll`/`.findOne` only — both read paths).
`AiChatModule`'s own doc comment states this is the actual proof of the
"write-incapable by absence" guarantee: grep the module for a write
tool and find none, rather than trust a runtime permission check that
could have a bug. Phase 2 adds exactly one new tool on top of this,
never a change to how Phase 1 behaves.

## §4 — Chat persistence (local-only)

Two new company-scoped Prisma models, `ChatSession`/`ChatMessage`
(migration `20260816131710_add_chat_history`), following the same
`companyId`-on-every-row convention as `EcritureLigne` — see CLAUDE.md
"Multi-tenant data model". A `ChatMessage` is deliberately the exact
shape replayed to the local model on every turn (role, content,
toolCalls, toolName, toolCallId), not a separate transcript format —
so a session reload never has to re-derive what the model saw. Nothing
here is ever sent anywhere but the local model this company's own
`AiChatModule` talks to: no telemetry, no analytics beacon, no external
call anywhere in this module — the local-first boundary applies to the
stored conversation, not just the live request, since a chat transcript
about this company's books is itself sensitive accounting data.

## §5 — Verification

**Unit tests (36 new, 333 backend tests passing overall)**: the
thin-dispatch invariant (`read-tools.service.spec.ts`, 13 tests), the
tool-calling loop including the iteration cap and error-feeding-back
(`chat-orchestrator.service.spec.ts`, 5 tests), the Ollama
request/response translation and all three availability outcomes
(`ollama-local-model.adapter.spec.ts`, 7 tests), and session persistence
including both graceful-degradation paths (`ai-chat.service.spec.ts`,
5 tests).

**Live, against the real installed Ollama (`qwen2.5:7b`) and both real
companies** — this is the actual verification the user asked for:
reads return the same numbers the corresponding screens show. For each
of `query_vat_declaration`, `query_liasse`, `query_cash_flow`, the raw
tool-result JSON captured in the persisted `ChatMessage` row was
compared byte-for-byte against the same endpoint called directly:

| Tool | FR demo company | Multi-year fixture |
|---|---|---|
| `query_vat_declaration` | ligne16 250.00, ligne23 150.00, ligneTD 100.00 — **exact match** | ligne16 0.00, ligneTD 0.00 (no VAT-tagged transactions) — **exact match** |
| `query_liasse` | totalActifNet/totalPassif 39355.00/39355.00 — **exact match** | timed out mid-turn on this fiscal year's larger payload (see §6) — degraded cleanly, no wrong number ever shown |
| `query_cash_flow` | fluxExploitation/Investissement/Financement 2355.00/6000.00/9000.00, variationTresorerie 17355.00 — **exact match** | 0.00/-86000.00/0.00, variationTresorerie -86000.00 — **exact match** |

Every number that DID come back matched exactly. The one call that
didn't complete failed by timing out, not by returning a wrong number —
and the fix from §1 turned that into a clean, honest, persisted message
rather than a crash. This distinction — data correctness vs. model/
infrastructure reliability — is the whole subject of §6.

**Frontend, live in the browser**: `AssistantPage` (route `/assistant`)
renders the full loop end to end on a freshly typed message — USER
bubble, a `🔧 tool_name(args)` trace line, an expandable
`▶ → résultat de tool_name` block showing the real pretty-printed JSON,
then the model's prose. Confirmed via the accessibility tree AND a
screenshot that the expanded trace shows the actual verified data
(`"resultatNet": "5405.00"`, matching §5's own table exactly). Layout
verified holds the pinned input bar and internally-scrolling message
list against `AppShell`'s own `overflow-y-auto` — needed `min-h-0` added
at three nesting levels (the page root, the sessions sidebar's list, the
message list) since a flex column child's default `min-height: auto`
would otherwise let the message list grow unbounded and push the input
form out of view; this was the one layout risk flagged before testing
and it was real (the omission was present until fixed here), now
confirmed correct live.

## §6 — Go/no-go: is Phase 2 buildable on this?

**Reads: yes, verified accurate.** Every number a tool call returned,
across both companies and three of the heaviest report-generating
endpoints in this app, matched the underlying screen's own number
exactly. The thin-dispatch discipline (§2) means this isn't a
coincidence of testing — a tool literally cannot compute a different
number than the screen, since it calls the same service method. This
part of the architecture is proven.

**Model orchestration (qwen2.5:7b): reliable ONLY when given resolved
IDs. Left to resolve them itself, it guesses instead of chaining
tools.** Observed live, twice, independently: asked "quel est mon
résultat comptable pour l'exercice 2026 ?" with no prior context, the
model called `query_resultat_fiscal` with `fiscalYearId: "2026"` (the
year label, not a real id) instead of calling `list_fiscal_years` first
— even though `list_fiscal_years`'s own tool description says "Most
other tools need a fiscalYearId — call this first." The gate caught it
correctly (`assertReferencesBelongToCompany`-style lookup →
`NotFoundException` → a structured tool-result error, never a wrong
answer) — but the model's OWN follow-up reasoning was also wrong: it
concluded prose like *"l'exercice 2026 n'est pas encore présent dans
notre comptabilité"* — false; the fiscal year exists, just under a
different id. The same guess-and-misinterpret pattern repeated on a
SECOND tool (`query_liasse`) in the SAME session, with the real id
sitting a few messages earlier in the visible conversation history —
the model did not reuse it. Only once explicitly told "list your fiscal
years first" (or given the real id directly in the prompt) did it chain
correctly and answer right.

**Separately: the model's prose over a large tool payload can drift or
fabricate small details even when the underlying data is completely
correct.** Two live examples, both captured in persisted transcripts:
asked to report `totalActifNet`/`totalPassif` from a `query_liasse`
call, the model's answer instead summarized an unrelated part of the
same JSON payload (the 2057 créances annex) and never mentioned the two
figures actually asked for — even though the raw tool result sitting
right above it in the trace had the correct numbers. Asked for
`query_cash_flow`, the model correctly quoted `resultatNet: 5 405,00 €`
but opened with *"le tableau des flux de trésorerie pour l'exercice
2023-2024"* — a fabricated year label; the actual fiscal year is 2026,
and the cash-flow response payload doesn't even contain a year field for
the model to have misread. **This is the concrete case for the tool-trace
UI being load-bearing, not cosmetic** — a user reading only the prose in
either example would be misled about which section of data was analyzed
or which fiscal year it referred to; the trace sitting right next to
that prose shows the real answer.

**A real infrastructure constraint, not just a model-quality one**: a
heavier fiscal year's `query_liasse` call (more fixed assets, more
annexes, a disposal, more écritures — the multi-year fixture, not the
small FR demo company) took long enough that the SAME turn's growing
conversation-history prompt pushed total latency past the 120-second
default timeout on this CPU-only test machine. Single-tool turns ranged
from roughly 15 seconds (a small payload, a fresh/warm model) to over
two minutes (a large payload, or a multi-step chain). This is real
target-hardware latency, not a worst case — Phase 2's UX has to account
for it regardless of the id-resolution question below.

**Explicit Phase 2 implication, stated as the actual decision, not a
formality**: a naive `propose_ecriture` flow that trusts the model to
resolve `journalId`/`fiscalYearId`/`compteId` itself before drafting an
écriture would be built on exactly the chaining behavior just shown to
be unreliable in this model. The structural gate from the original
design review still holds regardless — a hallucinated or guessed id
cannot reach a persisted row, `assertReferencesBelongToCompany` (or the
FK constraint underneath it) refuses it the same way it refuses a stale
id from a slow human client, so **safety is not in question**. What's in
question is **experience**: a user asking in one sentence to book an
entry could plausibly hit several rounds of "I don't have that account,
let me guess again" before a valid proposal appears, or fail the same
way `query_liasse` did above if the exchange runs long. Two ways to
close this gap, not mutually exclusive:

1. **A stronger local model.** `llama3.1:8b` is also installed on this
   machine and wasn't benchmarked this pass — a natural first cheap
   experiment before concluding the model class itself is the problem,
   since 7-8B is already the low end of what this app's design commits
   to supporting.
2. **A write flow that resolves references FOR the model, rather than
   trusting it to chain resolution calls.** Concretely: `propose_ecriture`
   itself (or a small pre-step) takes human-recognizable inputs the UI
   already resolves deterministically today — an account NUMBER (not id)
   the same way the journal grid's own autocomplete already works, the
   currently-open fiscal year (there is usually exactly one, per this
   app's own single-fiscal-year-open convention), a journal CODE — and
   the backend resolves those to real ids server-side before ever asking
   the model to fill in amounts and labels. This sidesteps the
   demonstrated weak point (multi-step tool chaining to resolve an
   opaque cuid) entirely, asking the model only for the part it's
   already shown itself competent at: reading a request and stating
   simple facts (an amount, a label, which of two accounts based on
   context) once the hard part is out of its hands.

**Recommendation**: try (2) first — it removes the demonstrated failure
mode structurally rather than hoping a bigger model papers over it, and
it's a smaller, more testable change than swapping model classes. (1)
is worth a cheap, separate benchmark (rerun a few of the §6 scenarios
against `llama3.1:8b`) regardless, since it costs nothing but time and
informs whether the model class itself needs revisiting later as
Phase 2 grows. **This is a real decision for the next session to make
before writing `propose_ecriture`, not a formality to nod past** — the
gate keeps Phase 2 safe either way; this choice is about whether it's
also usable.

## §6b — Follow-up: both cheap experiments run, both closed

Both recommendations from §6 were tried before any Phase 2 code —
**neither built `propose_ecriture`; this section is still input to that
decision, not the decision itself.** `ChatContextService`
(`backend/src/modules/ai-chat/chat-context.service.ts`) is the only
production change from this pass.

**Experiment (1) — `llama3.1:8b` head-to-head vs. `qwen2.5:7b`, same
prompts, same tools, before any fix.**

- **(a) id-guessing**: identical failure. Asked "quel est mon résultat
  comptable pour l'exercice 2026 ?" with no prior context, `llama3.1:8b`
  also called `query_resultat_fiscal` with `fiscalYearId: "2026"` (the
  label, not a real id) instead of calling `list_fiscal_years` first —
  the exact same mistake `qwen2.5:7b` made. Its own recovery reasoning
  was marginally better (correctly told the user to call
  `list_fiscal_years`, rather than `qwen2.5:7b`'s wrong conclusion that
  the fiscal year "doesn't exist yet") — but it still didn't call that
  tool itself, so the underlying failure is identical: **this is a
  general 7-8B-class tool-calling weakness observed across two different
  model families, not a `qwen`-specific quirk.**
- **(b)/(c) prose drift and latency**: `llama3.1:8b` was strictly worse
  on the one comparison that could be made. Asked the exact
  `query_liasse` question that `qwen2.5:7b` had answered in ~90 seconds
  (with correct raw data but drifted prose, see §6), `llama3.1:8b`
  **timed out at the 120-second cap on the same call** — no answer, no
  prose to evaluate for drift. This is the same, already-correctly-fixed
  graceful-degradation path from §1, working exactly as designed — but
  it means switching models would have made the demonstrated latency
  problem worse, not better, on this hardware.
- **Conclusion of experiment (1) alone**: no evidence that swapping to
  `llama3.1:8b` would have helped either weakness, and real evidence it
  would hurt latency. The model class was not the problem — see (2).

**Experiment (2) — server-side reference resolution, implemented and
tested against both models.**

`ChatContextService.buildContext()` eagerly fetches this company's own
record, all its fiscal years, and all its journals (three already-tested
service calls — `CompaniesService.findCurrent()`,
`FiscalYearsService.findAll()`, `JournalsService.findAll()` — the exact
same thin-dispatch discipline as every tool in §2) and formats their
REAL ids alongside their human labels directly into the system prompt,
every turn. `ChatOrchestratorService.runTurn()` now fetches and prepends
this block before every model call. The system prompt was updated to
tell the model explicitly: use these ids directly, never invent one from
a label, only call `list_fiscal_years`/`list_journals` if genuinely
missing information. Deliberately does NOT eagerly inject the chart of
accounts — a real company can have hundreds of accounts where it has a
handful of fiscal years/journals, so `search_accounts` remains the
resolution path for accounts (this wasn't the demonstrated failure
anyway — the model never mis-resolved an account, only fiscal years).

Covered by 6 new unit tests (`chat-context.service.spec.ts`, 5 tests —
the thin-dispatch discipline, the real-id-not-just-label assertion, the
closed/open fiscal year label, the empty-company case; plus one new
`chat-orchestrator.service.spec.ts` test confirming the context is
fetched and prepended every turn) — 339 backend tests passing overall.

**Result: the exact id-guessing failure from §6 is gone, on BOTH
models, verified live, not just unit-tested.** The identical prompt that
previously produced a guessed `fiscalYearId: "2026"` on both models now
produces a correctly-resolved `fiscalYearId: "cmrgmp9dr0002o5p8fhuk06x6"`
on the very first tool call, zero guessing, zero `list_fiscal_years`
detour, on both `qwen2.5:7b` (68s) and `llama3.1:8b` (88s) — re-run
fresh, same session-less conditions as the original failing test. Both
produced correct final answers (`5 405,00 €`, matching the verified
figure from §5).

**What this experiment does NOT claim to have fixed** — scoped
honestly: this targets id-resolution specifically. It does not address
(and wasn't expected to address) the separate prose-drift/fabrication
weakness from §6 (a model still summarizing the wrong section of a large
tool payload, or inventing a detail not present in the data) — that
remains a live risk the tool-trace UI exists to mitigate, unrelated to
whether an id was resolved correctly. It also doesn't change the
underlying per-call latency for a genuinely large payload (a heavy
`query_liasse` call is still a heavy call) — it only removes the EXTRA
round trip(s) that guessing-then-retrying used to cost.

**Updated go/no-go, superseding parts of §6**: `qwen2.5:7b` remains the
better default of the two tested models (faster on every comparable
call, and §6's own live evidence already showed it, not `llama3.1:8b`,
successfully completing the heavier `query_liasse` call). The
id-guessing weak point that would have undermined a naive `propose_ecriture`
is now engineered away for both models, not just mitigated by hoping a
bigger model happens to behave better. **This clears the specific
blocker §6 raised for id resolution** — a future Phase 2 pass can build
`propose_ecriture` on the assumption that `journalId`/`fiscalYearId` are
already reliably resolved by this same context-injection mechanism
(extend it, or have `propose_ecriture` read from the same resolved
block), rather than trusting the model to chain lookups for those two
reference kinds. The account-id equivalent of this question (does
`search_accounts` chaining hold up as well) was NOT tested this pass —
accounts were deliberately excluded from eager injection per the
scoping decision above, and no live test targeted that specific chain
this round. **Prose-drift/fabrication over large payloads remains
unaddressed and is a separate, still-open risk for Phase 2 to design
around** (e.g. a `propose_ecriture` confirmation screen must show the
proposal's own structured fields, never trust the model's prose
description of what it proposed — the same discipline the tool-trace UI
already applies to reads).

## §7 — Known gaps, not attempted this pass

- **No session delete/rename endpoint** — same "not asked for, don't
  build it speculatively" discipline as `Journal`/`Account`/`VatRate`/
  `FiscalYear` elsewhere in this app (see CLAUDE.md "Known scope
  boundaries"). Test sessions created during this pass's own live
  verification are left in both companies' chat history; harmless
  (no ledger data, purely local), not cleaned up.
- **No token-budget/context-window management.** A very long
  conversation, or a tool result from a company with a much larger
  ledger than either test company here, could grow the prompt past what
  a 7-8B model's context window handles gracefully. Not exercised this
  pass — both test companies are small.
- **No streaming.** `LocalModelPort.complete()` is a single
  non-streaming round trip; given the observed latency (§6), a
  streaming variant would materially improve perceived responsiveness
  but wasn't requested this pass and would touch the port's own
  interface shape, not something to add casually later.
- **Minor frontend rough edge, not a correctness bug**: the user's own
  message doesn't render optimistically before the mutation resolves —
  during the "Réflexion en cours…" wait, only the pending indicator
  shows, not the just-sent USER bubble. Confirmed live; left as a
  polish item, not fixed this pass per the "verify before polish"
  instruction this pass was scoped to.
