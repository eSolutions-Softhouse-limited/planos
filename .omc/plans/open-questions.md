# Open Questions

## planos Phase 1 (consensus) - 2026-05-16 — Revision 2

All load-bearing open questions have been RESOLVED in the plan body (`planos-phase1-consensus.md`). Recorded here for traceability:

- [x] **RESOLVED — Exit-gate bars.** FROZEN at plan time, not tunable: block-ID preservation ≥95% across forced revise; deny→revise convergence ≤2 iterations ≥90%; deterministic correctness 100% pass/fail. If Milestone 1 cannot clear them for either ID scheme, Phase 1 FAILS via the explicit Milestone 1 failure branch and re-scoping is escalated for sign-off — never auto-adjusted. (Plan AC-19, Step 1.3, Risk table.)
- [x] **RESOLVED — Block-ID scheme.** Decided empirically in Milestone 1, measured against the REAL thin loop (Milestone 0 → 2-thin → 1) with live agents, vs the frozen bars; recorded in ADR `docs/adr/0001-block-id-scheme.md`. Not pre-decidable; data picks, bars do not move. (Plan Step 1.1–1.3, Decision 2.)
- [x] **RESOLVED — Forced-revise fixture count (was OQ#3, load-bearing).** Committed: **≥30 canned forced-revise fixtures.** Justification: at N=30 a true 90% convergence rate is rejected when observed pass count ≤24/30 (≤80%), and a true 95% ID-preservation rate separates cleanly from ≤87% observed — adequate power to detect a materially-worse true rate below each frozen bar. (Plan AC-19(ii).)
- [x] **RESOLVED — Live-run count (was OQ#5, load-bearing).** Committed: **≥5 live agent runs**, separately gated, ID-preservation ≥95%, **no single run may regress** below the bar. This is the only metric group that actually falsifies the §6 risk. (Plan AC-19(iii).)
- [x] **RESOLVED — plannotator coexistence.** Investigation spike moved EARLY (Milestone 0, Step 0.6) so findings (esp. whether Claude Code dispatches `ExitPlanMode` to ALL matching plugins) constrain Milestone 2 server-lifecycle / stdout-decision-ownership design before it is built. Full resolution remains a Phase 4 Non-Goal. (Plan Step 0.6, AC-21.)

### Remaining (non-load-bearing)

- [ ] Exact wording/firmness of the injected ID-preservation directive (`additionalContext` preamble) — empirically tunable during Milestone 1/2-full within the frozen gate; does not change scope or any gate. Iterate against the real loop; not a blocker.
