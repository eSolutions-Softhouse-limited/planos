# Forced-Revise Fixture Format

Each fixture is a single `*.fixture.json` file in `tests/fixtures/`. It drives
one **forced-revise loop** (`author → ExitPlanMode → forced-revise →
ExitPlanMode`) through the harness in canned mode, and supplies the **frozen**
data the harness measures against.

Authoritative requirements: plan `.omc/plans/planos-phase1-consensus.md`
(AC-12, AC-13, AC-18, AC-19) and design `docs/design.md` §6.

## Why "frozen"

The eval gate is only credible if no runtime human judgment leaks in. The
`expectedPreservedIds` set and the AC-13 slots are decided **once, when the
fixture is authored**, and never recomputed at runtime. The harness measures
ID-preservation as a pure set-intersection (AC-12):

```
idPreservationRate = |preserved ∩ expectedPreservedIds| / |expectedPreservedIds|
```

`|expectedPreservedIds|` is the mechanical denominator. It comes only from the
fixture file.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Stable fixture id (used in result output). |
| `schemaVersion` | int | Fixture-format version (currently `1`). |
| `initialPrompt` | string | **AC-18 realistic prompt.** A plausible end-user planning request: a feature/refactor/investigation ask, **≥3 distinct deliverables**, phrased the way a real user types — *not* a synthetic minimal stub. |
| `cannedAuthorResponse` | Document | The block document the agent "authors" on the first pass. A valid v1 plan document (`schemaVersion`, `id`, `blocks[]`). |
| `cannedForcedReviseResponse` | Document | The block document the agent emits after a forced revise. **Must model realistic revision behavior — including plausible renumbering pressure (AC-12): the fixture must NOT be authored to trivially preserve IDs.** |
| `expectedPreservedIds` | string[] | **FROZEN.** The set of block IDs whose *intent is unchanged* across the revision and which therefore SHOULD be preserved. Decided at fixture-design time. This is the AC-12 denominator. |
| `idChangedButCorresponding` | object | **AC-13 slot.** `{ oldId, newId, kind, note }` — a block whose ID changed in the revise but which still corresponds to the same intent. Used later by the re-anchoring fallback (Step 3.4) to assert a comment re-attaches to `newId`. |
| `decoy` | object | **AC-13 slot.** `{ id, kind, resemblesOldId, note }` — a *genuinely new* block superficially resembling an old one. The re-anchoring fallback must NOT mis-attach to it (false-attach rate must be 0). |
| `notes` | string | Free-form rationale for the frozen choices (audit trail). |

## Authoring rules (non-negotiable)

1. **Renumbering pressure is mandatory.** The revised response must reorder,
   insert, and/or drop blocks such that a naive positional scheme WOULD lose
   IDs. If every block trivially keeps its ID, the fixture is invalid — it
   tests nothing (AC-12). The block-ID *scheme* (decided empirically in
   Milestone 1) is what must survive this pressure, not the fixture.
2. **`expectedPreservedIds` ⊆ author-response block IDs.** You cannot expect to
   preserve an ID that never existed.
3. **The decoy must be genuinely new** — not a renamed old block — and must
   share surface tokens with `decoy.resemblesOldId` so it is a real trap.
4. **`idChangedButCorresponding.oldId`** must be an author-response ID and
   **must NOT** appear in `expectedPreservedIds` (its ID legitimately changed;
   it is the re-anchoring fallback's job, not ID-preservation's).

See `example.fixture.json` for a worked instance.
