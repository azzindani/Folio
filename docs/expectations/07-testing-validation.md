# Expectation 07 — Testing + Validation

> Folio's quality claims are only real if measured on REAL model traffic.
> Bar: every engine change is validated against (a) the unit/E2E suites and
> (b) live model runs — frontier free-hand AND local blind — with renders
> reviewed by a vision model.

---

## 1. The test pyramid

```
unit (Vitest, 3000+)            co-located; coverage: token-resolver 98 ·
                                schema 95 · renderer 90 · MCP 90 · export 85
integration                     MCP round-trip create→append→seal→valid YAML
E2E (Playwright)                editor flows at desktop/tablet/mobile widths
visual regression               ≤1% pixel diff; --workers 1 for font-swap trust
live harness                    real models over the deployed MCP (below)
```

CI (`ci.yml`): lint(src) · typecheck · unit ×3 OS · integration · build ·
visual · e2e · perf. Local dev runs jobs 1–3 (build OOMs the host — runner-only).

## 2. Harness testing — the core loop

**Prompts are hand-written, realistic, human** (`cases.py → usecases.json`,
100 cases). Never templated/generated — templated happy-path prompts caused
samey biased output. Score DIVERSITY (`eval_diversity.py`) + meet/edit/bad
triage, not preset-conformance.

Per release expectation:

| Run | Model class | Pass bar |
|---|---|---|
| Blind local | Gemma 3n E4B (floor) + a 30B mid | ≥90% sealed, ≥18/20 strong, 0 blanks, 0 unsealed-as-done |
| Frontier free-hand | Claude class | free layouts survive finalize; 0 rescue-pass wreckage; example-level output |
| Batch/carousel | either | decks complete via batons, one palette across pages, no overprint |
| Regression | replay prior FAIL clusters | fixed cases stay fixed (repair kit: 043/054/057/081 pattern) |

## 3. The vision-critic loop (claude.lab.casava.space)

The rig that hardened v0.1.0 — keep it institutional:

```
1. mid-size model designs via the harness (harness-claude MCP registration,
   38 tools visible, plan-mode bypassed)
2. render EVERY design (tools/audit/render-harness.mjs)
3. vision model (Claude) reviews renders — composition, legibility, AI tells
4. findings → reproduce on live MCP → engine fix + failing-case test
5. re-run the cluster; wipe suite-* dirs before a clean from-1 run
```

Next planned use: drive a mid-size model through the claude.lab harness and
vision-review the results (operator-scheduled — see ROADMAP).

## 4. Infra-vs-engine triage (institutional knowledge, must stay applied)

FAIL clusters where duration≈timeout with 0 designs are usually INFRA:

```
container OOM (1g → 4g fixed it) · OpenRouter :free daily 429 (resets 00:00 UTC)
· harness plan-mode slip · MCP client cached stale tools/list (reconnect)
```

Engine dashboards must exclude infra failures or they poison quality metrics.
Model failures (timeout/thrash/sparse) are logged as MODEL, not patched over.

## 5. Verification discipline for changes

- Engine finalize/heal changes: reproduce the broken payload from harness
  jsonl FIRST, fix, then verify via live MCP render (`render_preview` + parse
  expanded YAML geometry).
- Editor changes: Playwright at 3 widths; live container (not vite preview)
  when server-injected UI (Library button) is involved.
- Export changes: byte-determinism + links:N>0 for href designs + PNG visual.
- Deploy verification: `curl /health` + one end-to-end design after every
  `docker cp` deploy.
