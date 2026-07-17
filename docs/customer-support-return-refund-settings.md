# Customer Support — Return/Refund Reasons Settings Access

**Date:** 2026-07-16
**Decision:** Product owner confirmed — grant view-only access to Return Reasons and Refund Reasons settings pages
**Prior status:** Deferred (v5 §4.4.2 read as "Settings: None")
**Supersedes:** [settings-default-navigation-fix.md](settings-default-navigation-fix.md) §3 (conservative "do not implement" recommendation)

---

## 1. Policies Granted

Middleware-confirmed policy keys added to Customer Support:

| Policy | Resource | Operation | Middleware source |
|---|---|---|---|
| `return_reason:read` | `return_reason` | `read` | `node_modules/@medusajs/medusa/dist/api/admin/return-reasons/middlewares.js` (line 47-48) |
| `refund_reason:read` | `refund_reason` | `read` | `node_modules/@medusajs/medusa/dist/api/admin/refund-reasons/middlewares.js` (line 47-48) |

Both are read-only. No create/update/delete operations granted — Customer Support can view the reason-code lookup data but cannot modify it.

---

## 2. Changes

| File | Change |
|---|---|
| `apps/backend/src/migration-scripts/seed-rbac.ts` | Added `return_reason:read` + `refund_reason:read` to Customer Support |
| `apps/backend/src/subscribers/seed-rbac-on-startup.ts` | Same (duplicate ROLE_DEFINITIONS — known tech debt) |
| `apps/backend/src/admin/lib/__tests__/nav-permissions.unit.spec.ts` | Updated Customer Support fixture (9→11 policies), updated landing page expectation, added visibility test |

**Customer Support policy count:** 9 → 11

---

## 3. Settings Behavior

### Landing page

`computeSettingsLandingPage` now returns `/settings/return-reasons` for Customer Support (first match in sidebar order, ahead of `/settings/refund-reasons`).

### Sidebar visibility — partial "General" section

This is the first role to exercise the **partial section visibility** code path in `hideEmptySections`. The "General" section contains:

| Item | Visible? | Why |
|---|---|---|
| Store | Hidden | No `store:read` |
| Users | Hidden | No `user:read` |
| Regions | Hidden | No `region:read` |
| Tax Regions | Hidden | No `tax_region:read` |
| **Return Reasons** | **Visible** | Has `return_reason:read` ✅ |
| **Refund Reasons** | **Visible** | Has `refund_reason:read` ✅ |
| Sales Channels | Hidden | No `sales_channel:read` |
| Product Types | Hidden | No `product_type:read` |
| Product Tags | Hidden | No `product_tag:read` |
| Locations & Shipping | Hidden | No `stock_location:read` |

The section heading stays visible because not ALL items are hidden — the DOM walk in `hideEmptySections` stops when it encounters an ancestor containing any visible anchor. This has always been the implemented logic; Customer Support is simply the first role to land in this middle ground between "all hidden" and "all visible."

### Write actions blocked

Customer Support has no `return_reason:create`, `return_reason:update`, `return_reason:delete`, `refund_reason:create`, `refund_reason:update`, or `refund_reason:delete`. Create/Edit/Delete buttons on both pages will deny on click (backend enforcement via rbacGuard + Medusa middleware) and would be hidden if they were rendered as anchor links (they're not — they're buttons, same class as the Delete action-menu gap documented in v8 §3.4).

---

## 4. What's NOT in scope

- Store, Users, Regions, Tax Regions, Sales Channels, Product Types, Product Tags, Locations & Shipping — no access
- Developer section (API Keys, Workflows) — no access
- Roles, Policies — no access
- Write access to Return/Refund Reasons — no access (read-only)

The v5 §4.4.2 boundary ("Settings: None except Profile") has been narrowed to "Settings: Profile + Return Reasons + Refund Reasons." All other Settings restrictions stand.

---

## 5. Verification

| Check | Result |
|---|---|
| Tests | 45/45 passing (+1 new visibility test) |
| Build | Clean (2.00s backend, 8.10s frontend, zero errors) |
| Landing page | `computeSettingsLandingPage(CUSTOMER_SUPPORT)` → `/settings/return-reasons` |
| Section visibility | Return/Refund Reasons visible, all other General items hidden |
| Write blocked | No create/update/delete policies granted |

### Browser verification checklist

1. Hard refresh as `support.test@high6.dev`
2. Settings sidebar → "General" heading visible with ONLY Return Reasons and Refund Reasons
3. Click Settings → lands on `/settings/return-reasons` (no 400)
4. Both Return Reasons and Refund Reasons pages load and display data
5. Attempt edit/create on either page → should deny
6. Store Owner Settings unchanged (all business items visible, Developer hidden)

---

## 6. Open Items Closed

| Item | Status |
|---|---|
| Customer Support settings scope (deferred in refund-scope session, re-deferred in settings-redirect session) | **Resolved** — Return/Refund Reasons read-only granted per product-owner decision |
| Return/Claim/Exchange/Order-Edit operational scope (flagged in refund-scope session) | Still open — only refund:create granted; return/claim/exchange/order-edit remain ambiguous |

---

## 7. Graphify & Engram

- **Graphify**: Changes captured in existing Admin Lib & Nav Permissions (C12) and RBAC Seed (C33, C40, C41) communities.
- **Engram**: This decision and policy additions persisted.
