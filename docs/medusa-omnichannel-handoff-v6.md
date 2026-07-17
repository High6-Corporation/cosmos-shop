# Medusa Commerce Integration (Omnichannel, Per-Client) — Handoff Document

> **Status:** Sales Channel / inventory / pricing architecture settled and implemented. Marketplace order-ingestion module implemented and verified end-to-end. Shopee/Lazada API wiring benched per team lead direction. **RBAC (Section 4.4) had a critical regression this session — found and fixed. Store Owner is now fully verified (API + dashboard). The 7 remaining roles still need account creation and dashboard/CLI testing before RBAC can be marked closed.** Cosmos Bazar (Section 4.5) remains queued until all 8 roles are verified.
> **Date:** July 15, 2026
> **Version:** v6 (supersedes v5)
> **Summary:** This session started as manual dashboard testing of Store Owner (the item deferred from v5) and uncovered that Store Owner's original `*:*` wildcard policy was structurally incompatible with its intended "business only" scope — confirmed via a real browser session where Store Owner could create RBAC roles and access Developer settings. An investigation → approved fix cycle replaced the wildcard with 40 explicit policies, which in turn surfaced a second, previously undetected latent bug (`allCrud()` helper never matched Medusa's actual wildcard operator, silently breaking 4 other roles since original implementation) and a live infrastructure bug (RBAC policies are wiped and rebuilt on every server restart, orphaning custom seed data). Both are now fixed permanently. Store Owner is fully re-verified end-to-end, including the dashboard. Testing of the other 7 roles has not yet started.

---

## 1. Architecture decisions (settled, unchanged from v5)

*(Unchanged — see Section 1 of v5 for Sales Channels, shared inventory pool, pricing rule engine, and order ingestion decisions.)*

---

## 2. Marketplace Order Creation Module (implemented & verified, unchanged from v5)

