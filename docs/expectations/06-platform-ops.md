# Expectation 06 — Platform + Ops

> Self-hosted, one container, boring to operate. Bar: a solo operator on a
> small VPS runs Folio for months without touching it.

---

## 1. Deploy

```
✓ docker compose up -d (--profile tls for public) — the whole install
✓ hot deploy: docker cp src/. folio:/app/src && docker restart folio (~4s)
✓ NO build step on the host (vite OOMs tight hosts; editor dist is CI/runner work)
✓ runs from src under bun --smol; FOLIO_MODE=ui|mcp|both
✓ state = ./folio-projects + tokens.json, plain files, rsync-able backup
✓ GHCR image builds from tag push (SKIP_TESTS=1 build-arg)
```

## 2. Auth + link hygiene (the shipped two-lifetime model — hold the line)

```
✓ MCP: named bearer tokens (audited) / OAuth+PKCE for claude.ai / JWT master
✓ Editor: token/cookie sole gate — NO Basic Auth popup, no login form
✓ Sessions 30d sliding (FOLIO_EDITOR_TOKEN_TTL_MS) — editor/library always-on
✓ Output links 30m ephemeral (FOLIO_OUTPUT_LINK_TTL_MS) — shown links die
✓ /o/<code> short links expire on the output clock, never self-revive
✓ opt-in hardening: FOLIO_ALLOW_IPS (CIDR), per-IP rate limit, heavy-op
  concurrency cap; client IP = last XFF hop (anti-spoof)
✓ no hardcoded domain — FOLIO_EDITOR_URL / FOLIO_MCP_PUBLIC_URL drive links
```

## 3. Resource envelope

```
mem_limit 4g (1g OOM-killed the MCP under harness load — never ship 1g again)
body caps: /mcp 32MiB · OAuth 256KiB · broadcast 16MiB · PUT design capped
asset caps (expectation 03): per-file + per-project quota, env-tunable
SSE: dead clients pruned; rate limiters on /mcp and :4173
survives: a full 100-case harness run + an open editor + library scans,
concurrently, without OOM or lockup
```

## 4. Reliability + observability

- `/health` liveness; audit line per tools/call (token NAME, never value).
- Write tools snapshot to `.mcp_versions/` before touching disk — any model
  mistake is recoverable.
- Soft-delete everywhere (`.trash/`), no destructive tool defaults.
- Graceful degradation: missing optional deps (Puppeteer, ffmpeg) → clear
  tool error + alternative suggestion, not a crash.

## 5. Offline

Zero runtime CDN after install, except the documented report-chart exception.
stdio mode works fully air-gapped (bundled fonts, icons, renderers).
