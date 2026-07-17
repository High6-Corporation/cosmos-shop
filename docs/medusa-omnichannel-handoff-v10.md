# Medusa Omnichannel — Handoff v10

**Session date:** 2026-07-16
**Carried forward from:** v9 (Customer Support RBAC closed out, Delete-hiding flagged as new priority)

---

## 1. Session Summary

This session closed out the **Delete Action Hiding** item from v9 §8, discovered and fixed **three
separate policy-gap classes** (Store Owner, Order & Fulfillment Staff, Read-Only/Auditor), and fixed
one **non-RBAC frontend bug** that was initially mistaken for a permission gap.

**Status at end of session:**

- ✅ Store Owner — `file` permission regression fixed (`readOnly` → `allCrud`), verified end-to-end
- ✅ Order & Fulfillment Staff — created (`fulfillment.test@high6.dev`), 9 policy gaps closed across
  two rounds (product/inventory sub-resources, then fulfillment-creation sub-resources)
- ✅ Delete Action Hiding — implemented via MutationObserver (b1), verified across **all 5** O&F
  Staff locations, then extended to Read-Only/Auditor (**20** `DELETE_RESOURCE_MAP` entries)
- ✅ Read-Only/Auditor — 14 sub-resource `:read` policies added, all traced to explicit "Read only"
  columns in v5 §4.4.2 (no ambiguous cases)
- ✅ Fulfillment "No shipping methods available" dropdown bug — root-caused as a **pre-existing
  frontend bug affecting all roles**, not RBAC; patched via `patch-package`, persists across reinstall
- 🟡 **New open item:** Developer/Platform Support has never been browser-tested since the v6
  `allCrud` fix — flagged high severity, not yet scheduled
- 🟡 **New open item:** `/admin/store` and `/admin/store/locales` return 400 for **all** roles,
  confirmed not RBAC-related — needs its own investigation, out of scope for this workstream
- ⏳ Remaining test accounts: `dev.test`, `roleless.test` — still not created
- 📌 Testing order (v9 §7, reconfirmed): ~~Order & Fulfillment Staff~~ ✅ → ~~Read-Only/Auditor~~ ✅
  → **Developer/Platform Support next** → roleless (invite-accept default-role test)

---

## 2. Store Owner — File Permission Regression: RESOLVED

**Found during:** Step 3 Delete-hiding browser verification (product image upload failed).

**Root cause:** `seed-rbac.ts` had Store Owner scoped to `readOnly("file")`. Should be full access —
Store Owner is meant to have unrestricted commerce access, and file upload is a basic product-
management action.

**Fix:** `readOnly("file")` → `allCrud("file")`, applied to all three seed-rbac copies.

**Verified:** Product image upload completed end-to-end as `owner.test`, browser-confirmed, not just
API-level.

---

## 3. Order & Fulfillment Staff — Policy Gaps: RESOLVED (two rounds)

### 3.1 Test account

`fulfillment.test@high6.dev`, password `TestPass123!`. Created via `pnpm medusa user`, role assigned
manually through Settings → Team/Users (CLI does not set RBAC roles — same process as `support.test`
in v9). **Not** added to `BOOTSTRAP_USER_ROLES` — that constant is deliberately scoped to two
accounts only (`medusa.test@high6.com`, `owner.test@high6.dev`); this was caught and reverted mid-
session after an initial mistaken addition.

### 3.2 Original 8 policies (baseline, confirmed correct per v5 §4.4.2)

`order:read/create/update`, `product:read`, `inventory_item:read`, `customer:read`,
`fulfillment:read`, `return:read`. Note: `order:delete` is intentionally absent — Medusa has no
order DELETE endpoint; cancellation goes through `order:update` via `POST /admin/orders/:id/cancel`.

### 3.3 Round 1 — sub-resource gaps (product/inventory/customer detail pages)

| Policy                  | Resource         | Breaks without it                          |
| ----------------------- | ---------------- | ------------------------------------------ |
| `product_variant:read`  | `product`        | Product detail variant list 403s           |
| `reservation_item:read` | `inventory_item` | Inventory detail page fully blocked        |
| `customer_group:read`   | `customer`       | Customer detail page blocked on group load |

**Source confirmation:** v5 §4.4.2 scopes O&F Staff to "Products/Inventory: Read only" and
"Customers: Read only" — these are sub-resources of already-granted parents, not scope expansion.
Same class as pre-existing Store Owner `// gap:` fixes.

### 3.4 Round 2 — fulfillment-creation gaps

Found when `fulfillment.test` could not create a fulfillment at all (Location/Shipping Method
dropdowns empty, submission blocked).

