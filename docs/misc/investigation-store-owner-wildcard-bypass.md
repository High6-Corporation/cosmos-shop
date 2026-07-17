# Investigation: Store Owner `*:*` Wildcard Bypassing "Business Only" Settings Restriction

**Date:** 2026-07-15
**Status:** Investigation complete — fix plan proposed, awaiting your explicit approval before any implementation.
**Severity:** Policy-level structural incompatibility (not a bug in enforcement logic or URL mapping)

---

## 1. Summary

**Root cause:** Structural incompatibility. Medusa's `*:*` wildcard policy cannot express "everything EXCEPT these specific resources." There is no deny-policy mechanism, no exclusion syntax, and no way to carve exceptions out of a wildcard grant. Store Owner holds `*:*`, so `hasPermission()` returns `true` for every resource — including `rbac_role`, `rbac_policy`, `api_key`, and `workflow_execution`, which Section 4.4.2 explicitly scoped out of Store Owner's access.

**Fix type:** Seed-script policy change only. No middleware changes required. Drop `*:*` from Store Owner and replace it with an explicit list of ~14 business-scope `allCrud()` policies.

**The URL→resource mapping is correct** — all four restricted resource types are properly mapped in `rbac-guard.ts`. The enforcement logic is correct. The mapping is not the cause.

---

## 2. Evidence

### 2.1 Seed Script Assignment

