# Medusa Omnichannel — Handoff v9

**Session date:** 2026-07-16
**Carried forward from:** v8 (Customer Support login lockout + sidebar nav fix, test-account rollout in progress)

---

## 1. Session Summary

This was a long session entirely focused on closing out **Customer Support** RBAC testing end-to-end,
plus two infrastructure fixes to stop recurring failure patterns from resurfacing on future roles.
Multiple bugs were found, one fix caused a regression, the regression was root-caused and fixed, and
a final scope decision was made and implemented.

**Status at end of session:**
- ✅ Customer Support — Delete button investigated: **UI location was already correct**, no code change needed there (see §2)
- ✅ Customer Support — `refund:create` gap closed, guard routing bug fixed (see §3)
- ✅ Settings default-navigation bug — **fixed generically**, but required two follow-up rounds (see §4)
- ✅ Customer Support — Return Reasons / Refund Reasons settings access — **granted**, product-owner decision (see §5)
- ✅ Infrastructure: `patch-package` persistence for the v7 dashboard core fix (see §6)
- ✅ Infrastructure: module-load smoke test for `rbac-sidebar-filter.tsx` (see §6)
- 🔴 **New open item for next session:** Delete button should be **hidden**, not just deny-on-click, when the
  role lacks delete permission — applies to whichever role is tested next (see §8)
- ⏳ Remaining test accounts (fulfillment, auditor, dev, roleless) — still not created
- 📌 **Testing order changed:** next session starts with **Order & Fulfillment Staff**, not
  Developer/Platform Support as previously planned (see §7)

---

## 2. Customer Support — Delete Button Investigation

**Finding:** The v8 §3.4 "row menu denies" report was inaccurate for the resource actually checked.
Delete for a Customer is on the **customer detail page header**, not a list-table row menu, and is
already correctly gated:

```
customer-general-section.tsx → useCustomerPermissions() → can("customer", "delete") → false
```

Customer Support has no `customer:delete` → Delete button is already hidden at this location. No code
change was needed here.

**Unresolved nuance carried forward:** it's not fully confirmed whether a genuine **list-row** Delete
action exists anywhere else in the current Medusa version for other resources — v8 §3.4 described the
open item as a general pattern (row menus, `/:id/edit`, order-detail flows), not specific to Customers.
See §8 for the related new instruction for next session.

---

## 3. Customer Support — Refund Scope: RESOLVED

### 3.1 What was fixed

Two changes, because the guard itself had a pre-existing routing bug:

| File | Change |
|---|---|
| `rbac-guard.ts` | Added `SUB_RESOURCE_MAP` — regex-based matching for 7 dynamic sub-resource routes (refund, capture, credit_line, 4 fulfillment paths) that the static `URL_RESOURCE_MAP` couldn't distinguish |
| `seed-rbac.ts` | Added `refund:create` to Customer Support |
| `seed-rbac-on-startup.ts` | Same (duplicate ROLE_DEFINITIONS — known tech debt, not fixed) |

### 3.2 What was confirmed against source docs

v5 §4.4.4 and v6 §4.4.10 both scope Customer Support to "notes/refund request only." The `refund:create`
addition is directly traceable to these sources.

### 3.3 What remains ambiguous — still open

**Return, Claim, Exchange, Order Edit** are not documented anywhere for Customer Support in v5/v6 — only
"refund" and "notes" are mentioned. The narrowest interpretation (refund only) was applied. **This is
still an open item for Sir Jeff** — see §9.

### 3.4 Verification performed
- 38/38 tests passing at time of this fix
- DB spot-check across all 8 roles — policy counts stable
- Store Owner refund/capture unaffected (200 policies, refund:*/capture:* intact)

---

## 4. Settings Default-Navigation Bug — RESOLVED (took 3 rounds)

This bug took three attempts across the session. Documenting all three because the failure modes are
instructive for future widget-file changes.

### 4.1 Round 1 — Initial fix, looked complete but wasn't