| Change                   | Resource:Op                 | Reason                                           |
| ------------------------ | --------------------------- | ------------------------------------------------ |
| `readOnly` → `readWrite` | `fulfillment`               | Actually submitting fulfillments needs `:create` |
| New (gap)                | `stock_location:read`       | Location dropdown                                |
| New (gap)                | `shipping_option:read`      | Shipping Method dropdown                         |
| New (gap)                | `fulfillment_set:read`      | Service zones in fulfillment config              |
| New (gap)                | `fulfillment_provider:read` | Provider list                                    |

**Source confirmation:** v5 §4.4.2 folds fulfillment under "Orders: Read + write"; role description
is "Processes orders and fulfillments" — these four reads are prerequisites for that description to
be true at all, not an expansion.

**Final O&F Staff policy count: 8 → 17.**

**Verified:** Full fulfillment creation completed end-to-end in browser (location selected, provider
selected, submitted successfully, order reflects the fulfillment) — after the shipping-method
frontend bug (§5) was also fixed, since it was initially blocking submission entirely.

---

## 4. Delete Action Hiding (v9 §8): RESOLVED for O&F Staff and Auditor

### 4.1 Approach decision

Two approaches were investigated (v9 §8):

- **(a)** data-attribute/aria-label selector — **ruled out**: Medusa's `ActionMenu` items are
  `<button>` elements with no `data-*` or `aria-label` attributes to hook into.
- **(b1)** MutationObserver targeting rendered button content (label text + icon match) — chosen.
- **(b2)** `patch-package` + `usePermissions()` directly in dashboard source (same pattern already
  used for Customer delete gating) — held in reserve as an escalation path per-location, not used
  this session.

**Why b1:** consistent with the existing `rbac-sidebar-filter.tsx` MutationObserver pattern, keeps
all changes in project code (no vendor patching), and the escalation path to b2 is well-defined if
b1 ever proves unreliable for a specific location.

### 4.2 Implementation

- `nav-permissions.ts` — `DELETE_RESOURCE_MAP` (started at 2 entries pre-session, ended at **20**)
  - `computeResourcesWithoutDelete()`
- `rbac-sidebar-filter.tsx` — `isDeleteAction()`, `isDeleteCommand()`, `hideDeleteActions()`,
  rAF-deferred MutationObserver (needed for portal-rendered CommandBar timing)
- Matches on **label text AND icon presence together** (not label text alone) to reduce false
  positives against future label variants.
- Fixed a path bug during Auditor rollout: `/pricing` → `/price-lists` — resource names in
  `DELETE_RESOURCE_MAP` don't always match the obvious route segment. **Note for future entries.**

### 4.3 O&F Staff — 5/5 locations verified (real browser clicks)

| #   | Location              | Status                                                         |
| --- | --------------------- | -------------------------------------------------------------- |
| 1   | Product list row      | ✅                                                             |
| 2   | Product detail header | ✅                                                             |
| 3   | Variant row           | ✅                                                             |
| 4   | Media CommandBar      | ✅ (functional; icon still visible — see §7)                   |
| 5   | Inventory list row    | ✅ (was blocked by `reservation_item:read` gap, now unblocked) |

### 4.4 Read-Only/Auditor — Delete hiding

20 `DELETE_RESOURCE_MAP` entries now cover all pages this role can reach. Confirmed hidden on:
price-lists, promotions, campaigns, settings pages. This is the largest surface the pattern has been
tested against — a stronger validation signal than the original 5-location O&F Staff pass, since
Auditor has zero delete permissions anywhere.

---

## 5. Fulfillment "No Shipping Methods" Dropdown Bug: RESOLVED (not RBAC)

**Initial suspicion:** missing `shipping_option:read` policy (reasonable, given the pattern of every
other bug this session).

**Investigation found:**

- Reproduced identically on `owner.test` (Super Admin) — decoupled from RBAC entirely.
- API returned `200` with 2 valid shipping options (Standard + Express).
- `shipping_option_id` is `.nullish()` in the validator — not even a required field server-side.
- Despite that, the frontend **blocked the Create Fulfillment button** on an empty Shipping Method
  selection — a genuine frontend bug, not a permission issue, and blocking for every role.

**Fix:** Patched `order-create-fulfillment-form.tsx` in `node_modules/@medusajs/dashboard` to render
a "No shipping methods available" placeholder instead of leaving the dropdown silently empty and the
submit button disabled.

**Persistence:** Merged into the existing `patches/@medusajs+dashboard+2.17.2.patch` via
`npx patch-package @medusajs/dashboard` — survives `node_modules` deletion / reinstall, same
mechanism as the v7 §3 dashboard core fix (v9 §6.1).

