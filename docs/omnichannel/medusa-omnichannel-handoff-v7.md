# Medusa Omnichannel — Handoff v7

**Session date:** 2026-07-15
**Carried forward from:** v6 (RBAC regression fix, Store Owner policy gaps)

---

## 1. Session Summary

This session closed out Store Owner RBAC verification after two additional rounds of gap-fixing and a
significant frontend bug discovery. Test-account rollout began with Customer Support, which immediately
surfaced a new, separate lockout bug — **not yet fixed**, carried into the next session.

**Status at end of session:**
- ✅ Store Owner — RBAC permissions fully tested and considered **complete**
- ✅ Invite page "Access Denied" bug — root cause found and fixed (dashboard core bug, not project code)
- 🔴 Customer Support role — new bug found, blocks login entirely. **Not fixed yet.**
- ⏳ Remaining test accounts (fulfillment, auditor, dev, roleless) — not yet created, blocked behind
  Customer Support fix since the same login path may be affected for other limited-permission roles

---

## 2. Store Owner — RBAC Testing: COMPLETE

Store Owner permissions went through three rounds of fixes this session (Round 1 carried in from prior
session, Rounds 2–3 this session), plus a separate frontend bug fix for the invite flow. All rounds are
now verified end-to-end in the dashboard, not just via API.

### 2.1 Round 1 — Commerce resource gaps (13 policies)

Audited all 56 Medusa admin middleware files directly (`node_modules/@medusajs/medusa/dist/api/admin/*/middlewares.js`)
instead of inferring from role-description prose. Added:

| Resource | Type | Source |
|---|---|---|
| service_zone | allCrud + * | fulfillment-sets/middlewares.js |
| inventory_level | allCrud + * | inventory-items/middlewares.js |
| price | allCrud + * | products/middlewares.js, price-lists/middlewares.js |
| capture | allCrud | payments/middlewares.js |
| refund | allCrud | payments/middlewares.js |
| credit_line | allCrud | orders/middlewares.js |
| customer_address | allCrud | customers/middlewares.js |
| product_option_value | allCrud | product-options/middlewares.js |
| translation | allCrud | translations/middlewares.js |
| translation_setting | allCrud | translations/middlewares.js |
| fulfillment_provider | readOnly | was excluded; needed for shipping setup |
| tax_provider | readOnly | was excluded; needed for tax config |
| notification | readOnly | was excluded; operational visibility |

### 2.2 Round 2 — Invite & role-assignment policies