**Root cause:** `settings.tsx:9-10` in Medusa's dashboard hardcodes:
```typescript
if (location.pathname === "/settings") {
  navigate("/settings/store", { replace: true })
}
```
No permission check — any role without `store:read` hit a 400 on clicking Settings.

**Fix attempted:** `computeSettingsLandingPage()` added to `nav-permissions.ts` (ordered permission map,
first-match-wins, falls back to `/settings/profile`), called from a new `rewriteSettingsLink()` function
in `rbac-sidebar-filter.tsx` that used `setAttribute("href", ...)` on the sidebar anchor.

**Reported as:** Complete, 44/44 tests passing.

**Actual result (caught via screenshot, not by the agent):** Settings still 400'd on `/settings/store`,
**and** the entire General + Developer sidebar sections — previously correctly hidden — became fully
visible again. A real regression of the already-working v8 section-collapse fix.

### 4.2 Round 2 — Regression root-caused and fixed

**Root cause:** During the Round 1 edit, `rewriteSettingsLink()` was accidentally inserted *inside* the
body of `hideEmptySections()`, deleting that function's declaration line. The orphaned body code
executed at module scope referencing an undefined variable → `ReferenceError` → the entire widget module
crashed on import → nothing in the widget ran, including the new fix.

**Why 44/44 tests didn't catch it:** the unit tests only import `nav-permissions.ts` (pure functions).
`rbac-sidebar-filter.tsx` had zero tests exercising module load or DOM behavior — a syntax structure
that's invalid at runtime but not invalid TypeScript can pass `tsc`/Jest cleanly and still crash the
actual Vite/Babel bundle.

**Fix:** function declarations restored, both functions properly standalone again.

