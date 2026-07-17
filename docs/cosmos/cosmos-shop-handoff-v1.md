# Cosmos Shop — Handoff v1

**Session date:** 2026-07-17
**Repo:** `High6-Corporation/cosmos-shop`
**Forked from:** `high6-medusa-omnichannel-template` @ tag `v1.0.0`
**Client:** Cosmos Bazar, Inc. ("Cosmos Shop")

---

## 1. Session Summary

First session on Cosmos Shop. Forked the omnichannel template, stood up local infrastructure
end-to-end, configured project-specific tooling, and got the admin dashboard fully working with
Cosmos Shop branding and two working bootstrap admin users. No client-specific commerce features
(products, pricing, engraving logic) built yet — this session was entirely foundation work.

**Status at end of session:**

- ✅ Repo forked from template at `v1.0.0` with shared git history preserved (`template` remote
  wired for future pulls, `origin` pointed at Cosmos Shop's own repo)
- ✅ `TEMPLATE_VERSION` recorded (`v1.0.0`)
- ✅ Engram scoped to `cosmos-shop` project (`.engram/config.json` corrected)
- ✅ Graphify index built for Cosmos Shop's tree (1072 nodes, 2013 edges, 77 communities as of
  last reindex)
- ✅ `CLAUDE.md` created at repo root, describing Cosmos Shop as a client project and pointing to
  `TEMPLATE_BOUNDARY.md` / `TEMPLATE_SYNC.md`
- ✅ `README.md` rewritten to describe Cosmos Shop (not the template)
- ✅ `package.json` name corrected (`high6-medusa-omnichannel-template` → `cosmos-shop`),
  `package-lock.json` regenerated
- ✅ `TEMPLATE_SYNC.md` updated with a Known Framework Quirks note on `package.json`'s `name`
  field being the one client-specific value in an otherwise template-owned file
- ✅ Local Postgres database `cosmos_shop` created inside the existing `medusa-omnichannel-db`
  Docker container (separate database, same container as the original template project — no new
  container needed)
- ✅ `apps/backend/.env` configured for Cosmos Shop (own database name, own onboarding directory
  path; other values — CORS, secrets — copied from template's local `.env` for local dev)
- ✅ `db:migrate` run successfully against the fresh database — all core Medusa module
  migrations applied cleanly
- ✅ RBAC seed mechanism (the `onApplicationStart` module from template v13) verified working
  end-to-end on a fresh database — all 8 default roles created with correct policy counts
- ✅ Two bootstrap admin users created:
  - `superadmin@cosmosshop.dev` — Super Admin
  - `owner@cosmosshop.dev` — Store Owner
- ✅ Admin login screen rebranded from "Welcome to Medusa" to "Cosmos Medusa Management" via
  `apps/backend/src/admin/i18n/index.ts` (client-owned file)
- ✅ Dev server confirmed booting clean on port 9000, admin UI reachable and login-verified

---

## 2. Local Environment Reference

| Item | Value |
|---|---|
| Postgres container | `medusa-omnichannel-db` (shared container, existing) |
| Database name | `cosmos_shop` |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost/cosmos_shop` |
| Backend dev port | 9000 |
| Storefront dev port | 8000 |
| Admin URL | `http://localhost:9000/app` |
| Redis | Not running locally — falls back to Medusa's fake in-memory redis (fine for dev) |

**Note:** `AUTH_MFA_ENCRYPTION_KEY` in `.env` is currently the template's dev key, carried over
as-is for local development. Flagged for a fresh key generation before this project ever targets
a shared or production environment — not urgent for local dev.

---

## 3. RBAC Bootstrap Users

| Email | Password (local dev only) | Role |
|---|---|---|
| `superadmin@cosmosshop.dev` | `TestPass123!` | Super Admin |
| `owner@cosmosshop.dev` | `TestPass123!` | Store Owner |

Configured in `apps/backend/src/utils/seed-rbac-roles.ts`'s `BOOTSTRAP_USER_ROLES`
(client-owned file, safe to edit further as needed).

**⚠️ Open issue:** `owner@cosmosshop.dev` currently holds **both** Super Admin and Store Owner
roles. Root cause: Medusa's `medusa user` CLI has no `--role` flag and always auto-assigns Super
Admin to any user it creates; the `rbac-seed` bootstrap hook then added Store Owner on top on
restart, rather than replacing the CLI's default assignment. **Needs manual cleanup**: log in as
`superadmin@cosmosshop.dev` → Settings → Users → `owner@cosmosshop.dev` → remove the extra Super
Admin role assignment, leaving Store Owner only.

---

## 4. Admin Branding

Login-screen and invite-screen copy overridden via `apps/backend/src/admin/i18n/index.ts`:

| Key | Value |
|---|---|
| `login.title` | Cosmos Medusa Management |
| `login.hint` | Sign in to access the Cosmos Shop dashboard |
| `invite.title` | Welcome to Cosmos Medusa Management |

Confirmed via i18n override (client-owned path) — no dashboard patch was needed. A bug was found
and fixed along the way: the generated i18n module already wraps content with `resources:`, so
the file's export must be `{ en: { translation: {...} } }` directly, **not**
`{ resources: { en: {...} } }` — double-wrapping silently breaks the merge.

---

## 5. Known Issue Inherited From Template (not Cosmos-specific)

`apps/backend/src/migration-scripts/seed-rbac.ts` fails during `db:migrate` on a fresh database
("No default export found"). This is a **template bug**, not something to fix locally in Cosmos
Shop — `migration-scripts/seed-rbac.ts` is template-owned per `TEMPLATE_BOUNDARY.md`. It did not
block Cosmos Shop's setup (the live `rbac-seed` module already seeded RBAC correctly before the
legacy migration-scripts runner reached this file), but it does leave a permanently-failed entry
in the `script_migrations` tracking table. See `medusa-omnichannel-handoff-v14.md` for full
detail — flagged there for a fix in the template repo, not here.

