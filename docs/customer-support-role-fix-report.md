# Customer Support Role — Delete UX + Refund Scope Resolution

**Date:** 2026-07-16
**Session:** Follow-up to v8 §3.4 (row-action boundary) and §4 (refund gap)

---

## 1. Summary

Two items carried from v8 were investigated and resolved:

| Item | Disposition |
|---|---|
| Delete row-action visible but deny-on-click | **Not a bug** — Delete is on the detail page header, properly gated by `canDelete` (Medusa dashboard's `PermissionsProvider`). Already hidden for Customer Support via `useCustomerPermissions()` → `can("customer", "delete")` → `false`. |
| Customer Support missing `refund:create` | **Fixed** — `refund:create` added to Customer Support's policy list. Required a guard fix (sub-resource map) to correctly route `POST /admin/payments/:id/refund` → `refund` resource instead of `payment`. |

---

## 2. Delete Row-Action — Investigation Result: Already Correct

### 2.1 Where Delete actually lives

v8 §3.4 and §4 described Delete as a "row menu" action visible but denying on click. Investigation of the actual Medusa dashboard code (v2.17.2) found:

- **Customer list table** (`customer-list-table.tsx`): The `CustomerActions` component in each row only renders an **Edit** action, gated by `can("customer", "update")`. There is **no Delete action** in the row menu at all ([source: line 92-122](node_modules/@medusajs/dashboard/src/routes/customers/customer-list/components/customer-list-table/customer-list-table.tsx#L92-L122)).
- **Customer detail page** (`customer-general-section.tsx`): The Delete action lives in the **detail page header** ActionMenu, gated by `canDelete` from `useCustomerPermissions()` → `can("customer", "delete")` ([source: line 31, 90-99](node_modules/@medusajs/dashboard/src/routes/customers/customer-detail/components/customer-general-section/customer-general-section.tsx#L31)).

### 2.2 Permission flow

The dashboard's `PermissionsProvider` fetches the user's resolved permissions from `GET /admin/rbac/me/permissions` (via `sdk.admin.rbacRole.mePermissions()`), builds a lookup map, and exposes `can(resource, operation)`.

For Customer Support (DB-confirmed: no `customer:delete`), `can("customer", "delete")` returns `false`, so `canDelete` is `false`, and the Delete action group is never pushed into the `groups` array → the ActionMenu with Delete is never rendered.

**Verdict: No code change needed.** The Delete button is already properly hidden. v8's "row menu denies" description was inaccurate for the current Medusa version — the Delete was either misattributed to the wrong UI location (list row vs. detail header) or observed in a prior version where the `PermissionsProvider` integration differed.

---

## 3. Refund Scope — Fixed

### 3.1 What v5/v6 intended

**v5 §4.4.4** (Known v1 scope gaps table):
> Customer Support `order:write` is full write | Originally scoped as "notes/refund request only" — not expressible at the policy level.

**v6 §4.4.10** (Test account table):
> Order notes/refund-request only *intended*, but full order write is the documented v1 gap

Both documents unambiguously state Customer Support should handle **refund requests**. The policy-level workaround (full `order:write`) was an accepted v1 gap, not the intended scope.

### 3.2 DB state before fix

```
Customer Support policies (8 total):
  customer:create, customer:read, customer:update
  inventory_item:read
  order:create, order:read, order:update
  product:read
```

No `refund:*`, `payment:*`, `return:*`, `order_claim:*`, `order_exchange:*`, or `order_change:*`.

### 3.3 Guard sub-resource routing bug (discovered during implementation)

While adding `refund:create`, a pre-existing guard bug was found: the `URL_RESOURCE_MAP` in `rbac-guard.ts` uses static path-prefix matching, which cannot distinguish sub-resource routes with dynamic `:id` segments:

| Endpoint | Our guard resolved to | Medusa middleware requires | Match? |
|---|---|---|---|
| `POST /admin/payments/:id/refund` | `payment` | `refund:create` | **NO** |
| `POST /admin/payments/:id/capture` | `payment` | `capture:create` | **NO** |
| `POST /admin/orders/:id/credit-lines` | `order` | `credit_line:create` | **NO** |
| `POST /admin/orders/:id/fulfillments` | `order` | `fulfillment:create` | **NO** |
| `POST /admin/orders/:id/fulfillments/:fid/cancel` | `order` | `fulfillment:update` | **NO** |
| `POST /admin/orders/:id/fulfillments/:fid/shipments` | `order` | `fulfillment:update` | **NO** |
| `POST /admin/orders/:id/fulfillments/:fid/mark-as-delivered` | `order` | `fulfillment:update` | **NO** |

Without this fix, adding `refund:create` to Customer Support would be useless — the guard would block the request at the `payment:create|update` check before Medusa's middleware ever evaluates `refund:create`.

**Note:** Store Owner was also affected by this bug (has `refund:*` but only `payment:read`) — the refund/capture flows were never actually exercised per v8 §5. This fix unblocks them for all roles.

### 3.4 Changes made

**File 1: `apps/backend/src/api/middleware-utils/rbac-guard.ts`**

Added `SUB_RESOURCE_MAP` — a regex-based matching pass that runs before the static `URL_RESOURCE_MAP`, correctly resolving dynamic sub-resource routes:

```typescript
const SUB_RESOURCE_MAP: [RegExp, string][] = [
  [/^payments\/[^/]+\/refund$/, "refund"],
  [/^payments\/[^/]+\/capture$/, "capture"],
  [/^orders\/[^/]+\/credit-lines$/, "credit_line"],
  [/^orders\/[^/]+\/fulfillments$/, "fulfillment"],
  [/^orders\/[^/]+\/fulfillments\/[^/]+\/(cancel|shipments|mark-as-delivered)$/, "fulfillment"],
];
```

`resolveResource()` now checks `SUB_RESOURCE_MAP` first, then falls through to `URL_RESOURCE_MAP`. The HTTP-method → operation mapping (`POST` → `["create", "update"]`) is unchanged and correct for all these endpoints.

**File 2: `apps/backend/src/migration-scripts/seed-rbac.ts`**

Added `refund:create` to Customer Support's policy list:
```typescript
{ key: "refund:create", resource: "refund", operation: "create" },
```

**File 3: `apps/backend/src/subscribers/seed-rbac-on-startup.ts`**

Same policy addition to the startup subscriber's duplicate role definition. (These two files maintain separate copies of `ROLE_DEFINITIONS` — a known tech debt item, not addressed this session.)

### 3.5 Verification

| Check | Result |
|---|---|
| Test suite | 38/38 passing |
| Backend build | Successful (4.82s), 0 new type errors |
| DB spot-check (Store Owner) | 200 policies, full `refund:*` and `capture:*` present — unchanged |
| DB spot-check (all roles) | Policy counts stable, Customer Support now 9 (was 8, +`refund:create`) |
| Guard routing (`POST /admin/payments/:id/refund`) | Regex matches → resource `refund`, operation `["create", "update"]` → `refund:create` check ✓ |
| TypeScript type-check | Pre-existing `import.meta` errors in `client.ts` only — no new errors |

---

## 4. Ambiguous Scope — Unresolved, Needs Human Decision

### 4.1 What v5/v6 say about Return, Claim, Exchange, Order Edit

**v5 and v6 mention ONLY "refund" and "notes"** for Customer Support's intended order-write scope. Neither document mentions:

- **Returns** (`return` resource): `return:read`, `return:create`, `return:update`
- **Claims** (`order_claim` resource): `order_claim:read`, `order_claim:create`, etc.
- **Exchanges** (`order_exchange` resource): `order_exchange:read`, `order_exchange:create`, etc.
- **Order Edits** (`order_change` resource): `order_change:read`, `order_change:create`, etc.

### 4.2 Narrowest interpretation

Per the task spec: "propose the narrowest interpretation consistent with 'handle refund requests'."

**Recommendation:** Add only `refund:create`. Refund and return are related but distinct Medusa workflows — a refund is a payment operation (`POST /admin/payments/:id/refund`), while a return involves physical goods (`POST /admin/returns`). The v5/v6 scope documents say "refund request" specifically, not "return handling." Customer Support should be able to process refunds without needing return/claim/exchange/order-edit access.

### 4.3 Practical consideration

The current v8 §4 interface checklist already notes that Returns, Claims, Exchanges, Order Edits, Refunds, and Captures are "deny on click inside an order." After this fix, Refund is resolved. The other four remain deny-on-click — this is the implementation of the narrowest interpretation. If the product owner decides Customer Support should handle returns too, adding `return:create` and `return:update` (or `return:read` alone for visibility) is a straightforward policy-list change.

**Decision needed:** Confirm that "refund only" (not "refund + return as a workflow pair") is the intended scope for Customer Support, or expand to include return/claim/exchange/order-edit.

---

## 5. Files Changed

| File | Change |
|---|---|
| `apps/backend/src/api/middleware-utils/rbac-guard.ts` | Added `SUB_RESOURCE_MAP` regex array + update to `resolveResource()` |
| `apps/backend/src/migration-scripts/seed-rbac.ts` | Added `refund:create` to Customer Support policies |
| `apps/backend/src/subscribers/seed-rbac-on-startup.ts` | Same policy addition (duplicate definition) |

No role policy lists other than Customer Support were modified.

---

## 6. Graphify & Engram Status

### Graphify — Clean Rebuild Complete ✅
- Old graph (Jul 15, v8-flagged as stale: indexed `.medusa` bundle artifacts, lacked policy-string vocabulary) was removed.
- Clean rebuild completed: **1,075 nodes, 2,002 edges, 80 communities** (vs old: 5,841 nodes, 20,545 edges, 338 communities).
- The 5× reduction in node count confirms the old graph was indexing `.medusa/server` build artifacts and `node_modules` — the new graph is scoped to actual project source.
- Outputs: `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`
- RBAC-related communities are now correctly identified: Admin Lib & Nav Permissions (C12), RBAC Startup Seed (C33), RBAC Seed Utils (C40), RBAC Migration Seed (C41), Me Permissions Endpoint (C53), RBAC Me Permissions Override (C54), Backend Middleware Utils & RBAC (C22).

### Engram — Updated ✅
- v8 §5 requested Engram persistence of v8's root causes (guard bypass, nav-filter fix, two open gaps).
- Memory search at session start found **no prior Engram entries** for the v8 session findings — the v8-requested persistence did not land.
- This session's findings are now persisted: Customer Support refund scope + guard sub-resource fix. Session summary saved.
