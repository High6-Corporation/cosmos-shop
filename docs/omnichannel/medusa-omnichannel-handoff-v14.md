# Medusa Omnichannel Template — Handoff v14

**Session date:** 2026-07-17
**Carried forward from:** v13 (template groundwork closed, tagged `v1.0.0`, pushed live)

---

## 1. Session Summary

No direct work happened on `high6-medusa-omnichannel-template` this session — this handoff
exists to record a **template bug discovered indirectly**, while forking and standing up
**Cosmos Shop**, the template's first real client consumer since `v1.0.0`.

This is exactly the scenario v13 §2 flagged as the risk: *"this bug was invisible under normal
operation... It would have surfaced the moment anyone did a clean install, wiped `.medusa/`, or
forked the repo for Cosmos Shop."* That prediction was about the seed-trigger bug (fixed in
v13). This session surfaced a **second, separate** bug in the same family — also only visible
on a genuinely fresh database — which v13's trial-fork process did not catch, because the trial
fork tested `git merge` against an existing repo with an existing database, not a full
`db:migrate` against an empty one.

---

## 2. 🔴 New Finding: `migration-scripts/seed-rbac.ts` — No Default Export

**Where:** `apps/backend/src/migration-scripts/seed-rbac.ts`

**What v13 intended:** per v13 §3, this file was rewritten as a *"thin re-export from
`utils/seed-rbac.ts` for backward compatibility"* — meant to keep Medusa's legacy
`migration-scripts` runner working alongside the new `rbac-seed` module's `onApplicationStart`
hook.

**What actually happens:** on a completely fresh database, running `npx medusa db:migrate`
executes all pending migration scripts in sequence, including this one. It fails:

```
error: Failed to load migration script .../migration-scripts/seed-rbac.ts. No default export found.
Error: Failed to load migration script .../migration-scripts/seed-rbac.ts. No default export found.
```

The re-export file does not currently expose a default export, which Medusa's
`MigrationScriptsMigrator` requires to run a legacy migration script.

**Why this didn't block Cosmos Shop's setup:** the live `rbac-seed` module (the
`onApplicationStart` lifecycle hook from v13 §2) had already run and successfully seeded all 8
roles with correct policy counts *before* the legacy migration-scripts runner reached this
file. So the dev server booted clean and RBAC was fully functional — this bug only surfaces as
a failed step in the `db:migrate` output, not as a runtime problem. Easy to miss if you're not
watching migration output closely.

**Why it should still be fixed:** a failed migration script leaves that script permanently
recorded as *not completed* in Medusa's `script_migrations` tracking table. Every future
`db:migrate` run on this database will likely retry it and fail again, which will eventually
train people to ignore `db:migrate` errors as "expected" — a bad habit for a template meant to
be forked repeatedly.

**Root cause (not yet fully investigated):** likely the rewrite in v13 §3 converted
`migration-scripts/seed-rbac.ts` into a named or non-default export, or an empty/incomplete
re-export, when the legacy migration-scripts runner still requires `export default` specifically.
Needs a proper investigation pass, not a guessed one-line fix.

---

## 3. Open Items Carried Forward (unchanged from v13 unless noted)

| Item | Severity | Status |
|---|---|---|
| **`migration-scripts/seed-rbac.ts` missing default export** | Medium | **New this session** — fails on `db:migrate` against a fresh DB; doesn't block runtime since the live seed module already covers RBAC seeding, but leaves a permanently-failed entry in `script_migrations` |
| Policy churn (19 soft-deleted policies every boot) | HIGH | Known (#76), unchanged |
| Guard AND-vs-ANY POST semantics | HIGH | Known (#78), not in scope |
| `hasPermission()` fail-open on empty roles | HIGH | Contained via #82's fail-closed guard; core framework itself still fail-open |
| Benched roles (Ops Mgr, Catalog/Product Mgr, Marketing) browser-verification | — | Still queued, now blocked behind Cosmos Shop's own setup progressing first |
| API-key screens: zero client-side delete gating | — | Flagged (v12, #83), unchanged |
| `notification:read` gap (CS + Dev) | — | Flagged for Sir Jeff, unchanged |
| Return/Claim/Exchange/Order-Edit CS scope | — | Flagged for Sir Jeff, unchanged |
| `debug.test@high6.dev` uncorrected Super Admin | Low | Still flagged, untouched |
| Stray "Test Role" entry in roles table | Low | Still flagged, untouched |
| `/admin/store` + `/admin/store/locales` 400 for all roles | Medium | Still unresolved |
| Medusa CLI (`medusa user`) always auto-assigns Super Admin, no `--role` flag | Low | **New this session** (observed in Cosmos Shop) — not a template bug per se (Medusa core CLI behavior), but worth documenting in `TEMPLATE_SYNC.md`'s Known Framework Quirks so future bootstrap-user creation across any client fork accounts for it |

---

## 4. Recommended Next Step for the Template Repo

1. Investigate and fix `migration-scripts/seed-rbac.ts`'s missing default export — add a proper
   investigation pass (don't guess), confirm fix against a genuinely fresh database via
   `db:migrate` (not just `npm run dev`), and verify `script_migrations` records it as
   completed.
2. Once fixed, tag a new template release (`v1.0.1` or `v1.1.0` depending on severity/scope of
   the fix) so Cosmos Shop and any future client forks can pull it via `TEMPLATE_SYNC.md`'s
   documented procedure.
3. Add a note to `TEMPLATE_SYNC.md`'s Known Framework Quirks section about the Medusa CLI's
   Super Admin auto-assignment behavior (§3 above), since it will affect every future client
   fork's bootstrap-user setup the same way it did Cosmos Shop's.

---

## 5. Engram Entries (to confirm/log)

| # | Type | Summary |
|---|---|---|
| TBD | discovery | `migration-scripts/seed-rbac.ts` missing default export, fails `db:migrate` on fresh DB (found via Cosmos Shop fork) |
| TBD | note | Medusa CLI `medusa user` always assigns Super Admin, no role flag — affects all future client bootstrap-user setups |

*(Exact Engram entry numbers to be confirmed/logged by whoever picks up the fix — this handoff
records the findings, not the persisted entry IDs.)*