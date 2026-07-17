# Medusa Omnichannel — Handoff v12

**Session date:** 2026-07-17
**Carried forward from:** v11 (Step 5/Delete-hiding + roleless.test up next)

---

## 1. Session Summary

Planned job was Step 5 (delete-hiding check, Developer/Platform Support) + a new invite-button
guard. Mid-session, product decision: **a user may never exist without a role, period** — this
reverses v9 §7's roleless-invite-defaults-to-Read-Only intent and became the session's real
center of gravity. What shipped:

- ✅ Step 1 (renumbered from v11's Step 5) — delete-hiding check, Dev/Platform Support: **PASS**.
- ✅ Decision #81 — roleless state disallowed by design, supersedes v9 §7.
- 🔴 → ✅ **Fail-open discovery (#82, HIGH)** — `hasPermission()` returns `true` for an actor with
  zero roles. Fixed via fail-closed check in `rbac-guard.ts`, ahead of the `hasPermission()` call.
- ✅ Server-side no-roleless enforcement — invite guard, last-role removal guard (user-centric +
  role-centric, single + bulk), all curl-verified.
- ✅ Client-side UX guards — invite button disabled with no role, role-removal disabled on last
  role (cheap predicate, no extra API calls).
- ✅ Scope expansion (came from Josh's own site testing, not planned): Super Admin sidebar bug
  fixed, error messages sanitized for end users, role capability descriptions + UI guide added,
  3 untested roles benched pending verification.
- 📌 **Testing order going forward:** ~~Dev/Platform Support~~ ✅ → benched-role verification
  (Operations Manager, Catalog/Product Manager, Marketing) → re-enable each as verified.

---

## 2. Step 1 — Delete-Hiding Check, Developer/Platform Support: PASS (Engram #83)

Verification was runtime throughout, not code-review:
- Live permission snapshot via `/admin/me/permissions` as `dev.test` — 41 policies, matched seed
  exactly.
- 10/10 fake-ID DELETE probes: granted resources (`api-keys`, `sales-channels`, `rbac/roles`,
  `rbac/policies`) passed the permission chain; ungranted resources correctly blocked.
- 3 full throwaway create→delete cycles (API key, sales channel, RBAC role) — delete confirmed
  functional, not just permitted on paper. All cleaned up.
- `computeResourcesWithoutDelete()` executed live against real permissions data: delete hidden on
  all 18 non-granted paths, visible only on `/settings/sales-channels`. Roles screen gated
  natively by core (`hasPermission("rbac_role:delete")`).
- 32/32 admin unit tests pass.

**Flagged, not fixed:** API-key management screens (`/settings/publishable-api-keys`,
`/settings/secret-api-keys`) have **zero client-side delete gating** — not in
`DELETE_RESOURCE_MAP`'s 19 entries. Correct outcome for `dev.test` (has the permission), but any
future role without `api_key:delete` would see a delete action that only fails server-side. Scoped
to whichever role gets tested next.

---

## 3. Decision #81 — No User May Exist Without a Role

**Rationale:** RBAC roles govern staff/admin access only — storefront customers are a separate
Medusa module and were never covered, so "roleless" was never protecting a real use case. It was
an accidental gap state, inconsistent with the deny-by-default model already used everywhere else
in this system.

**Supersedes v9 §7** (roleless-invite → auto-default-to-Read-Only). Logged as Engram #81 with
explicit traceability so this isn't rediscovered as if it were new. Closed by #84 once all
enforcement points were confirmed.

`roleless.test@high6.dev` deleted directly by Josh, not recreated. The test account plan from v11
§10/§14 that depended on it is retired.

---

## 4. 🔴 Fail-Open Discovery (Engram #82, HIGH): RESOLVED

**Root cause:** `hasPermission()` in Medusa core returns `true` when `!roleIds?.length` — a
roleless actor was silently granted **full access**, the opposite of deny-by-default.

**Fix:** `rbac-guard.ts` now checks actor role-count and returns 403 with an explicit message
*before* `hasPermission()` is ever invoked. This is defense-in-depth, distinct from the
invite/removal guards below — those prevent roleless states from being *created*; this prevents a
roleless actor (however it arose) from being able to *act*.

**Note for future sessions:** this is core-framework behavior, contained at the guard layer, not
fixed at the source. If Medusa's own `hasPermission()` semantics matter for another consumer of
that function, this gap still exists upstream. Candidate for an upstream issue/PR if bandwidth
allows — not urgent, currently fully contained.

**Runtime verification limit (expected, not a gap):** once the invite/removal guards are in place,
a fully roleless actor becomes unreachable through normal flows, so the fail-closed path can't be
curl-verified end-to-end by design. Covered by 2 dedicated unit tests instead.

---

## 5. Server-Side No-Roleless Enforcement: RESOLVED

`no-roleless-guard.ts` (new) — three enforcement points, all curl-verified:

| Guard | Endpoint(s) | Verified |
|---|---|---|
| Invite roles-required | `POST /admin/invites` | 400 without roles; 200 with 1 role |
| Last-role removal (user-centric) | `DELETE /admin/users/:id/roles[/:role_id]`, single + bulk | 400 on sole role; 200 after assigning 2nd role then removing 1st |
| Last-role removal (role-centric) | `DELETE /admin/rbac/roles/:id/users` (what the Settings → Roles UI actually calls) | 400 on sole role, same message |

Registered in `middlewares.ts`. 14 new unit tests (`no-roleless-guard.unit.spec.ts`), 2 new
fail-closed tests in `rbac-guard.unit.spec.ts`. `assign-default-role-on-invite-accept.ts` kept as
a backstop (comment + log updated, cites #81) — rarely fires now that the guards prevent the state
upstream, but costs nothing to leave as a legacy/edge-path safety net.

---

## 6. Client-Side UX Guards: RESOLVED

- **Invite button:** disabled when `showRbacRolesField && !form.watch("roles")?.length`, re-enables
  on selection. Patched into `user-invite-*.mjs`.
- **Role-removal button:** disabled when removing would leave a user with zero roles. Row data
  already carries `users.length` / `role.users_link?.length`, so this was a cheap predicate — no
  extra API calls needed. Patched into `role-detail-*.mjs`, 2 locations.
- Both are explicitly UX-only reinforcement — server guards (§5) are the actual enforcement.
  Combined dashboard patch now carries 5 diffs total (see §11).

---

## 7. Scope Expansion (from Josh's own site testing)

Three additional items surfaced once Josh started clicking through the built features himself —
not originally planned, but folded into this session rather than deferred.

### 7.1 Error messages sanitized
Raw guard strings (e.g. `Access denied: missing permission stock_location:create,update`) were
reaching the UI verbatim — internal detail, not end-user-appropriate. Fixed at all 3 `rbac-guard.ts`
throw sites: sanitized user-facing copy in the UI, raw permission detail preserved in
`logger.warn()` for debugging. Confirm all 3 sites use consistent wording (per outstanding
confirmation ask).

### 7.2 🔴 Super Admin sidebar bug: RESOLVED
Super Admin (`*:*` wildcard) could reach any page directly but the sidebar rendered empty — the
sidebar-filtering logic wasn't recognizing the wildcard as "show everything," falling through to
"show nothing" instead. Fixed in `nav-permissions.ts` (4 functions) + a dashboard chunk patch
(`chunk-HFX2KPQD`). Browser-confirmed for `medusa.test@high6.com`. 4 new unit tests. This was
treated as high priority — Super Admin is the account actually used to administer the system, so
a broken sidebar there is a bigger practical problem than any role-specific gap found so far.

### 7.3 Role capability descriptions + UI guide
All 8 role descriptions in `seed-rbac.ts` rewritten as plain-language capability summaries (synced
to all 3 seed copies). Surfaced via:
- Role detail page (core dashboard already renders the `description` field — no patch needed).
- New **Role Capability Guide** widget — collapsible panel on Settings → Users
  (`role-capability-guide.tsx`, `user.list.before` zone), built as a plain widget with no dashboard
  patch required.
- Invite-form tooltip on hover, decided against a full `Combobox` subtitle patch (adds patch
  surface for a cosmetic gain the tooltip already covers — decision explicitly made to avoid
  growing the patch stack further).

**Fix confirmed:** Read-Only/Auditor's description originally carried the stale "default role on
unspecified invite" line from pre-#81 behavior. Corrected to: *"Read-only access across all
commerce resources and settings. Can view orders, products, inventory, customers, pricing, and
promotions. No write, create, or delete access on any resource. Assigned manually like every other
role — invites now require an explicit role per #81."* Verified identical across all 3 seed copies
(0 diff lines). All 8 role descriptions are now accurate as of session close.

### 7.4 Benched roles
Operations Manager, Catalog/Product Manager, and Marketing marked `metadata: { assignable: false }`
— none have been through a full browser-verification pass like the other 5 roles. Enforced at two
layers:
- **Response filter:** new `GET /admin/rbac/roles/assignable` route excludes benched roles from
  both the Invite dropdown and Settings → Team assignment.
- **Assignment guard:** direct API assignment of a benched role ID is also blocked — filtering
  isn't just cosmetic on the dropdown.

Both layers curl-verified. Role/policy definitions themselves are untouched — re-enabling later is
a metadata flip + re-seed, not a rebuild.

---

## 8. Verification Evidence (Summary)

| Check | Method | Result |
|---|---|---|
| Step 1 delete-hiding | 10/10 fake-ID probes, 3 create/delete cycles, live gating-function execution | ✅ PASS |
| Invite guard | curl `POST /admin/invites` with/without roles | 400 / 200 as expected |
| Last-role guard (user + role-centric) | curl, single + bulk + multi-role sequence | 400 on last role, 200 after replacement |
| Fail-closed roleless actor | 2 unit tests (runtime path unreachable by design) | ✅ pass |
| Super Admin sidebar | Browser, `medusa.test@high6.com` | ✅ Confirmed full nav renders |
| Assignable filtering | curl on both dropdown-filter route and direct assignment | ✅ both layers block benched roles |
| Store Owner regression | `/me/permissions` | `*:*` wildcard intact, 1 policy |
| Unit tests | middleware-utils 28/28, admin lib 34/34, admin widgets 2/2 | **64/64 total** |

---

## 9. Open Items Carried Forward

| Item | Severity | Status |
|---|---|---|
| Policy churn (19 soft-deleted policies every boot) | HIGH | Known (#76), not in scope this session |
| Guard AND-vs-ANY POST semantics | HIGH | Known (#78), not in scope this session |
| `hasPermission()` fail-open on empty roles | HIGH | Our guard fail-closed (#82); core framework itself still fail-open — candidate for upstream fix, not urgent |
| API-key screens: zero client-side delete gating | — | Flagged (Step 1, #83), scoped to next role tested without `api_key:delete` |
| Benched roles (Ops Mgr, Catalog/Product Mgr, Marketing) | — | Need browser verification pass each, then drop `metadata.assignable: false` + re-seed |
| `notification:read` gap (CS + Dev) | — | Flagged for Sir Jeff, not decided unilaterally |
| Return/Claim/Exchange/Order-Edit CS scope | — | Flagged for Sir Jeff, not decided unilaterally (carried since v9) |
| `seed-rbac.ts` triplication (3 copies) | — | Known tech debt, unchanged this session |
| `debug.test@high6.dev` uncorrected Super Admin | Low | Still flagged, untouched (carried since v11) |
| Stray "Test Role" entry in roles table | Low | Still flagged, untouched (carried since v11) |
| `/admin/store` + `/admin/store/locales` 400 for all roles | Medium | Still unresolved, separate investigation (carried since v10) |
| #70 handoff staleness | — | Resolved as "no action needed" — correction already existed prior to session; v11's pointer was stale |

---

## 10. Test Accounts

All test accounts use password `TestPass123!`.

| Email | Role | Status |
|---|---|---|
| owner.test@high6.dev | Store Owner | ✅ Complete, reverified clean (v12) |
| support.test@high6.dev | Customer Support | ✅ Complete |
| fulfillment.test@high6.dev | Order & Fulfillment Staff | ✅ Complete |
| auditor.test@high6.dev | Read-Only / Auditor | ✅ Complete |
| dev.test@high6.dev | Developer / Platform Support | ✅ Complete (Step 1, v12) |
| debug.test@high6.dev | *(uncorrected Super Admin)* | ⚠️ Exists, flagged, not fixed |
| ~~roleless.test@high6.dev~~ | *(retired concept — no longer valid state)* | ❌ Deleted, will not be recreated |
| *(none yet)* | Operations Manager | ⏳ Needed for benched-role verification |
| *(none yet)* | Catalog / Product Manager | ⏳ Needed for benched-role verification |
| *(none yet)* | Marketing | ⏳ Needed for benched-role verification |

---

## 11. Files Changed This Session

- `apps/backend/src/api/middleware-utils/no-roleless-guard.ts` — new: invite guard, last-role
  guard (user + role-centric), benched-assignment guard, assignable-filter guard
- `apps/backend/src/api/middleware-utils/no-roleless-guard.unit.spec.ts` — new, 14 tests
- `apps/backend/src/api/middleware-utils/rbac-guard.ts` — fail-closed for roleless actor (#82);
  3 error messages sanitized for end users, raw detail kept in `logger.warn()`
- `apps/backend/src/api/middleware-utils/rbac-guard.unit.spec.ts` — 2 fail-closed tests, message
  assertions updated
- `apps/backend/src/api/middlewares.ts` — 10 new route matchers registered
- `apps/backend/src/subscribers/assign-default-role-on-invite-accept.ts` — comment + log updated:
  backstop only, cites #81
- `apps/backend/src/utils/seed-rbac.ts` — 8 role descriptions rewritten as plain-language
  summaries; `metadata.assignable: false` on 3 benched roles; `createRbacRoles` now writes metadata
- `apps/backend/src/subscribers/seed-rbac-on-startup.ts` — synced from `utils/seed-rbac.ts`
- `apps/backend/src/migration-scripts/seed-rbac.ts` — synced from `utils/seed-rbac.ts`
- `apps/backend/src/admin/lib/nav-permissions.ts` — `*:*` wildcard handling in 4 functions
  (Super Admin sidebar fix)
- `apps/backend/src/admin/lib/nav-permissions.unit.spec.ts` — 4 wildcard tests
- `apps/backend/src/admin/widgets/role-capability-guide.tsx` — new: collapsible role reference,
  Settings → Users (`user.list.before` zone)
- `patches/@medusajs+dashboard+2.17.2.patch` — now 5 diffs / 102 lines: `ProtectedRoute` + shipping
  (earlier sessions) + invite-button disable + role-removal disable + Super Admin wildcard chunk
  patch (all v12)

**Policy/role-count summary:** no policy-count changes this session — this was an enforcement and
UX session, not a permission-scope session. Store Owner unchanged at `*:*` / 1 policy entry.

---

## 12. Standing Process Additions (append to v11 §12)

6. **A user may never exist without a role.** Enforced server-side at invite, single-removal,
   bulk-removal, and role-centric-removal — not just client-side. Any new user-creation or
   role-mutation path added in future work must go through (or be checked against) the guards in
   `no-roleless-guard.ts`, not assumed safe by default.
7. **Client-side disable/hide is UX reinforcement only, never the actual enforcement.** Every
   guard added this session was verified server-side (curl) before the matching UI patch was
   written, not after. Keep this order for any future permission-adjacent UI work.
8. **Benched roles are metadata-flagged, not deleted.** Check `metadata.assignable` before assuming
   a role in `seed-rbac.ts` is currently usable — 3 of 8 roles are intentionally non-assignable
   pending verification as of v12.

---

## 13. Template Reuse Strategy — Planning for Cosmos Bazar (not yet implemented)

Discussed and decided this session, ahead of Cosmos Bazar kicking off. Nothing below is built yet
— this is the plan the next session executes against, and it is now the **top priority** for the
next session, ahead of benched-role verification (see §14).

### 13.1 Chosen approach: Option 2 — git fork + disciplined core/config boundary
Rejected a one-time copy-paste (no update path) and a full internal-package extraction (right-sized
for many long-term consumers, over-engineered for one upcoming client with no data yet on what
actually needs to diverge). Cosmos Bazar forks `high6-medusa-commerce` via git remote + merge, not
`git subtree` — the file boundary here means client and template code share files, not clean
separate directories, so plain fork+merge fits better than subtree.

### 13.2 Core vs. config file boundary (must be drawn before Cosmos Bazar starts)

| Core (template-owned, never client-edited) | Config/override (expected to diverge per client) |
|---|---|
| `no-roleless-guard.ts`, `rbac-guard.ts`, guard logic | `seed-rbac-roles.ts` — the actual role definitions (new split, see 13.3) |
| `nav-permissions.ts` sidebar logic | Branding, theme, sales-channel setup |
| `patches/@medusajs+dashboard+*.patch` | Client-specific widgets, custom admin routes |
| Core middleware registration pattern | `.env` / store config |
| `role-capability-guide.tsx` widget shell | Role descriptions shown in the guide |

### 13.3 Split `seed-rbac.ts` into mechanism vs. data
Currently one file mixes the seed *mechanism* (allCrud() helper, metadata handling, startup logic)
with the *data* (the 8 role definitions). These must never live in the same file, or every
client-side role edit becomes a merge conflict against the template.

Target structure:
```
apps/backend/src/utils/
  seed-rbac-core.ts    ← template-owned: mechanism, guard wiring, metadata handling
  seed-rbac-roles.ts   ← client-owned: role array — the current 8 become the DEFAULT, not fixed
  seed-rbac.ts          ← template-owned: imports core + roles, runs the seed
```
The current 8 roles are explicitly **defaults, not a fixed set** — a starting point every new
project gets, documented as freely addable/removable/editable. This split should also fold in the
existing triplication fix (#76-adjacent tech debt) — collapsing the 3 seed copies into 1 core
module now means there's only one file to protect from client edits, not three.

### 13.4 Enforcing the boundary structurally, not just by documentation
A README rule alone is honesty-based and will erode under deadline pressure. Two structural
backstops:
- **`.gitattributes` merge strategy** — `merge=ours` on client-owned paths (`seed-rbac-roles.ts`,
  `.env`, branding/theme files) so a template pull never overwrites local client changes there;
  no conflict prompt, no risk of accepting the wrong side.
- **A diff-path check** (CI or pre-commit) that flags/fails if a commit touches a core-owned path
  from within a client repo, or touches a client-owned path from within a template PR.

### 13.5 Versioning the template
No current concept of "what template version is a client project on" — this is the actual answer
to "pull without destruction."
- Tag releases on `high6-medusa-commerce` (`v1.0.0`, `v1.1.0`...) at known-stable points —
  realistically right after a session like this one closes clean.
- Client projects record which tag they last pulled (`TEMPLATE_VERSION` file or README note).
- Pulls target a tag (`git merge <template-tag>`), never a moving branch — pulling `main` risks
  merging half-finished work.
- Lightweight CHANGELOG per tag: what changed, and explicitly whether it's core-only or requires
  action in a client's role file (e.g. "v1.1.0 adds new `credit_line` policy keys — usable in role
  files, no action required unless adopted").

### 13.6 Post-merge verification gate
After any template pull, run the full unit suite + boot-log health check before trusting the
merge — same "builds cleanly is not evidence" standard used all session, applied to syncs
specifically. Catches merges that succeed on git's terms but break semantically (e.g. a client role
file referencing a policy key core no longer seeds).

### 13.7 README rewrite (bundled with the above, not separate)
Current README was written for a single-project template, not a multi-project source. Needs:
what this repo is now and who consumes it; the core/config boundary table (13.2); exact pull
commands (fork+merge, tag-targeted); known-incomplete state at time of fork (benched roles,
#76/#78, patch stack size); seed profile guidance if one exists. Treat README as the front door,
linking out to fuller docs (handoff files) rather than duplicating them inline. Companion
`TEMPLATE_SYNC.md` covers the mechanics in more depth than the README should carry.

---

## 14. Next Session Starting Point

**First — template reuse groundwork (§13), before any further RBAC feature work:**
1. Split `seed-rbac.ts` into `seed-rbac-core.ts` + `seed-rbac-roles.ts` (§13.3), collapsing the
   existing 3-copy triplication into this new structure in the same pass.
2. Draw and commit the core/config boundary (§13.2) as an actual file, not just this doc's table.
3. Add `.gitattributes` merge strategy for client-owned paths (§13.4).
4. Tag the current state as the first template release (§13.5) once 1–3 are done and verified.
5. Rewrite the README + add `TEMPLATE_SYNC.md` (§13.7).
6. Fork Cosmos Bazar from the tagged release, confirm a trial pull/merge cycle works end-to-end
   before real client work begins on it.

**Then:** browser-verification pass for the 3 benched roles (Operations Manager, Catalog/Product
Manager, Marketing) — same rigor as Dev/Platform Support's Step 1 (live permission snapshot,
fake-ID probes, throwaway create/delete cycles where applicable, gating-function execution). Each
verified role gets `metadata.assignable: false` dropped + re-seeded, one at a time, not batched —
consistent with how every other role in this workstream has been tested individually.

**Also queued, lower priority:**
- API-key screens client-side delete gating — revisit once a role without `api_key:delete` is
  actually being tested (natural fit: whichever benched role gets verified first).
- `/admin/store` + `/admin/store/locales` 400 investigation (carried since v10, still unresolved).
- `debug.test@high6.dev` Super Admin cleanup (low priority, still just flagged).