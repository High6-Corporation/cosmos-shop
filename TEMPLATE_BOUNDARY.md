# Template Boundary

This file defines which paths are owned by the template (never edit in a client fork) and
which are client-owned (expected to diverge, protected by `.gitattributes` `merge=ours`).

**Both lists were verified against the actual file tree on 2026-07-17, not assumed from any
handoff document. Any new file added to the repo must be explicitly classified here.**

---

## Core (template-owned — edits must happen in the template, then tag a release and pull)

These paths are the template's shared infrastructure. A PR against these from a client repo is
always wrong — the fix belongs upstream in `high6-medusa-commerce`.

### RBAC guard + enforcement

| Path                                                         | Why                                             |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `apps/backend/src/api/middleware-utils/rbac-guard.ts`        | Permission enforcement middleware               |
| `apps/backend/src/api/middleware-utils/no-roleless-guard.ts` | Invite/last-role/benched-role guards (#81, #82) |
| `apps/backend/src/api/middlewares.ts`                        | Middleware registration pattern                 |

### Admin sidebar + UI filtering

| Path                                                       | Why                             |
| ---------------------------------------------------------- | ------------------------------- |
| `apps/backend/src/admin/lib/nav-permissions.ts`            | Sidebar visibility computation  |
| `apps/backend/src/admin/widgets/rbac-sidebar-filter.tsx`   | Sidebar filter widget           |
| `apps/backend/src/admin/widgets/role-capability-guide.tsx` | Role capability reference panel |
| `apps/backend/src/admin/lib/client.ts`                     | Medusa SDK client               |

### Seed mechanism (but NOT role definitions)

| Path                                                                   | Why                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/backend/src/utils/seed-rbac-core.ts`                             | Helpers, types, `seedRbacData` function          |
| `apps/backend/src/utils/seed-rbac.ts`                                  | Thin entrypoint wiring core+roles                |
| `apps/backend/src/modules/rbac-seed/index.ts`                          | Module registration                              |
| `apps/backend/src/modules/rbac-seed/service.ts`                        | `onApplicationStart` lifecycle hook              |
| `apps/backend/src/subscribers/seed-rbac-on-startup.ts`                 | `UserWorkflowEvents.CREATED` fallback subscriber |
| `apps/backend/src/subscribers/assign-default-role-on-invite-accept.ts` | Defense-in-depth backstop                        |

### API routes (custom, not client-specific)

| Path                                                              | Why                                   |
| ----------------------------------------------------------------- | ------------------------------------- |
| `apps/backend/src/api/admin/me/permissions/route.ts`              | `/admin/me/permissions` endpoint      |
| `apps/backend/src/api/admin/custom/route.ts`                      | Custom admin routes                   |
| `apps/backend/src/api/store/custom/route.ts`                      | Custom store routes                   |
| `apps/backend/src/api/webhooks/marketplace/orders/middlewares.ts` | Marketplace order webhook middlewares |
| `apps/backend/src/api/webhooks/marketplace/orders/route.ts`       | Marketplace order webhook route       |

### Workflows

| Path                                                                 | Why                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/backend/src/workflows/marketplace/create-marketplace-order.ts` | Marketplace order creation                                                                              |
| `apps/backend/src/workflows/marketplace/shipping-mappings.ts`        | Shipping mapping logic                                                                                  |
| `apps/backend/src/workflows/marketplace/steps/`                      | Workflow steps (check-idempotency, create-or-get-order, normalize-order-input, reserve-order-inventory) |

### Migration scripts (not client-specific)

| Path                                                                               | Why                  |
| ---------------------------------------------------------------------------------- | -------------------- |
| `apps/backend/src/migration-scripts/create-marketplace-order-idempotency-index.ts` | Idempotency index    |
| `apps/backend/src/migration-scripts/initial-data-seed.ts`                          | Initial data seed    |
| `apps/backend/src/migration-scripts/seed-rbac.ts`                                  | Re-export from utils |

### Dashboard patches

| Path                                  | Why                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `patches/@medusajs+dashboard+*.patch` | Core dashboard patches (wildcard fix, invite-button disable, role-removal guard) |

### Config (structure is template-owned)

| Path                            | Why                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/medusa-config.ts` | Module registration, plugin config — the module list is template-owned; store-specific values like DB credentials are in `.env` |

---

## Client-Owned (protected by `.gitattributes` `merge=ours`)

Template pulls will **never** overwrite these files. Clients edit them freely.

| Path                                                            | Why                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/backend/src/utils/seed-rbac-roles.ts`                     | Role definitions — the 8 defaults are a starting point, not a fixed set |
| `apps/backend/src/admin/widgets/marketplace-order-metadata.tsx` | Client-specific marketplace UI                                          |
| `apps/backend/src/admin/widgets/user-detail-roles.tsx`          | May be customized per client                                            |
| `apps/backend/src/admin/widgets/user-list-roles.tsx`            | May be customized per client                                            |
| `apps/backend/src/admin/i18n/index.ts`                          | Translations — will diverge per client                                  |
| `apps/backend/.env`                                             | Environment variables                                                   |
| `apps/backend/.env.example`                                     | Environment template                                                    |

---

## Template version

See `TEMPLATE_VERSION` for the last-pulled tag. See `TEMPLATE_SYNC.md` for the pull procedure.
