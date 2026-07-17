# High6 Medusa Commerce — Template

This is a **template repository** for Medusa 2.x omnichannel commerce platforms. It is not a
single deployed project. Client projects (Cosmos Bazar, future clients) fork from this repo and
pull updates via tagged releases.

## Quick Start for New Clients

1. **Fork** this repo (do not clone and push to a new remote — a real fork preserves the
   upstream relationship)
2. **Clone** your fork, `npm install`, configure `.env`
3. **Record** the template tag you started from in `TEMPLATE_VERSION`:
   ```
   v1.0.0
   ```
4. `npm run dev` from `apps/backend` — confirm the boot log shows all 8 roles seeded with
   `(+0/-0)` link diffs

## Pulling Template Updates

See **[TEMPLATE_SYNC.md](TEMPLATE_SYNC.md)** for the full procedure. Summary:

```bash
git fetch template
git merge v1.1.0   # always a tag, never main
# Verify: npm run test && boot health signature
```

Client-owned files are protected by `.gitattributes` (`merge=ours`) and will never be overwritten
by a template pull. See **[TEMPLATE_BOUNDARY.md](TEMPLATE_BOUNDARY.md)** for the full core vs.
client file ownership list.

## What's Included

- **RBAC:** 8 roles (5 verified, 3 benched — see below), deny-by-default enforcement middleware,
  sidebar + delete-action hiding, invite/last-role/assignable guards
- **Tenant isolation:** Product, Sales Channel, Stock Location, Promotion, Campaign, Price List,
  Return Reason + Cart/Order guards, admin list filters
- **Marketplace orders:** Idempotency-safe order creation from external platforms (Shopee, Lazada),
  createOrderWorkflow direct path, admin widget for metadata visibility
- **Role Capability Guide:** Collapsible reference panel on Settings → Users showing what each
  role can do

## Known-Incomplete State at v1.0.0

**Do not assume these are fixed — check the latest handoff document for current status.**

| Item                                                                                     | Reference                                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 3 roles benched (Operations Manager, Catalog/Product Manager, Marketing)                 | Drop `metadata.assignable: false` + re-seed after browser verification |
| Policy churn bug (#76) — `syncRegisteredPolicies` soft-deletes 19 custom keys every boot | [v12 handoff](docs/medusa-omnichannel-handoff-v12.md)                  |
| Guard AND-vs-ANY POST semantics (#78)                                                    | [v12 handoff](docs/medusa-omnichannel-handoff-v12.md)                  |
| Core `hasPermission()` fail-open on empty role list (#82)                                | Fixed in our guard layer; core still fail-open                         |
| API-key screens have no client-side delete gating                                        | Other-roles scope                                                      |
| `notification:read` gap                                                                  | Flagged for Sir Jeff                                                   |
| Return/Claim/Exchange/Order-Edit Customer Support scope                                  | Flagged for Sir Jeff                                                   |

## Architecture

```
src/
  modules/rbac-seed/        onApplicationStart lifecycle hook
  api/middleware-utils/     rbac-guard, no-roleless-guard
  admin/
    widgets/                sidebar-filter, role-capability-guide, user roles
    lib/                    nav-permissions, SDK client
  utils/
    seed-rbac-core.ts       mechanism (template-owned)
    seed-rbac-roles.ts      role definitions (client-owned)
    seed-rbac.ts            entrypoint
  subscribers/              invite-accept backstop, seed fallback
  workflows/marketplace/    external order creation
```

## Version History

| Tag    | Date       | Key Changes                                                                                |
| ------ | ---------- | ------------------------------------------------------------------------------------------ |
| v1.0.0 | 2026-07-17 | Mechanism/data split, triplication collapsed, lifecycle hook, .gitattributes, boundary doc |