| Resource | Type | Source |
|---|---|---|
| rbac_role:read | inline | users/middlewares.js — GET/POST /admin/users/:id/roles |
| rbac_role:update | inline | users/middlewares.js — role assignment requires this |
| admin_config:read | readOnly | dashboard layouts query /admin/layouts/* on every page |

### 2.3 Round 3 — Wildcard policies for batch routes

| Policy | Source |
|---|---|
| inventory_item:* | inventory-items/middlewares.js — batch route uses PolicyOperation.ALL |
| inventory_level:* | inventory-items/middlewares.js — location-levels batch uses PolicyOperation.ALL |
| price:* | price-lists/middlewares.js — price batch uses PolicyOperation.ALL |

**Final Store Owner policy count: 200** (was ~151 at start of prior session)

### 2.4 Bootstrap idempotency fix

**Root cause:** `listRbacPolicies({ key: hugeArray })` and `listRbacRolePolicies({ role_id: hugeArray })`
array filters are unreliable with large key sets in Medusa's RBAC module. On restart #2+, the existence
check returns empty → `createRbacPolicies` throws "already exists" → `seedRbacData` aborts before
reaching user assignment.

**Fixed in:** `seed-rbac-on-startup.ts` + `utils/seed-rbac.ts`
- List ALL policies/role-policies unfiltered, build key set client-side
- Wrap `createRbacPolicies` / `createRbacRolePolicies` in try/catch for "already exists"
- Wrap bootstrap user-assignment loop in top-level try/catch

### 2.5 Dashboard verification (browser, not just API)

| Test | Result |
|---|---|
| Create a Product (full flow) | ✅ |
| Create a Service Zone under Locations & Shipping | ✅ |
| Create an Inventory Item + set location levels | ✅ |
| Invite a new user, assign role | ✅ (after invite-page fix, see §3) |
| Store Owner still cannot create/edit RBAC roles | ✅ correctly denied (403) |
| Sidebar/blocked-access regression check | ✅ no regressions |
| Restart persistence | ✅ 3/3 restarts confirmed at 200 policies |

**Store Owner is considered fully tested and closed.** Next role to test per priority order:
Developer/Platform Support (allCrud-affected — see v6 §4.4.9), then Order & Fulfillment Staff and
Read-Only/Auditor, then Customer Support (in progress, see §4).

---

## 3. Invite Page "Access Denied" Bug — FIXED

### Symptom
Store Owner navigated to Settings → Users → Invite and saw "Access Denied — Required permission:
invite:create, invite:read" **despite the API returning 200 with both permissions present** in the
response body. Persisted across hard refreshes, cache-disabled reloads, and incognito — ruling out
standard browser caching.

### Root cause
**React Query key collision between two Medusa dashboard core hooks**, both using the identical query
key `["me-permissions"]`:

| Hook | Location | Calls | Expected shape |
|---|---|---|---|
| `zDt` (sidebar filter widget) | chunk-7PPGSSJH.mjs | `GET /admin/me/permissions` | Flat array `["invite:create", ...]` |
| `useMePermissions` (route guard) | chunk-2V5DOTI3.mjs | `GET /admin/rbac/me/permissions` | `{permissions: [...]}` |

Because they share a query key, React Query deduplicates: whichever fires first caches its result under
the shared key, and the second hook receives the first hook's cached data **shape**. When the sidebar
widget fired first (the common case), the route guard received a flat array, accessed `.permissions` on
it → `undefined` → empty permissions map → every protected route denied. The denial was persistent
(not a loading flicker) because React Query's `staleTime: 5*60*1e3` kept serving the wrong-shaped cached
data for 5 minutes at a time.

Confirmed via temporary `console.log` inside the actual guard component, observed in a real browser:
`rawPolicy: {permissions: undefined}`.

### Fix
1-line defensive fix in `node_modules/@medusajs/dashboard/dist/chunk-7PPGSSJH.mjs`, handling both
possible cached shapes:

```diff
 const policy = useMemo3(() => {
   if (!permissionsResponse) { return null; }
-  return { permissions: permissionsResponse.permissions };
+  const perms = Array.isArray(permissionsResponse)
+    ? permissionsResponse
+    : permissionsResponse.permissions;
+  return { permissions: perms ?? [] };
 }, [permissionsResponse]);
```

### ⚠️ Action required — this fix will NOT survive `npm install`
This patch lives in `node_modules/@medusajs/dashboard/dist/`, which is regenerated on every fresh
install or package update. **Next session priority:** wrap this in `patch-package` (or equivalent) so
it reapplies automatically, or it will silently disappear and this exact bug will reappear with no
memory of why. This is an upstream Medusa core bug (query-key collision) — worth filing against
`@medusajs/dashboard` separately from the local patch.

### Disposition of `/admin/rbac/me/permissions` custom route
The custom override route built in the prior session (intended to fix this same bug) turned out to be
dead code — confirmed via Network tab that it is **never called** by the invite page or any other
observed page. It was not the cause and is not part of the fix. **Recommend removing it next session**
to avoid confusion, unless a future need for it is identified.

### What was ruled out during investigation
- ❌ Backend policies (confirmed correct — 200 permissions returned, invite:create/invite:read present)
- ❌ Feature flags (`rbac: true` confirmed)
- ❌ JWT tokens (roles embedded correctly)
- ❌ The custom `/admin/rbac/me/permissions` route (returned correct data, just never reached)
- ❌ `PermissionsProvider` / `RoutePermissionGuard` logic (correct logic, bad input data)
- ❌ Browser/HTTP caching, incognito, hard refresh (bug was in-memory React Query cache, survives all of these within a tab session)

---

## 4. Test Account Rollout — IN PROGRESS

### 4.1 Test accounts

All test accounts use password `TestPass123!`.

| Email | Role | Status |
|---|---|---|
| owner.test@high6.dev | Store Owner | ✅ Created, tested, complete (§2) |
| support.test@high6.dev | Customer Support | ✅ Created — 🔴 **login broken, see §4.2** |
| fulfillment.test@high6.dev | Order & Fulfillment Staff | ⏳ Not created — blocked pending §4.2 fix |
| auditor.test@high6.dev | Read-Only / Auditor | ⏳ Not created — blocked pending §4.2 fix |
| dev.test@high6.dev | Developer / Platform Support | ⏳ Not created — blocked pending §4.2 fix |
| roleless.test@high6.dev | *(unassigned — tests default-role behavior, open item carried from v6 §4.4.9 #4)* | ⏳ Not created |

### 4.2 🔴 NEW BUG — Customer Support cannot access dashboard after login (login succeeds, then locked out)

**Not fixed. Top priority for next session.**

`support.test@high6.dev` was successfully created and invited (confirming the invite-page fix in §3
works for real account creation). However, after a successful login, the user cannot reach the
dashboard at all:

```
POST /auth/user/emailpass  → 200  (login succeeds)
POST /auth/session         → 200  (session created)
GET /admin/users/me        → 400  "Access denied: missing permission user:read"
GET /admin/users/me        → 400  (repeats)
```

The user remains stuck on the login page / cannot land on `/app/orders` or any dashboard route,
because the dashboard's own bootstrap sequence calls `/admin/users/me` to identify the logged-in user,
and Customer Support's policy list apparently lacks `user:read`.

**This is a different bug from §3** — it's not a frontend cache issue (the error is a real 400 from the
backend), and it's not a Store Owner issue (Store Owner has `user:read` already, per §2.2). This looks
like a straightforward missing-policy gap for the Customer Support role specifically, similar in
*category* to the Round 1 Store Owner gaps in §2.1 — a role whose "40-policy-style" list was likely
built the same inference-based way and never included the one policy every role needs just to complete
login/bootstrap.

**Recommended next-session approach:**
1. Confirm `user:read` (at minimum) is present in Customer Support's policy list — check the DB
   directly, don't trust seed-log counts (per the pattern that burned this project repeatedly in §2).
2. Given `/admin/users/me` is called on every single dashboard page load regardless of role, **check
   whether `user:read` is missing from any other role's policy list too** — Operations Manager,
   Catalog/Product Manager, Marketing, Order & Fulfillment Staff, Read-Only/Auditor, Developer/Platform
   Support. If Customer Support is missing it, there's a real chance the seed-list derivation process
   simply never accounted for this baseline requirement across the board. Worth checking all 7
   non-Store-Owner roles for this one policy before creating the remaining test accounts, rather than
   discovering this same lockout one role at a time.
3. Once fixed, re-attempt login as `support.test@high6.dev` and confirm full dashboard access matches
   the intended Customer Support scope (see v6 role-scope table).
4. Only after this is resolved, proceed to create `fulfillment.test`, `auditor.test`, `dev.test`, and
   `roleless.test` accounts — no point creating them if they'll hit the same lockout.

---

## 5. Open Items Carried Forward

| Item | Status |
|---|---|
| `patch-package` (or equivalent) for the dashboard core fix in §3 | Not done — will be lost on next `npm install` |
| Upstream bug report for Medusa dashboard query-key collision | Not filed |
| Remove dead `/admin/rbac/me/permissions` custom route | Not done |
| Customer Support `user:read` lockout (§4.2) | **Not fixed — top priority** |
| Check `user:read` across all 7 non-Store-Owner roles | Not done |
| Refund, capture, credit_line, translation write flows (Store Owner) | Never exercised — no test data |
| Invite-accept default-role behavior (no role specified → should default to Read-Only) | Not tested — `roleless.test` account planned for this, blocked by §4.2 |
| Graphify clean rebuild (`graphify .`, not `--update`) | Needed — prior `--update` run anomalously re-indexed `node_modules` before `.graphifyignore` was added |
| Testing order for remaining roles | Developer/Platform Support next (allCrud-affected), then Order & Fulfillment Staff, Read-Only/Auditor, then Customer Support (resume after §4.2 fix) |

---

## 6. Files Changed This Session

- `apps/backend/src/migration-scripts/seed-rbac.ts`
- `apps/backend/src/subscribers/seed-rbac-on-startup.ts`
- `apps/backend/src/utils/seed-rbac.ts`
- `src/api/admin/me/permissions/route.ts` (array-filter reliability fix)
- `src/api/admin/rbac/me/permissions/route.ts` (created — now confirmed dead code, see §3)
- `.graphifyignore` (created — excludes node_modules, .medusa, .next, graphify-out, dist, .turbo)
- `node_modules/@medusajs/dashboard/dist/chunk-7PPGSSJH.mjs` (⚠️ unpersisted — see §5)