---

## 6. Open Items Carried Forward

| Item | Severity | Status |
|---|---|---|
| `owner@cosmosshop.dev` has extra Super Admin role | Low-Medium | Needs manual removal via admin UI (see §3) |
| Template's `migration-scripts/seed-rbac.ts` bug | Low (doesn't block Cosmos Shop) | Tracked in template handoff v14, not actionable here |
| `AUTH_MFA_ENCRYPTION_KEY` still using template's dev key | Low | Fine for local dev; regenerate before shared/prod environment |
| Benched-role browser-verification pass (Ops Mgr, Catalog/Product Mgr, Marketing) | — | Inherited from template work, still queued — will make sense to verify against Cosmos Shop's own roles once real users/products exist |

---

## 7. Next Session Starting Point

**Product setup + storefront foundation.**

1. Add a first product from the Cosmos Shop admin dashboard (`http://localhost:9000/app`),
   properly configured — categories, pricing, inventory, sales channel assignment as needed.
2. Continue setting up the shop properly in the admin dashboard (store settings, regions,
   shipping, whatever else is needed before the storefront can function against real data).
3. Once admin-side setup is stable, move to the storefront (`apps/storefront`) — currently
   blocked on `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`, which needs a publishable API key created
   through the admin UI first (Settings → Publishable API Keys).

**Not yet started:** Cosmos Shop's actual differentiator — quantity-threshold engraving pricing
— will come after the base shop (products, store config, storefront) is functional.

---

## 8. Engram Entries (to confirm/log)

| # | Type | Summary |
|---|---|---|
| TBD | feature | Cosmos Shop v1 — fork, local infra, RBAC bootstrap, admin rebrand complete |
| TBD | discovery | i18n double-wrap bug (own `resources:` key vs. generated wrapper) found and fixed during login rebrand |
| TBD | discovery | Medusa CLI Super Admin auto-assignment quirk observed (also logged in template handoff v14) |

*(Exact Engram entry numbers to be confirmed by whoever's session actually persisted them —
this handoff records findings, not persisted entry IDs.)*