**Lesson:** when a symptom looks like a permission gap, confirm it reproduces (or doesn't) on
Store Owner **before** assuming RBAC is the cause. This one nearly got treated as a 6th missing
policy before the cross-role check caught it.

---

## 6. Infrastructure

No new infrastructure items this session — `patch-package` (v9 §6.1) and the module-load smoke test
pattern (v9 §6.2) were both reused as-is, no changes needed to either mechanism.

---

## 7. Open Items Carried Forward

| Item                                                                                       | Severity | Status                                                                               |
| ------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| **Developer/Platform Support never browser-tested since v6 `allCrud` fix**                 | **High** | **Flagged — schedule next**                                                          |
| `/admin/store` + `/admin/store/locales` return 400 for all roles                           | Medium   | Confirmed not RBAC-related, needs separate investigation                             |
| Media CommandBar Delete icon still visible (functionally hidden, cosmetic only)            | Low      | Benched                                                                              |
| Row-action menus / dynamic edit routes beyond Delete (`/:id/edit`, order-detail flows)     | —        | Not fixed, needs a per-page pass (carried from v9)                                   |
| Return/Claim/Exchange/Order-Edit operational scope for Customer Support                    | —        | Not fixed — v5/v6 silent, needs Sir Jeff decision (carried from v9)                  |
| Upstream React Query key collision bug report                                              | —        | Drafted, not filed — file manually via GitHub web UI (carried from v9)               |
| `seed-rbac.ts` / `seed-rbac-on-startup.ts` / `migration-scripts/seed-rbac.ts` triplication | —        | Known tech debt, not addressed — every fix this session had to be applied 3x by hand |
| Invite-accept default-role behavior (no role → should default to Read-Only)                | —        | Not tested — `roleless.test` account still not created                               |
| `dev.test@high6.dev` account creation                                                      | —        | Not yet created — role: Developer/Platform Support                                   |

---

## 8. Test Accounts

All test accounts use password `TestPass123!`.

| Email                      | Role                                         | Status                       |
| -------------------------- | -------------------------------------------- | ---------------------------- |
| owner.test@high6.dev       | Store Owner                                  | ✅ Complete                  |
| support.test@high6.dev     | Customer Support                             | ✅ Complete (v9)             |
| fulfillment.test@high6.dev | Order & Fulfillment Staff                    | ✅ Complete — this session   |
| auditor.test@high6.dev     | Read-Only / Auditor                          | ✅ Complete — this session   |
| dev.test@high6.dev         | Developer / Platform Support                 | ⏳ Not created — **up next** |
| roleless.test@high6.dev    | _(unassigned — tests default-role behavior)_ | ⏳ Not created               |

---

## 9. Files Changed This Session

- `apps/backend/src/utils/seed-rbac.ts` — Store Owner `file`, O&F Staff +9 policies (two rounds),
  Auditor +14 policies
- `apps/backend/src/subscribers/seed-rbac-on-startup.ts` — same changes, duplicate copy
- `apps/backend/src/migration-scripts/seed-rbac.ts` — same changes, duplicate copy
- `apps/backend/src/admin/lib/nav-permissions.ts` — `DELETE_RESOURCE_MAP` 2 → 20 entries,
  `computeResourcesWithoutDelete()`
- `apps/backend/src/admin/widgets/rbac-sidebar-filter.tsx` — `isDeleteAction()`,
  `isDeleteCommand()`, `hideDeleteActions()`, rAF-deferred observer
- `apps/backend/src/admin/widgets/__tests__/rbac-sidebar-filter.unit.spec.ts` — mock for new export
- `patches/@medusajs+dashboard+2.17.2.patch` — merged: shipping-method placeholder fix
- `node_modules/@medusajs/dashboard/.../order-create-fulfillment-form.tsx` — source of the patch
  above (not directly committed — patch is the persisted artifact)

**Policy count summary:**

| Role                      | Before this session | After                            | Delta                 |
| ------------------------- | ------------------- | -------------------------------- | --------------------- |
| Store Owner               | `file:read` only    | `file:read/create/update/delete` | file upload unblocked |
| Order & Fulfillment Staff | 8                   | 17                               | +9                    |
| Read-Only/Auditor         | 17                  | 31                               | +14                   |

---

## 10. Template for Remaining Role Sessions (Developer/Platform Support, roleless)

This session established a **repeatable process** across three roles. Use this as the checklist for
Developer/Platform Support and any role after it, rather than re-deriving the approach each time.

### 10.1 Standing process

1. **Account creation** — `pnpm medusa user -e <role>.test@high6.dev -p TestPass123!`, then assign
   role manually via Settings → Team/Users. Never add to `BOOTSTRAP_USER_ROLES` (scoped to exactly
   two accounts by design — this was mistakenly attempted once this session and reverted).
   **Role assignment must be done logged in as `medusa.test@high6.com` (Super Admin)** — Medusa
   core's assignable-roles filter (2.16.0+, `get-assignable-roles` step) hides any role whose
   policies the assigner doesn't fully cover, so Store Owner cannot self-serve assignment for any
   role broader than itself (e.g. Developer/Platform Support). Applies to both Invite and
   Settings → Team role assignment.
2. **Baseline permission check** — log in, hit 2–3 pages the role's documented scope (v5 §4.4.x)
   says should work. Don't assume the seeded policy list is complete just because it matches the
   table at a glance — every role tested so far had at least one sub-resource gap.
3. **Sub-resource gap sweep** — for every parent resource the role has `:read` or `:write` on, check
   whether the detail/list pages for that resource depend on a sub-resource permission not yet
   granted (pattern: `product` → `product_variant`, `inventory_item` → `reservation_item`,
   `customer` → `customer_group`, etc.). This has been the single most common bug class across all
   three roles fixed this session and v9 (Store Owner). Assume it will recur.
4. **Source-doc citation before adding any policy** — every gap must trace to an explicit scope
   statement in v5/v6 (§4.4.x tables), not just "the pattern suggests it should be there." Where
   the docs are silent (like Customer Support's Return/Claim/Exchange ambiguity in v9 §3.3), flag
   for Sir Jeff rather than deciding unilaterally.
5. **Delete-hiding investigation** — map every Delete UI location the role's _granted_ resources
   expose (not just resources it can view — Delete only matters where the role also lacks
   `:delete`). Use the b1 MutationObserver pattern by default; escalate a specific location to b2
   only if b1 fails a real browser check for that location.
6. **Cross-role regression check** — after any seed-rbac change, re-verify Store Owner (or another
   already-passing role) is unaffected. Twice this session a fix for one role's gap could plausibly
   have touched shared code paths (the fulfillment dropdown bug looked role-specific and wasn't).
7. **Apply every seed change to all 3 copies** — `seed-rbac.ts`, `seed-rbac-on-startup.ts`,
   `migration-scripts/seed-rbac.ts`. This triplication is known tech debt (still not fixed) — until
   it is, every single policy change is a 3x edit, not a 1x edit.
8. **Verify via actual browser interaction, never tests/API-response alone** — this is the standing
   rule since v9 §4.4 and has caught real problems twice more this session (the disabled Create
   Fulfillment button, the reproduces-on-owner-too shipping bug). "200 response" and "tests passing"
   are necessary but not sufficient evidence for anything in this codebase.
9. **Close the loop in Engram + Graphify**, not just the handoff doc — see §11 below.

### 10.2 Reusable seed-policy diff template

When proposing a policy addition, structure it exactly like this (matches the format used
successfully three times this session):

```
| Change | Resource:Op | Reason |
|---|---|---|
| readOnly → readWrite  (if applicable) | resource:operation | what breaks without it |
| New (gap) | sub_resource:read | what UI/page it unblocks |
```

Followed by a one-line source-doc citation: _"v5/v6 §4.4.x scopes [Role] to '[exact column text]' —
this sub-resource is required for that column's pages to render, not a scope expansion."_

---

## 11. How to Generate the Next-Session Prompt

This section documents the prompt structure that's been used successfully across this entire
workstream (v9 §8 onward), so it can be reproduced without re-deriving it from scratch.

### 11.1 Required sections, in order

1. **CONTEXT** — one line pointing at the handoff doc/section this continues.
2. **BACKGROUND YOU MUST INTERNALIZE** — 2–4 bullet points of _hard-won lessons_, not general
   project description. Specifically: any case where a fix was reported complete and wasn't (the
   §4 three-round failure is the canonical example), and the standing verification rule (§4.4:
   browser clicks only, tests/API-status is not evidence).
3. **SKILLS TO INVoke** — always check for a Medusa Claude Code plugin first if the task touches
   dashboard internals; then Graphify (map before implementing); UI-UX Pro Max (if UI pattern
   consistency matters); Engram (log the outcome, always).
4. **Numbered STEP blocks**, each with:
   - A clear goal statement.
   - Explicit "no code changes yet" for investigation steps.
   - A **STOP HERE AND [SHOW ME / CONFIRM]** gate before implementation. Every step that produces a
     decision (which approach, which policies) gets its own gate — don't let the agent chain
     investigation directly into implementation in one turn.
5. **VERIFICATION** step, always separate from implementation, always specifying: actual browser
   account, actual pages/actions to click, and an explicit statement that "tests passing" alone
   will not be accepted as evidence.
6. **POST-IMPLEMENTATION** — always: update Engram, update the handoff doc/open-items table, flag
   (don't fix) anything adjacent discovered along the way.

### 11.2 Rules for checkpoint responses (after the agent reports back)

- If the agent proposes an approach with tradeoffs (e.g., b1 vs b2), and there's no strong existing
  preference, it's fine to default to whichever option matches existing project patterns and has a
  clearly defined escalation path — don't force a decision that isn't well-informed yet.
- Before approving any batch of policy additions, confirm the agent did a **source-doc citation
  pass** (v5/v6 §4.4.x), not just a pattern-match ("this looks like the same class of gap as last
  time"). Bigger batches (Auditor's 11-14 gaps) warrant this check more, not less.
- If something the agent classifies as a "gap" turns out to reproduce on an unrelated role (like the
  shipping-method bug reproducing on Store Owner), redirect the investigation to rule out non-RBAC
  causes before accepting more policy additions.
- Never let the agent mark something "done" on API-level (200 status, tests passing) evidence alone
  — always require the specific browser action that was clicked and what was observed.
- Attribution matters: if a bug was caught by manual testing (a screenshot, a personal browser
  click), the follow-up prompt should say so plainly rather than crediting the agent's own
  investigation for something it didn't find.

---

## 12. Engram / Graphify — Confirmed Updated This Session

Both were closed out at end of session per the §11 standing rule ("close the loop in Engram +
Graphify, not just the handoff doc"). A new session should **query these first** rather than
re-deriving context from this doc alone — this doc is the narrative summary, Engram/Graphify are the
queryable source of truth for specifics.

### 12.1 Engram — 7 entries updated

| #   | Memory key                                 | Action                                                                    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | `store-owner-file-permission-bug`          | Marked RESOLVED                                                           |
| 2   | `ofs-policy-gaps`                          | Marked RESOLVED, 8→17 delta                                               |
| 3   | `delete-action-hiding-b1`                  | Updated — Auditor-scale validation, `/pricing`→`/price-lists` path gotcha |
| 4   | `auditor-role-sub-resource-gaps`           | NEW — 14 policies, v5 §4.4.2 citation method                              |
| 5   | `fulfillment-shipping-method-frontend-bug` | NEW — FIXED, confirmed NOT RBAC                                           |
| 6   | `developer-platform-support-untested`      | NEW — 🔴 HIGH severity flag                                               |
| 7   | `store-admin-endpoints-400-not-rbac`       | NEW — known non-RBAC issue                                                |

**A new session should pull `developer-platform-support-untested` first** — that's the highest-
severity open item and the recommended starting point (§13 below).

### 12.2 Graphify — re-indexed

- **1084 nodes, 2002 edges, 83 communities** (9 specifically labeled as RBAC-related)
- Re-indexed all 4 files changed this session: 3 seed-rbac copies + `nav-permissions.ts`
- New node added for `patches/@medusajs+dashboard+2.17.2.patch` with a description linking it to
  the shipping-method fix (§5) — so it no longer reads as an opaque vendor patch in the graph
- `GRAPH_REPORT.md` regenerated — check this file directly for the current structural state instead
  of assuming this handoff doc's file list (§9) is exhaustive going forward

### 12.3 What this means for prompt generation next session

Per §11.1, the CONTEXT and BACKGROUND sections of the next prompt can now pull directly from Engram
rather than requiring a fresh read of this whole doc — e.g. the next session's opening prompt should
reference `developer-platform-support-untested` and `delete-action-hiding-b1` by key, and the agent
should be instructed to check Engram for those before starting Step 1, the same way this session
was instructed to check them at the start.

---

## 13. Next Session Starting Point

**Recommended first action:** create `dev.test@high6.dev` (Developer/Platform Support), then run the
standing process from §10.1 — baseline check, sub-resource sweep, source-doc citation, Delete-hiding
investigation, verification, close the Engram/Graphify loop. Use §11 as the prompt template.

Flag explicitly at the start of that session: this role was last touched by the v6 `allCrud` fix and
has **never been browser-tested since** — treat the baseline check as higher-priority than usual,
since regressions here would be long-lived and undetected. Pull the
`developer-platform-support-untested` Engram entry (§12.1) before starting, rather than relying on
this doc's summary alone.