**Reported as:** Complete — section-collapse confirmed fixed. **Settings redirect still not fixed**,
confirmed by follow-up screenshot (still landed on `/settings/store`, still 400'd).

### 4.3 Round 3 — Actual root cause found: React Router incompatibility

**Root cause:** the Settings sidebar link is a React Router `<Link to="/settings">`, not a plain `<a>`.
React Router's `<Link>` doesn't read the DOM `href` attribute at click time — it calls `navigate()`
using the `to` prop captured in its component closure at render time. `setAttribute("href", ...)`
changed what was visible in devtools but had **zero effect on actual click navigation**. This is the
same "code runs without error but doesn't do what it looks like it does" trap as the test-suite gap in
§4.2, one layer deeper.

**Fix:** replaced `rewriteSettingsLink()` (DOM mutation) with `interceptSettingsClick()` — a
capture-phase click listener (`{ capture: true }`, fires before React's synthetic event system) that
calls `preventDefault()` + `stopPropagation()`, then calls React Router's own `navigate()` (via
`useNavigate()`) directly.

**Verified:** actual click, not attribute inspection, as both `support.test` (→ `/settings/profile` at
the time, later → `/settings/return-reasons` after §5) and `owner.test` (→ `/settings/store`, unchanged).

### 4.4 Lesson carried into Engram
"Tests passing" and "attribute looks correct in devtools" are both insufficient verification for this
widget file. Only an actual click/actual browser round-trip counts. This cost three rounds to learn —
apply it proactively to any future `rbac-sidebar-filter.tsx` change rather than rediscovering it again.

---

## 5. Customer Support — Return Reasons / Refund Reasons Settings Access: GRANTED

**Product-owner decision (this session), overriding the earlier conservative "Settings: None" reading
of v5 §4.4.2:** Customer Support gets read-only access to **Return Reasons** and **Refund Reasons**
settings pages only — pairing with the `refund:create` operational permission from §3.

| Policy | Resource | Operation | Middleware source |
|---|---|---|---|
| `return_reason:read` | `return_reason` | `read` | `return-reasons/middlewares.js:47-48` |
| `refund_reason:read` | `refund_reason` | `read` | `refund-reasons/middlewares.js:47-48` |

**Customer Support policy count: 9 → 11.** No write policies granted (create/update/delete all denied,
verified).

**Sidebar behavior:** Customer Support is the first role to exercise the *partial* section-visibility
path in `hideEmptySections` — "General" heading stays visible with **only** Return Reasons and Refund
Reasons listed underneath; all other General items (Store, Users, Regions, Tax Regions, Sales Channels,
Product Types, Product Tags, Locations & Shipping) remain hidden. Settings landing page now resolves to
`/settings/return-reasons` (first match in sidebar order).

**Everything else in v5 §4.4.2's "Settings: None" boundary still stands** — this was a narrow, explicit
carve-out, not a general loosening.

Browser-verified end-to-end by the user directly: sidebar shows only the two pages, both load without
a 400, edits denied on both, Store Owner unaffected.

---

## 6. Infrastructure Fixes — Both Closed

### 6.1 `patch-package` for the v7 dashboard core fix

The invite-page query-key-collision fix (v7 §3) lived directly in
`node_modules/@medusajs/dashboard/dist/chunk-7PPGSSJH.mjs`, with no persistence — every `npm install`
would silently revert it. This was flagged as an open risk across v7 and v8 and finally closed this
session.

- `patch-package` installed as devDependency
- `"postinstall": "patch-package"` added to `package.json` (confirmed no existing postinstall to clobber)
- `patches/@medusajs+dashboard+2.17.2.patch` generated, capturing the exact v7 §3 diff
- **Verified to survive reinstall**: `node_modules/@medusajs/dashboard` deleted, `npm install` run,
  postinstall fired, fix confirmed present in the reinstalled chunk — confirmed independently by both
  the agent and the user
- Note: patch applies at the **hoisted root** `node_modules` (Turborepo workspace behavior) —
  `apps/backend/node_modules/@medusajs/dashboard` is a phantom path, not the real location

### 6.2 Module-load smoke test for `rbac-sidebar-filter.tsx`

Directly addresses the failure class from §4.2 — a syntax structure invalid at runtime but not caught
by `tsc`/Jest.

- New test: `apps/backend/src/admin/widgets/__tests__/rbac-sidebar-filter.unit.spec.ts` — statically
  imports the widget module; module-scope errors now fail the suite at load time
- `jest.config.js` updated: `tsx` added to `moduleFileExtensions`, transform regex widened to `[jt]sx?$`
- **Proven to catch the exact regression class**: the §4.2 bug (orphaned code at module scope) was
  deliberately reintroduced, confirmed the new test fails (`Test suite failed to run`), then reverted
- Final suite: **47/47 passing**, 0 new type errors

### 6.3 Upstream bug report — drafted, not yet filed

`gh` CLI was unavailable this session. Issue text is ready to paste into `medusajs/medusa`:

> **Title:** Dashboard: React Query key collision `["me-permissions"]` between sidebar widget and route guard
>
> Two hooks share the identical query key `["me-permissions"]` but call different endpoints returning
> different shapes — `GET /admin/me/permissions` (flat array) vs. `GET /admin/rbac/me/permissions`
> (`{permissions: [...]}`). Whichever fires first caches its shape under the shared key; when the other
> hook reads it, shape mismatch → `undefined` → every protected route denies for the query's `staleTime`.

**Action for next session or whenever convenient: file this manually via the GitHub web UI.**

---

## 7. ⚠️ Testing Order Change

Previous plan (set in v7, reconfirmed in v8): Developer/Platform Support next (flagged "allCrud-affected"
per v6 §4.4.9), then Order & Fulfillment Staff, then Read-Only/Auditor.

**Decided this session: next role is Order & Fulfillment Staff instead.** No specific reason logged for
the reorder — noting it here so it isn't mistaken for an oversight. Developer/Platform Support and
Read-Only/Auditor remain queued after Fulfillment.

---

## 8. 🔴 New Instruction for Next Session — Delete Button Visibility

**Decided this session, to be implemented starting with whichever role is tested next (Order &
Fulfillment Staff):**

> If a role does not have delete permission for a resource, the Delete button/action should be
> **hidden**, not merely deny-on-click.

This extends the existing `ACTION_ROUTE_PERMISSIONS` pattern (v8 §3.3, currently covers
create/import/export/invite — static anchor links only) to cover Delete specifically. Per v8 §3.4 and
the investigation in §2 above, Delete actions are frequently **buttons inside menus**, not static
anchors — the existing CSS-selector-on-`href` approach won't work unmodified. This will likely need
either:
- A data-attribute or `aria-label`-based selector strategy for button-based row/detail actions, or
- A React-level permission check inside the relevant components (more invasive, more reliable)

**Recommend the next session's investigation phase determine which approach is viable** before
implementing, and — per the lesson in §4.4 — verify with an actual click in a real browser, not just
attribute/code inspection or a passing test suite.

---

## 9. Open Items Carried Forward

| Item | Status |
|---|---|
| **Delete button hidden (not just deny-on-click) when role lacks permission** | **New — priority for next session, see §8** |
| Row-action menus / dynamic edit routes beyond Delete (`/:id/edit`, order-detail flows) still visible, deny-on-click only | Not fixed — needs a per-page pass |
| Return/Claim/Exchange/Order-Edit operational scope for Customer Support | Not fixed — v5/v6 silent, needs Sir Jeff decision |
| Upstream bug report for React Query key collision | Drafted, not filed — file manually via GitHub web UI |
| Leftover 0-policy "Test Role" in DB | Not cleaned up |
| Dead `/admin/rbac/me/permissions` custom route | Not removed |
| `seed-rbac.ts` / `seed-rbac-on-startup.ts` duplicate ROLE_DEFINITIONS | Known tech debt, not addressed |
| Refund, capture, credit_line, translation write flows (Store Owner) | Never exercised — no test data |
| Invite-accept default-role behavior (no role specified → should default to Read-Only) | Not tested — `roleless.test` account still not created |
| Testing order | **Order & Fulfillment Staff next** (§7), then Developer/Platform Support, then Read-Only/Auditor |
| `fulfillment.test@high6.dev` account creation | Not yet created — role: Order & Fulfillment Staff |

---

## 10. Test Accounts

All test accounts use password `TestPass123!`.

| Email | Role | Status |
|---|---|---|
| owner.test@high6.dev | Store Owner | ✅ Complete |
| support.test@high6.dev | Customer Support | ✅ Complete — see §2–§5 |
| fulfillment.test@high6.dev | Order & Fulfillment Staff | ⏳ Not created — **up next** |
| auditor.test@high6.dev | Read-Only / Auditor | ⏳ Not created |
| dev.test@high6.dev | Developer / Platform Support | ⏳ Not created |
| roleless.test@high6.dev | *(unassigned — tests default-role behavior)* | ⏳ Not created |

---

## 11. Files Changed This Session

- `rbac-guard.ts` — `SUB_RESOURCE_MAP` for dynamic sub-resource routes (§3.1)
- `seed-rbac.ts`, `seed-rbac-on-startup.ts` — `refund:create`, `return_reason:read`, `refund_reason:read` added to Customer Support (§3.1, §5)
- `apps/backend/src/admin/lib/nav-permissions.ts` — `SETTINGS_PAGE_PERMISSIONS` + `computeSettingsLandingPage()` (§4.1)
- `apps/backend/src/admin/widgets/rbac-sidebar-filter.tsx` — `interceptSettingsClick()` replacing the non-functional `rewriteSettingsLink()`; `hideEmptySections()` restored after regression (§4.2–4.3)
- `apps/backend/src/admin/lib/__tests__/nav-permissions.unit.spec.ts` — updated Customer Support fixture (9→11 policies), landing-page + visibility tests
- `apps/backend/src/admin/widgets/__tests__/rbac-sidebar-filter.unit.spec.ts` — new module-load smoke test (§6.2)
- `apps/backend/jest.config.js` — `tsx` support added
- `package.json` — `patch-package` devDependency + `postinstall` script
- `patches/@medusajs+dashboard+2.17.2.patch` — new, persists v7 §3 fix