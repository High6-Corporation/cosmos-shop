# Medusa Omnichannel — Handoff v11

**Session date:** 2026-07-16
**Carried forward from:** v10 (O&F Staff + Auditor closed, Developer/Platform Support flagged
🔴 HIGH as the next session's starting point)

---

## 1. Session Summary

The planned job was "browser-test Developer/Platform Support." That job surfaced — and fixed —
**three systemic RBAC bugs affecting every role**, not just this one, plus completed the role's own
gap sweep. The v10 HIGH-severity flag was justified: the role was broken on arrival, in more ways
than predicted.

**Status at end of session:**

- ✅ Invite dropdown missing Developer/Platform Support — root-caused as **intended Medusa core
  behavior** (privilege-escalation filter), not a bug. No fix applied.
- ✅ `medusa user` CLI auto-assigning Super Admin to new accounts — identified and corrected on
  `dev.test@high6.dev`. Adjacent finding: `debug.test@high6.dev` still carries an uncorrected
  auto-assigned Super Admin (flagged, untouched).
- 🔴 → ✅ **Policy churn + dangling links** (Engram #76) — the session's major finding. Server
  restarts were silently stranding already-tested roles on deleted permissions; traced back to this
  session's own account-creation CLI call breaking this morning's Customer Support `refund:create`
  fix. Fixed via Option B (restore-by-ID + diff-sync links) across all 3 seed copies.
  A full regression sweep confirmed every previously-verified role clean afterward.
- ✅ Login outage caused mid-session by an incorrect restart method — resolved within minutes,
  correct restart procedure documented (Engram #77).
- 🔴 → ✅ **Guard AND-vs-ANY bug on POST** — a second systemic bug, found immediately after #76.
  `rbac-guard.ts` required ALL of a multi-op array instead of ANY, silently denying valid POSTs
  across roles. This means this morning's CS refund "verification" only proved the modal was
  reachable, not that the refund POST succeeded. Refixed and reverified for real this session.
- ✅ `payment:read` gap closed for Customer Support (execution dependency of its refund scope,
  core-required on every `/admin/payments/*` sub-route).
- ✅ Developer/Platform Support sub-resource gaps — 8 added (33 → 41 policies), all cited to v5
  §4.4.2, 3 browser-confirmed as 403s before the fix.
- 📌 **Testing order:** ~~Order & Fulfillment Staff~~ ✅ → ~~Read-Only/Auditor~~ ✅ →
  ~~Developer/Platform Support~~ ✅ → **roleless** (invite-accept default-role test) next.
- ⏳ Step 5 (Delete-hiding check for Dev role) — **deferred, not started**, per explicit instruction
  to stop and hand off rather than chain into more implementation this session.

---

## 2. Invite Dropdown Missing "Developer / Platform Support": BY DESIGN, NO FIX

**Root cause:** Medusa core's `get-assignable-roles` step (2.16.0+, `@medusajs/core-flows`) only
returns roles whose entire policy set is covered by the *requesting user's own* permissions —
privilege-escalation prevention. Store Owner lacks 18 of Dev/Platform Support's 33 policies (all of
`api_key:*`, `rbac_policy:*`, `workflow_execution:*`, plus `rbac_role:create/delete`, `payment`
write, `admin_config` write) and is filtered out, along with Super Admin itself.

**The math confirms it exactly:** 8 seeded roles + built-in Super Admin (`*:*` wildcard) = 9
candidates. Logged in as Store Owner, 7 are assignable → matches the 7-option dropdown in the
2026-07-16 screenshot precisely.

**Consequence — this is the actual actionable finding:** Developer/Platform Support (and by the same
logic, Super Admin) can **only** be assigned by `medusa.test@high6.com` (Super Admin). Applies to
both the Invite screen and Settings → Team role assignment. Documented in §5 below and added to the
standing process.

**No code change.** All 3 seed copies confirmed identical and correct — 7×`allCrud` + 5×`readOnly` =
33 policies, matching the pre-session Engram entry exactly.

---

## 3. `medusa user` CLI Auto-Assigns Super Admin: CORRECTED

With the `rbac` feature flag on, the CLI always assigns `role_super_admin` to any new user
(`user.js:25-36`) — it does not create a roleless account as the v10 process assumed.

**On `dev.test@high6.dev`:** Super Admin removed, Developer/Platform Support assigned via the Super
Admin API (same workflow the Settings UI calls). Final state verified: exactly one role.

**Adjacent, untouched:** `debug.test@high6.dev` still carries an uncorrected auto-assigned Super
Admin — flagged for cleanup, not fixed this session (out of scope, not blocking).

**Standing process update:** every future `<role>.test` account creation via CLI must include an
explicit "remove Super Admin, assign correct role" step — this was previously undocumented and is
now a required step, not an assumption.

---

## 4. 🔴 Policy Churn + Dangling Links (Engram #76): RESOLVED — Option B

### 4.1 Mechanism (three interacting parts)

1. **19 custom policy keys don't survive any boot.** `rbac-module-service.js:82-97` — the module's
   `onApplicationStart` hook soft-deletes every policy whose key isn't in the framework's static
   `Policy` enum, with no preserve/exempt mechanism. The 19: `admin_config`×4, `capture`×4,
   `credit_line`×4, `refund`×4, plus 3 legacy wildcards (`inventory_item:*`, `inventory_level:*`,
   `price:*`) left in Store Owner's definition by the v6 fix.
2. **The startup seed re-creates them as new rows and rebuilds every link on every boot**
   (`seed-rbac-on-startup.ts:408-505`, delete-all-links-then-relink). A *complete* boot self-heals —
   this is why the bug had never been caught before.
3. **`medusa user` CLI is a partial boot that `process.exit()`s mid-seed** (`user.js:94`). Any CLI
   run interrupts the re-linking in definition order, stranding later-seeded roles on dead policy
   rows.

### 4.2 Live breakage confirmed

| Role                          | Broken permissions            | Cause                                                          |
| ------------------------------ | ------------------------------ | --------------------------------------------------------------- |
| Developer / Platform Support   | `admin_config:*` ×4 (29/33 effective) | Stranded by this session's own `dev.test` account creation |
| Customer Support               | `refund:create`               | Silently regressed this morning's fix (v10-adjacent, same day) — by this session's CLI run |

**Reframes history:** every past `medusa user` CLI run that created a test account potentially
stranded roles, self-healing invisibly on the next full restart — which is why nobody caught it
sooner. "Role verified in browser" is only valid for the link-generation it was tested against, not
permanently.

### 4.3 Fix — Option B, applied to all 3 seed copies

Restore soft-deleted policy rows by ID (preferring the generation existing links already point at,
via `withDeleted` + restore) instead of creating new generations on every boot; skip link-rebuilding
when links already point at the correct policy IDs. Stable IDs make links interrupt-proof — the CLI
partial-boot hazard becomes harmless going forward.

**Healthy boot signature (now the standard to check for):** `Restored 19 soft-deleted policies` +
`(+0/-0)` link diff on all 8 roles.

**Option D (bundled cleanup) — reverted, not applied:** the 3 legacy wildcard keys turned out to be
**load-bearing** (Medusa batch routes require `operation: ALL`); removal was applied, caught by
testing, and reverted. Explanatory comments added in all 3 copies instead so this isn't
re-attempted blind next time.

**Option C (patch-package the framework's `Policy` enum) — not pursued.** Rejected in favor of B to
avoid expanding the patched-package surface (this workstream already carries one dashboard patch;
adding a framework-core patch for policy persistence was judged worse than a seed-logic fix,
consistent with existing seed-hardening precedent).

### 4.4 Regression sweep — required before trusting any role again

Per explicit instruction, every previously-verified role was reverified post-restart, not just the
CS case that was already found:

| Check                              | Method                                  | Result                                          |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------- |
| Store Owner                          | DB dangling-links query + fresh `/me/permissions` | 203/203 ✓                                        |
| Order & Fulfillment Staff            | same                                        | 17/17 ✓                                          |
| Read-Only/Auditor                    | same                                        | 31/31 ✓                                          |
| Customer Support                     | same + browser refund flow                  | ✓ — see §6                                       |
| Developer/Platform Support           | same + browser detail pages                 | ✓ — "all works" confirmed in browser              |

Zero dangling links across all 5 roles after the fix.

---

## 5. Login Outage + Restart Procedure: RESOLVED, Documented (Engram #77)

**Cause (this session's own mistake):** restarted the server by replicating `medusa develop`'s
internal child process directly (`medusa start`), which boots production mode → secure session
cookies → every browser login 401s over plain `http`.

**Fix:** `npm run dev` from `apps/backend`, files confirmed byte-identical afterward — no data loss,
outage lasted minutes.

**Standing rule, going forward:** never run raw `medusa start` for local development. Logged as
Engram #77 so this isn't rediscovered.

---

## 6. 🔴 Guard AND-vs-ANY Bug on POST: RESOLVED (affected every role)

**Root cause:** `rbac-guard.ts` passed multi-op arrays like `["create","update"]` to the framework's
`hasPermission` under the assumption of ANY-semantics ("has at least one of these"). The framework
actually requires ALL. Any role holding exactly one of `create`/`update` on a resource was denied
**every** POST on that resource — this silently affected Customer Support's refunds and, separately,
Store Owner's `rbac_role:update`-only grants.

**Correction to the record:** this morning's Customer Support refund "verification" only confirmed
the refund modal was reachable — the actual POST had never succeeded. This was not caught until this
session's guard fix.

**Fix:** guard now checks permissions per-operation and allows if *any* passes, matching the intended
semantics. Applied with a corrected inline comment explaining the original mistake, so it isn't
reintroduced.

**Reverified:** CS refund chain confirmed via a non-mutating fake-ID probe (access denied →
`payment:read` passes → `Payment id not found`, chain intact) and then confirmed for real in browser
by `support.test`. ✅

---

## 7. Developer/Platform Support — Sub-Resource Gaps: RESOLVED

8 sub-resource `:read` policies added (33 → 41), all cited to v5 §4.4.2, applied to all 3 seed
copies: `product_variant`, `product_category`, `product_collection`, `product_type`, `product_tag`,
`reservation_item`, `stock_location`, `customer_group`. Three were browser-confirmed as 403s before
the fix (same recurring bug class as every other role this workstream — see v10 §10.1 item 3).

**Verified:** all `dev.test` detail pages and login/session flows confirmed working in browser by
Josh. ✅

---

## 8. Verification Evidence (Summary)

| Check                                 | Method                                     | Result                                              |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Regression sweep, all verified roles     | DB dangling-links query + fresh-login `/me/permissions` | Owner 203/203 ✓ · O&F 17/17 ✓ · Auditor 31/31 ✓ · CS ✓ · Dev ✓ — zero dangling links |
| Seed stability                           | Boot log                                       | `Restored 19` + `(+0/-0)` × 8 roles                    |
| CS refund chain                         | Fake-ID probe (non-mutating)                   | Access denied → `payment:read` → `Payment id not found` (chain passes) |
| CS refund, real                          | Browser, `support.test`                       | ✅ Confirmed                                            |
| `dev.test` detail pages                  | Browser, `dev.test`                            | ✅ Confirmed ("all works")                              |
| `dev.test` logins/sessions                | Browser, all accounts                          | ✅ Confirmed                                            |

---

## 9. Open Items Carried Forward

| Item                                                                                | Severity | Status                                                                 |
| -------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Step 5 Delete-hiding check for Dev role (targets: API keys, sales channels, role/policy screens — role has full CRUD there) | — | **Deferred, not started** — up next |
| `notification:read` for CS + dev — docs silent (400 noise remains)                     | —        | Flagged for Sir Jeff, not decided unilaterally                              |
| `debug.test@high6.dev` — uncorrected auto-assigned Super Admin                         | Low      | Flagged, untouched                                                          |
| Stray "Test Role" entry in roles table                                                 | Low      | Flagged, untouched                                                          |
| ~86 orphan soft-deleted policy generations per churn key                               | —        | Harmless, could be purged — not urgent                                      |
| Secondary audit: Catalog/Product Manager, Marketing, Operations Manager wiring         | —        | Not started (carried from earlier this session's scope, still open)        |
| `/admin/store` + `/admin/store/locales` return 400 for all roles                       | Medium   | Confirmed not RBAC-related, needs separate investigation (carried from v10) |
| Return/Claim/Exchange/Order-Edit operational scope for Customer Support                | —        | Not fixed — v5/v6 silent, needs Sir Jeff decision (carried from v9)         |
| `seed-rbac.ts` / `seed-rbac-on-startup.ts` / `migration-scripts/seed-rbac.ts` triplication | — | Known tech debt — every fix this session still required a 3x hand-edit    |
| Invite-accept default-role behavior (no role → should default to Read-Only)            | —        | Not tested — `roleless.test` account still not created                      |
| Handoff doc §7/§8 tables, restart-procedure note, stale `pnpm` reference note           | —        | This doc (v11) closes these out                                             |
| Engram: resolve `developer-platform-support-untested`, correct morning CS entry (#70)  | —        | **Deferred per instruction** — do before next session starts               |
| Graphify re-index                                                                       | —        | **Deferred per instruction** — do before next session starts               |

---

## 10. Test Accounts

All test accounts use password `TestPass123!`.

| Email                       | Role                                          | Status                                     |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------- |
| owner.test@high6.dev         | Store Owner                                     | ✅ Complete                                    |
| support.test@high6.dev       | Customer Support                                | ✅ Complete (v9), refund flow reverified (v11) |
| fulfillment.test@high6.dev   | Order & Fulfillment Staff                       | ✅ Complete (v10), reverified clean (v11)      |
| auditor.test@high6.dev       | Read-Only / Auditor                             | ✅ Complete (v10), reverified clean (v11)      |
| dev.test@high6.dev           | Developer / Platform Support                    | ✅ Complete — this session                     |
| debug.test@high6.dev         | _(uncorrected Super Admin — needs cleanup)_     | ⚠️ Exists, flagged, not fixed                  |
| roleless.test@high6.dev      | _(unassigned — tests default-role behavior)_    | ⏳ Not created — **up next after Step 5**      |

---

## 11. Files Changed This Session

- `apps/backend/src/utils/seed-rbac.ts` — Option B seed logic (restore-by-ID, diff-sync links);
  CS drift sync + `payment:read`; Dev role +8 sub-resources; wildcard-key explanatory comments
- `apps/backend/src/subscribers/seed-rbac-on-startup.ts` — same changes, duplicate copy
- `apps/backend/src/migration-scripts/seed-rbac.ts` — same changes, duplicate copy; also replaced
  its unreliable key-array filter (was a separate latent bug in this copy specifically)
- `apps/backend/src/api/middleware-utils/rbac-guard.ts` — POST ANY-semantics fix + corrected
  explanatory comment
- `docs/medusa-omnichannel-handoff-v10.md` — §10.1 Super Admin assignment addendum (done earlier
  this session, before the churn bug was found)

**Policy count summary:**

| Role                        | Before this session | After                              | Delta                          |
| ----------------------------- | ---------------------- | ------------------------------------- | ----------------------------------- |
| Developer / Platform Support   | 33                     | 41                                     | +8 sub-resource reads               |
| Customer Support                | 11 (v9)                | 12                                     | +1 (`payment:read`, execution dependency) |
| All roles (churn fix)            | —                      | —                                       | Stability fix, no net policy-count change |

---

## 12. Standing Process Additions (append to v10 §10.1)

1. **Role assignment for any role broader than Store Owner must be done as `medusa.test@high6.com`**
   (Super Admin) — Store Owner cannot self-serve assignment for roles it doesn't fully cover, on
   either Invite or Settings → Team. This applies going forward to every future role, not just
   Developer/Platform Support.
2. **After any `medusa user` CLI account creation, explicitly remove the auto-assigned Super Admin
   role before assigning the intended role** — this step was previously undocumented and caused this
   session's churn-bug discovery.
3. **Never run raw `medusa start` for local dev restarts** — use `npm run dev` from `apps/backend`.
4. **After any full server restart, check the boot log for the healthy-seed signature**
   (`Restored 19 soft-deleted policies` + `(+0/-0)` on all roles) before trusting any role's
   permissions — an incomplete or interrupted boot is the specific failure mode that caused this
   session's regression.
5. **A role's "verified" status has a shelf life.** Per §4.4, it's only valid for the link-generation
   it was tested against — a CLI-triggered partial boot between sessions can silently invalidate a
   prior verification without any code change. When in doubt, re-run the regression sweep (§4.4)
   before trusting an older handoff doc's ✅.

---

## 13. Engram / Graphify — Deferred, Required Before Next Session

Per explicit instruction this session, these were **not** closed out at end of session (unlike every
prior session) — flagged here so the next session opens by finishing this instead of assuming it's
done:

- Log #76 (policy churn) and this session's guard fix as their **own HIGH-severity entries**,
  independent of `developer-platform-support-untested` — related but not the same bug; resolving
  Dev/Platform Support should not be read as resolving either.
- Resolve `developer-platform-support-untested` (role itself is now fully verified).
- Correct the inverted morning CS entry (#70) — it claimed delete-heavy commerce access instead of
  the actual read-only-commerce/full-CRUD-on-technical-resources shape.
- Re-index Graphify for the 5 files changed this session (§11).

Entries created live during the session, pending this cleanup pass: #75 (dropdown root cause), #76
(churn, HIGH), #77 (restart procedure), #78 (guard fix).

---

## 14. Next Session Starting Point

**Recommended first action:** close out §13 (Engram/Graphify cleanup) first — this session
deliberately deferred it and starting fresh without it risks re-deriving context that already exists.

**Then:** Step 5 — Delete-hiding check for Developer/Platform Support (API keys, sales channels,
role/policy management screens — the role has full CRUD there, unlike every other role tested so
far, which may make this a shorter or a longer check than the O&F/Auditor precedent; don't assume
either way going in).

**After that:** `roleless.test@high6.dev` — the last remaining test account, verifying invite-accept
default-role behavior (no role specified → should default to Read-Only per the original testing
order in v9 §7).

**Also queued, lower priority:** secondary audit of Catalog/Product Manager, Marketing, and
Operations Manager wiring (candidates for removal if unused, keep Catalog/Product Manager per
standing lean — not yet confirmed).