*(Unchanged — see Section 2 of v5. Open item 2.7, `captured_by`/`marketplace_transaction_id` persistence, remains unresolved and unrelated to this session's work.)*

---

## 3. Tooling setup (this project)

### 3.1 Graphify — re-indexed this session

**First re-index (post-RBAC-fix):**
| Metric | Before | After | Change |
|---|---|---|---|
| Nodes | ~5,849 | 5,844 | -5 (2 temp diagnostic scripts pruned) |
| Edges | ~20,547 | 20,546 | -1 |
| Communities | 339 | 338 | -1 |
| Files re-extracted | — | 372 | RBAC changes + cascade |

**Cleanup pass (4 leftover debug scripts removed — `auth-check.ts`, `auth-link-check.ts`, `db-check-rbac.ts`, `deep-db-check.ts`, all confirmed one-off diagnostics with zero imports elsewhere in `src/`):**
| Metric | Before cleanup | After cleanup | Change |
|---|---|---|---|
| Nodes | 5,844 | 5,841 | -3 |
| Edges | 20,546 | 20,545 | -1 |
| Communities | 338 | 327 | **-11** |

**Reconciled:** the earlier "2 files deleted" report was inaccurate/incomplete — it reflected different temp files removed mid-session, not these 4. All 4 debug scripts are now confirmed deleted, with zero dependencies found elsewhere in the codebase.

**Flag for next session:** the community count drop (-11) is disproportionately large relative to the node/edge drop (-3/-1) for removing 4 files. Worth a quick sanity check that this wasn't an over-aggressive community re-clustering rather than a change proportional to what was actually deleted — same category of check called out for the v5 session's larger count drop, not yet independently confirmed either time.

**Also worth noting:** `seed-rbac.ts` is legitimate and load-bearing (it's what the new startup subscriber and manual `npx medusa exec` runs both depend on) but is still **untracked** in git, same as it was before cleanup. Worth committing this explicitly next session rather than leaving load-bearing seed logic uncommitted.

### 3.2 Engram
**MCP status: still unresolved.** Engram MCP is connected but cannot resolve the project from `/Users/josh/work` (ambiguous — the directory also contains `ai-core` and `apir-tayo` repos). The `.engram/config.json` added last session (at `high6-medusa-omnichannel-template/.engram/config.json`, `"project": "high6-medusa-omnichannel-template"`) exists but the MCP server isn't recognizing it. **File-based fallback remains the working pattern for now** — confirm/fix MCP resolution at the start of next session before assuming it's back to normal.

**This session's file-based memory:**
| File | Content |
|---|---|
| `rbac-regression-fix-2026-07-15.md` | Full session summary — VERIFIED (Store Owner), UNVERIFIED (7 other roles, user widgets), DEFERRED (invite-accept runtime, `/store/*`, role column widgets) |
| `allcrud-wildcard-vs-registered-policy-keys.md` | Standalone observation — see Section 4.4.8 Finding 2; same "framework helper doesn't behave as implied" pattern as the `instanceof Error` bug (Section 2.5/2.8) and the `hasPermission()` role-inheritance gap (v5 Section 4.4.3) |
| `MEMORY.md` | Updated index with both new entries |

---

## 4. Carried forward — still open

### 4.1–4.3 (unchanged from v5)
Shopee/Lazada benched work, `captured_by` bug, and marketplace order module follow-ups — no change this session.

### 4.4 Role-Based Access Control (RBAC) — regression found & fixed this session; testing resumes with 7 roles remaining

**Status:** Store Owner is now fully verified — API-level and dashboard-level, including sidebar visibility. The other 7 roles (Operations Manager, Order & Fulfillment Staff, Catalog/Product Manager, Marketing, Customer Support, Read-Only/Auditor, Developer/Platform Support) have **not yet** had dashboard walkthroughs. This session revealed that CLI-only verification is not sufficient — the two headline bugs below were both invisible to CLI/build checks and only surfaced through actual browser testing.

#### 4.4.8 This session's findings and fixes (new)

**Trigger:** Manual dashboard walkthrough of Store Owner (`localhost:9000/app`, logged in as `owner.test@high6.dev`) — the item deferred from v5 (item 4.4.7 #1).

**Finding 1 — Store Owner's `*:*` wildcard was structurally incompatible with its documented scope.**
Confirmed live in the dashboard: Store Owner could see and use the Developer section (Publishable/Secret API Keys, Workflows) and Settings → Roles/Policies, including successfully creating a new RBAC role. This contradicted the "business only, excluding API keys/webhooks/RBAC management" restriction documented in Section 4.4.2 (v5).

Root cause (investigation-confirmed, not assumed): Medusa's RBAC policy model is purely additive — no deny/exclusion syntax, no policy precedence. A `*:*` wildcard means literally everything; the "excludes X" language in the role description had no expression in the actual policy model. This was flagged as a latent risk in v5 Section 4.4.3 (design rationale for using the wildcard bypass rather than a role-name string match) but not caught until this session's manual walkthrough.

**Fix:** Replaced Store Owner's single `*:*` policy with 40 explicit `resource:operation` policies (commerce: 20, fulfillment/returns: 5, business settings: 12, sales channel: 1, read-only: 3). Explicitly excludes `api_key`, `rbac_role`, `rbac_policy`, `workflow_execution`, `admin_config`, `fulfillment_provider`, `tax_provider`, `notification`.

**Finding 2 — `allCrud()` helper bug, latent since original implementation, affecting 4 other roles.**
While implementing the fix above, discovered `allCrud()` (used by Operations Manager, Catalog/Product Manager, Marketing, and Developer/Platform Support) emitted `operation: "all"` — but Medusa's actual wildcard operator is `"*"` (confirmed via `has-permission.js` and the `WILDCARD` constant in `define-policies.js`). `"all"` never matched anything. **These 4 roles have been non-functional (in some undetermined way — likely over-restrictive) since RBAC was first implemented**, and were never caught because v5's CLI cross-role testing only covered Read-Only and Order & Fulfillment Staff (which use different helpers, `readOnly`/`readWrite`, not `allCrud`).

**Fix:** `allCrud()` corrected to use the proper wildcard/explicit CRUD operations. **Consequence: this changes real behavior for all 4 affected roles — none of them have been tested since. This is now the top priority for next session's role-by-role testing.**

**Finding 3 — RBAC policies are wiped and rebuilt on every server restart (the actual regression cause).**
After the Finding 1 fix was applied and initially confirmed working (40 policies, DB-verified), a routine unrelated `middlewares.ts` edit triggered a dev-server auto-reload — after which Store Owner had only 3 policies left (just the `readOnly` ones), and both test users (`owner.test@high6.dev`, `medusa.test@high6.com`) showed `roles=[]`. This caused a regression **worse than the original bug**: Store Owner could access nothing at all.

Root cause: Medusa's `syncRegisteredPolicies` (an `onApplicationStart` hook in the RBAC module itself) soft-deletes any policy whose key doesn't match a registered route-config key, on every single server start — not just first boot. The original `allCrud()` bug (Finding 2) meant seeded policies had non-matching keys and were being silently wiped on every restart; this had presumably been happening since RBAC was first implemented, masked because nobody had restarted the server enough times between CLI checks to notice. User→role assignments were separately never being created/persisted through this cycle either.

**Fix (permanent infrastructure fix, not a manual workaround):**
- New startup subscriber `src/subscribers/seed-rbac-on-startup.ts` — fires ~2s after every server start (confirmed, via timestamped logs, to run strictly *after* `syncRegisteredPolicies` completes, across 3+ consecutive restarts). Auto-seeds all 8 roles (151+ policies total) and bootstrap user role assignments on every startup, eliminating the "run seed manually after server is ready" manual step.
- Bootstrap user role assignment is **explicitly scoped to only two known dev/test users** (`medusa.test@high6.com` → Super Admin, `owner.test@high6.dev` → Store Owner) — **not** a general-purpose auto-assignment mechanism. New real admin users still go through the existing `assign-default-role-on-invite-accept` subscriber (defaults to Read-Only) or manual assignment.
- Confirmed via DB query: role assignments now survive a fresh `npm run dev` process restart (not just HMR reload), across 3+ restarts.

**Finding 4 — sidebar-hiding widget never actually worked, for an unrelated reason.**
A widget (`rbac-sidebar-filter.tsx`) was built to hide Developer-section sidebar items via CSS/DOM injection for non-Developer roles, but was calling `/admin/me/permissions`, which did not exist (404). The widget silently no-op'd on every load.

**Fix:** Built `src/api/admin/me/permissions/route.ts` — a real endpoint returning the authenticated user's effective permissions array. Also fixed a related sidebar bug found after the endpoint was in place: hiding the individual Developer nav items left the empty "Developer" section heading still visible; widget updated to detect and hide the section header itself (via lowest-common-ancestor DOM traversal) when all its child items are hidden.

**Current confirmed state (Store Owner only):**

| Check | Result |
|---|---|
| Store Owner login | ✅ Working |
| Business page access (orders, products, customers, store settings, etc.) | ✅ Working, dashboard-confirmed |
| Blocked from API Keys / Webhooks / RBAC roles-policies / Workflows | ✅ Correctly denied, both API (400 `not_allowed`) and dashboard (nav item hidden) |
| Developer sidebar section (items + heading) | ✅ Fully hidden |
| Role assignment + policies survive server restart | ✅ Confirmed across 3+ restarts |
| `/admin/me/permissions` endpoint | ✅ Returns 200 with permissions array |

#### 4.4.9 Open items carried into next session (supersedes v5's 4.4.7)

1. **Test the remaining 7 roles — dashboard AND API, not CLI-only.** This is now the primary task. Given this session's findings, CLI-only "should work" checks are not trustworthy on their own; each role needs an actual test account and a real browser walkthrough, the same way Store Owner just got. **Priority order suggested:** the 4 roles affected by the `allCrud` bug (Operations Manager, Catalog/Product Manager, Marketing, Developer/Platform Support) first, since their behavior changed this session and is completely unverified; then Order & Fulfillment Staff and Read-Only/Auditor as a re-confirmation (previously CLI-verified pre-regression, worth a fresh check now that the seeding infrastructure itself changed); then Customer Support.
2. **Confirm the sample test-account list is created** for all 7 remaining roles (see below) — none exist yet except Store Owner's.
3. **Reconcile policy count terminology going forward.** The old "40 vs 44" discrepancy (v5 Section 4.4.3) is superseded, not resolved — current authoritative numbers are **151+ total policies across all 8 roles** (post-fix, with Store Owner alone holding 40) after the startup-subscriber reseed. Use this number in any future planning; don't reference the old 40/44 figures.
4. **Invite-accept subscriber runtime check** (carried from v5, still not done) — create a real invite without specifying a role, accept it, confirm the new user lands with Read-Only. Not attempted this session; still open.
5. **Confirm `/store/*` routes are unaffected** by the admin-only guard (carried from v5, still not done).
6. **Role column visibility in the Users admin list** — approved and scoped, not yet built. Medusa's official dashboard (PR #14593) has no native role display anywhere (list, detail, or edit form) despite the API supporting it (`AdminUser.roles`, marked `@ignore` in the type). Plan: two custom widgets, `user.list.after` (compact role-badge card) and `user.details.after` (role display, ~100–150 lines TSX each, no backend changes needed). Not started — was paused when the access regression (Finding 3) took priority.
7. ~~Re-run Graphify~~ — **done, including a cleanup pass.** 4 leftover one-off debug scripts (`auth-check.ts`, `auth-link-check.ts`, `db-check-rbac.ts`, `deep-db-check.ts`) removed from `migration-scripts/` — confirmed zero dependencies. See Section 3.1 for reconciled counts.
8. ~~Log this session to Engram~~ — **done via file-based fallback** (Section 3.2). **Engram MCP project resolution is still broken** — the `.engram/config.json` fix from last session did not resolve it. Needs a fresh look next session (different fix approach, not just re-confirming the same one).
9. **Sanity-check the -11 community-count drop** from the cleanup pass — disproportionate to the 4 files actually removed (Section 3.1). Not yet independently verified as a correct re-clustering vs. an over-aggressive prune.
10. **Commit `seed-rbac.ts`.** It's load-bearing (the startup subscriber and manual seed runs both depend on it) but still untracked in git as of this session's end.

Once items 1–2 close (all 8 roles dashboard-verified) and items 4–5 close, RBAC (Section 4.4) is fully done and Cosmos Bazar (Section 4.5) is unblocked to start.

#### 4.4.10 Sample test accounts — for next session's role-by-role testing

Only Store Owner exists today. The other 7 need to be created via `npx medusa user`, then assigned their role through Settings → Team/Users in the dashboard (the CLI doesn't set RBAC roles).

| Role | Email | Password | Priority | What to test |
|---|---|---|---|---|
| Store Owner | `owner.test@high6.dev` | `TestPass123!` | ✅ Done | — |
| Operations Manager | `opsmanager.test@high6.dev` | `TestPass123!` | High (allCrud-affected) | Orders/Products full read+write, Pricing read-only, Customers full, no Settings access at all |
| Catalog/Product Manager | `catalog.test@high6.dev` | `TestPass123!` | High (allCrud-affected) | Products/Pricing/Promotions full access, Orders read-only, no Customers/Settings access |
| Marketing | `marketing.test@high6.dev` | `TestPass123!` | High (allCrud-affected) | Pricing/Promotions full access, Orders/Products read-only, no Customers/Settings |
| Developer/Platform Support | `dev.test@high6.dev` | `TestPass123!` | High (allCrud-affected) | API Keys/Webhooks/RBAC role management usable; Orders/Products/Customers read-only (debugging); no business Settings |
| Order & Fulfillment Staff | `fulfillment.test@high6.dev` | `TestPass123!` | Medium (re-confirm) | Orders read+write (cancel only, no delete button), Products read-only, no Pricing/Settings in sidebar at all |
| Read-Only / Auditor | `auditor.test@high6.dev` | `TestPass123!` | Medium (re-confirm) | Everything visible, nothing editable — specifically check for buttons that render but 403 on click |
| Customer Support | `support.test@high6.dev` | `TestPass123!` | Lower (known accepted gap) | Order notes/refund-request only *intended*, but full order write is the documented v1 gap (4.4.4 in v5) — confirm this still holds and isn't worse post-fix; Customer read+write, no delete |

### 4.5 New client project (scoped, not started) — Cosmos Bazar

*(Unchanged from v5 — still queued behind full RBAC closure. See v5 Section 4.5 for full detail: engraving feature design, pricing tier mechanism, open scoping questions.)*

Reference: Cosmos Bazar (current live site to be remade) — https://shop.cosmos-bazar.com/about-us/

### 4.6 Also still open (carried forward, unchanged)
- Per-client instance provisioning/deployment approach.
- Client access-model question (dedicated site vs. admin access).

---

## 5. Standard structure — writing Claude Code prompts for this project

*(Unchanged — see v5 Section 5. This session's escalating regression is a live example of why the plan-first gate and step-by-step confirmation rules exist: a routine unrelated edit triggered a server reload that silently wiped RBAC state, and the fix required stopping all forward feature work — including an already-approved Task 2 — to debug root cause before resuming.)*

**One addition to the standing rules, prompted by this session:** when a fix depends on framework lifecycle behavior (startup hooks, sync processes, subscribers), require the Agent to verify timing/ordering across **multiple consecutive restarts**, not just a single successful run, before reporting a fix as complete. A single clean test run was exactly what made the original `allCrud`/sync-wipe bug invisible for as long as it was.

---

## 6. Standard structure — responding to the Agent's plan or findings

*(Unchanged — see v5 Section 6.)*

---

## References

- `medusa-omnichannel-handoff-v5.md` — RBAC design, implementation, and CLI verification (superseded by this document for RBAC status)
- `medusa-omnichannel-handoff-v4.md` / `v3.md` / `v2.md` / `v1.md` — architecture history
- `medusa-cms-handoff-v15.md` — final state of the benched multi-tenant project, reusable patterns
- `docs/marketplace-order-idempotency-investigation.md` — Section 2.5 source investigation
- `INVENTORY-RESERVATION-INVESTIGATION.md` — Section 2.4 source investigation
- `docs/investigation-store-owner-wildcard-bypass.md` — this session's Finding 1 investigation report
- `docs/task-1-2-deliverable.md` — this session's Finding 1/2 fix + Role Column investigation deliverable
- `memory/rbac-implementation.md` — file-based session memory, v5 session (RBAC original implementation)
- `memory/rbac-regression-fix-2026-07-15.md` — file-based session memory, this session (regression + fixes)
- `memory/allcrud-wildcard-vs-registered-policy-keys.md` — standalone finding, general Medusa RBAC sync-matching pattern
- Shopee Open Platform: https://open.shopee.com/
- Lazada Open Platform: https://open.lazada.com/
- Medusa `create-medusa-app` docs: https://docs.medusajs.com/learn/installation
- Cosmos Bazar (Section 4.5 client): https://shop.cosmos-bazar.com/about-us/
- Medusa "Personalized Products" recipe: https://docs.medusajs.com/resources/recipes/personalized-products
- Medusa Pricing Module — Price Tiers and Rules: https://docs.medusajs.com/resources/commerce-modules/pricing/price-rules
- Medusa `@medusajs/rbac` module — core PR #14310, admin dashboard integration PR #14593 (v2.15.5)