[seed-rbac.ts:62-71](apps/backend/src/migration-scripts/seed-rbac.ts#L62-L71):

```typescript
// 1. Store Owner — all resources via *:* wildcard
{
    name: "Store Owner",
    description:
      "Full access to all commerce operations. Excludes API keys, webhooks, and RBAC policy management.",
    policies: [
      // Super admin bypass via *:* wildcard (framework built-in)
      { key: "*:*", resource: "*", operation: "*" },
    ],
},
```

The description says "Excludes API keys, webhooks, and RBAC policy management" — but the single policy assigned (`*:*`) actually grants **everything**, including those excluded resources. The exclusion exists only in prose, not in the policy model.

### 2.2 Live Database Confirmation

Query result from `rbac_role_policy` table (2026-07-15):

```
role_name    | Store Owner
role_id      | role_01KXD910YA5XTPAC2PCCX13GP2
policy_key   | *:*
resource     | *
operation    | *
```

Store Owner has **exactly one policy**. No other policies supplement or constrain the wildcard.

### 2.3 Framework Wildcard Semantics

[has-permission.js:12-23](node_modules/@medusajs/framework/dist/policies/has-permission.js#L12-L23):

```javascript
function policyAllows(rolePoliciesMap, resource, operation) {
    for (const resourceMap of rolePoliciesMap.values()) {
        const allowedOps = new Set([
            ...(resourceMap.get(resource) || []),       // specific resource match
            ...(resourceMap.get(utils_1.WILDCARD) || []), // wildcard resource "*"
        ]);
        if (allowedOps.has(operation) || allowedOps.has(utils_1.WILDCARD)) {
            return true;
        }
    }
    return false;
}
```

`WILDCARD = "*"` (confirmed at [define-policies.js:13](node_modules/@medusajs/utils/dist/modules-sdk/define-policies.js#L13)). When Store Owner has `resource="*", operation="*"`:

1. `resourceMap.get("rbac_role")` → undefined (no specific entry for `rbac_role`)
2. `resourceMap.get("*")` → `Set { "*" }` (the wildcard resource)
3. `allowedOps = Set { "*" }`
4. `allowedOps.has("read")` → false
5. `allowedOps.has("*")` → **true** ← grants access unconditionally

This means `*:*` is a true blanket grant. There is no subtractive mechanism — no "deny" policies, no exclusion syntax, no "NOT" semantics anywhere in Medusa's RBAC model.

### 2.4 Live API Confirmation

Logged in as `owner.test@high6.dev` (Store Owner role), all four restricted endpoints returned HTTP 200 with full data:

| Endpoint | Expected (per 4.4.2) | Actual | Evidence |
|---|---|---|---|
| `GET /admin/rbac/roles` | **403 Forbidden** | **200 OK** — returned full role list | `{"roles":[{...Store Owner...},{...Operations Manager...},...]}` |
| `GET /admin/rbac/policies` | **403 Forbidden** | **200 OK** — returned full policy list | `{"policies":[{...customer:read...},{...inventory_item:update...},...]}` |
| `GET /admin/api-keys` | **403 Forbidden** | **200 OK** — returned API keys including publishable keys | `{"api_keys":[{...pk_e6d***0a1...},...]}` |
| `GET /admin/workflows-executions` | **403 Forbidden** | **200 OK** — returned `{"workflow_executions":[],...}` | Empty result, but 200 (not 403) |

### 2.5 URL→Resource Mapping Coverage (NOT the cause)

The four restricted resource types ARE properly mapped in [rbac-guard.ts:34-36,45,98](apps/backend/src/api/middleware-utils/rbac-guard.ts#L34-L98):

```typescript
["rbac/roles", "rbac_role"],       // line 35
["rbac/policies", "rbac_policy"],  // line 34
["api-keys", "api_key"],           // line 45
["workflows-executions", "workflow_execution"], // line 98
```

The `resolveResource()` function correctly maps these URL prefixes to distinct resource keys. The issue is not that they fall through to an unmapped default — they're correctly mapped. The issue is that `hasPermission()` is asked to check `rbac_role:read` (a correctly resolved resource), and it returns `true` because the `*:*` wildcard matches everything.

### 2.6 Enforcement Architecture

[rbac-guard.ts](apps/backend/src/api/middleware-utils/rbac-guard.ts) is the **sole enforcement layer** for all `/admin/*` routes. Medusa's built-in `wrapWithPoliciesCheck()` / `check-permissions.js` is not used anywhere in the built-in admin route configurations (confirmed by grep — zero references in the `@medusajs/medusa` dist). The enforcement chain is:

```
HTTP Request → authenticate middleware → rbacGuard (our code) → hasPermission() (framework)
                                                                        ↓
                                                              policyAllows() — *:* match → true
```

---

## 3. Why the Wildcard Design from Section 4.4.3 Is Incompatible with 4.4.2

Section 4.4.3 chose `*:*` over a `roleName === "Store Owner"` string match as a cleaner implementation pattern — the right instinct. However, the tradeoff was not fully examined:

| Approach | Pro | Con |
|---|---|---|
| `*:*` wildcard | Clean, uses framework's own mechanism, immune to role renames | **Cannot express exclusions** — "everything" means everything, period |
| Explicit policy list | Can precisely scope to business-only resources | ~14-16 policies to define and maintain; any future resource added to Medusa's admin API (new route config) needs a conscious decision about Store Owner access |
| Role-name bypass | Trivially simple | Fragile against renames, collisions, localization |

The `*:*` approach is **structurally incompatible** with any carve-out. Medusa's RBAC model has no:
- Deny policies (no `NOT rbac_role:*`)
- Policy precedence (no "this policy overrides that one")
- Resource group exclusions (no `!rbac_role,!api_key,!workflow_execution` syntax)

The "business only" Settings scope from Section 4.4.2 therefore cannot be implemented while Store Owner holds `*:*`.

---

## 4. Proposed Fix Plan

### Approach: Replace `*:*` with explicit business-scope policies

**Files changed:** `src/migration-scripts/seed-rbac.ts` only (Store Owner policy list)

**No middleware changes required.** `rbacGuard` correctly maps URLs, resolves resources, and delegates to `hasPermission()`. It will work correctly as soon as Store Owner holds the right policies instead of `*:*`.

### Store Owner — Proposed Policy List

Based on the role table at Section 4.4.2:

| Commerce Area | Resources | Policy |
|---|---|---|
| Orders | `order` | `allCrud` |
| Products / Inventory | `product`, `product_category`, `product_collection`, `product_option`, `product_type`, `product_tag`, `product_variant`, `inventory_item` | `allCrud` each |
| Pricing / Promotions | `price_list`, `promotion` | `allCrud` each |
| Customers | `customer` | `allCrud` |
| Settings (business only) | `store`, `region`, `currency`, `tax_rate`, `shipping_option`, `shipping_profile`, `invite`, `user` | `allCrud` each |

**Explicitly NOT granted** (these are the resources that should remain Developer-only):

| Resource | Why excluded |
|---|---|
| `api_key` | Developer / Platform Support only |
| `rbac_role` | Developer / Platform Support only |
| `rbac_policy` | Developer / Platform Support only |
| `workflow_execution` | Developer / Platform Support only |
| `admin_config` | Plugins, feature flags, layouts — Developer only |
| `payment` | Payment provider config — Developer only |
| `fulfillment_provider` | Technical config — Developer only |
| `tax_provider` | Technical config — Developer only |
| `notification` | Technical config — Developer only |
| `sales_channel` | **Known v1 gap** (Section 4.4.4) — Medusa treats `sales_channel` as one resource; cannot split "channel assignment" from "channel config" at the policy level. If Store Owner needs to assign products to channels, `sales_channel` must be granted. If it's excluded, they can't assign products. |

### Seed Script Change (conceptual)

```typescript
// Store Owner — explicit business-scope policies (replaces *:* wildcard)
{
    name: "Store Owner",
    description:
      "Full access to all commerce operations. Excludes API keys, webhooks, and RBAC policy management.",
    policies: [
      // Commerce
      ...allCrud("order"),
      ...allCrud("product"),
      ...allCrud("product_category"),
      ...allCrud("product_collection"),
      ...allCrud("product_option"),
      ...allCrud("product_type"),
      ...allCrud("product_tag"),
      ...allCrud("product_variant"),
      ...allCrud("inventory_item"),
      ...allCrud("price_list"),
      ...allCrud("promotion"),
      ...allCrud("customer"),
      // Business settings
      ...allCrud("store"),
      ...allCrud("region"),
      ...allCrud("currency"),
      ...allCrud("tax_rate"),
      ...allCrud("shipping_option"),
      ...allCrud("shipping_profile"),
      ...allCrud("fulfillment_set"),
      ...allCrud("fulfillment"),
      ...allCrud("return"),
      ...allCrud("return_reason"),
      ...allCrud("invite"),
      ...allCrud("user"),
      ...allCrud("stock_location"),
      ...allCrud("sales_channel"),        // Required for product→channel assignment (v1 gap)
      ...allCrud("customer_group"),
      ...allCrud("reservation_item"),
      ...allCrud("product_collection"),
      // Read-only audit visibility
      ...readOnly("payment"),
      ...readOnly("payment_collection"),
    ],
},
```

### Known Side Effects of Dropping `*:*`

1. **Future resource gaps:** Any new resource Medusa adds to its admin API in a future release will NOT be automatically accessible to Store Owner. If a `*:*` wildcard was the only policy, the `syncRegisteredPolicies` hook on startup won't surface new resources — Store Owner will need policies explicitly added. This is a **maintenance consideration**, not a bug — it's actually the intended behavior (conscious access decisions per resource).

2. **`sales_channel` ambiguity:** The v1 gap (Section 4.4.4) means granting `sales_channel:all` gives Store Owner technical channel config access (creation, modification) as well as the intended "assign products to channels" capability. If this is unacceptable, a workflow-level check on `POST /admin/sales-channels` could block Store Owner from creating/modifying channels while allowing reads and product assignments — but that's a separate feature, not part of this fix.

3. **Resource count:** ~26 `allCrud()` entries + ~2 `readOnly()` entries = ~28 policies for Store Owner (with `allCrud` expanding to a single `resource:all` key). This is more verbose than `*:*` but is the minimum required to express "everything except these few things" in Medusa's additive-only model.

### Execution Steps (after your approval)

1. Edit `seed-rbac.ts` — replace Store Owner's `*:*` with the explicit policy list
2. Re-run `npx medusa exec src/migration-scripts/seed-rbac.ts` (idempotent — removes old `*:*` and assigns new policies)
3. Test with `owner.test@high6.dev`:
   - `GET /admin/rbac/roles` → expect **403**
   - `GET /admin/api-keys` → expect **403**
   - `GET /admin/products` → expect **200**
   - `GET /admin/orders` → expect **200**
   - `POST /admin/products` → expect **200** (write should work)
4. Dashboard walkthrough at `localhost:9000/app` to confirm nav items are correctly shown/hidden

---

## 5. Investigation Completeness Checklist

| Step | Status | Finding |
|---|---|---|
| Confirm Store Owner's policies in seed script | ✅ Done | Single `*:*` wildcard only |
| Confirm Store Owner's policies in live DB | ✅ Done | Confirmed — exactly `*:*`, no other policies |
| Trace `hasPermission()` wildcard behavior | ✅ Done | `policyAllows()` unconditionally returns true for `*:*` |
| Test actual API access with Store Owner credentials | ✅ Done | All 4 restricted endpoints return 200 (confirmed bypass) |
| Check URL→resource mapping coverage | ✅ Done | All 4 resource types are correctly mapped — not a mapping gap |
| Assess structural expressibility | ✅ Done | `*:*` cannot express exclusions — additive-only model |

---

## 6. Next Step

**Awaiting your explicit approval** to proceed with the seed-script fix (Approach: replace `*:*` with explicit business-scope policies). No other files change. No middleware changes. Post-fix verification plan is in Section 4 above.

The fix is a **seed-script-only change**, not a redesign of the enforcement layer. `rbac-guard.ts` is correctly implemented and will work as intended once Store Owner's policies match the intended scope.
