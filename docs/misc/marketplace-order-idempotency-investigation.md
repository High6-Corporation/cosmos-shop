# Marketplace Order Idempotency — DB-Level Fix Investigation

> **Status:** Investigation complete — awaiting approval before implementation
> **Date:** 2026-07-13
> **Context:** The current `check-idempotency.ts` uses check-then-create, which has a race window between the SELECT and the INSERT. Two near-simultaneous webhook calls with the same `marketplace_order_id` could both pass the "not found" check and produce duplicate Orders.

---

## 1. Confirmed: Order `metadata` Column Type

**The `order.metadata` column is `jsonb NULL`.**

Source evidence (three independent confirmations):

### a) The DML entity definition

`node_modules/@medusajs/order/dist/models/order.js`:

```js
metadata: utils_1.model.json().nullable(),
```

### b) The DML-to-SQL type mapping

`node_modules/@medusajs/utils/dist/dml/helpers/entity-builder/define-property.js` (line 201):

```js
if (field.dataType.name === "json") {
  Property({
    columnType: "jsonb",
    type: "any",
    nullable: field.nullable,
    // ...
  })(MikroORMEntity.prototype, field.fieldName);
}
```

### c) The initial migration that creates the table

`node_modules/@medusajs/order/dist/migrations/Migration20240219102530.js` (line 46):

```sql
"metadata" jsonb NULL,
```

### ORM layer

Medusa uses **MikroORM** as its underlying ORM, accessed through Medusa's own DML (Data Model Language) abstraction. The DML `model.json()` maps to MikroORM `@Property({ columnType: "jsonb", type: "any" })`.

**Conclusion:** The metadata column is a native PostgreSQL `jsonb` column, which means PostgreSQL JSONB operators (`->`, `->>`, `@>`, etc.) work on it directly. Expression indexes on `metadata->>'key'` are fully supported.

---

## 2. Confirmed: Expression Indexes Are Compatible with Medusa's Migration System

Medusa's migration system is built on top of **MikroORM's `Migration` class**, which provides `this.addSql(sql)` for queuing arbitrary raw SQL. The migration base class imposes no restrictions on what SQL you write.

### Key API of the Migration base class

- `this.addSql(sql)` — queue raw SQL to execute (used by all core module migrations)
- `this.execute(sql)` — run a query immediately and return rows (used for conditional logic)
- `this.getKnex()` — get a Knex query builder instance
- `this.getEntityManager()` — get a MikroORM EntityManager

### Precedent for `CREATE UNIQUE INDEX ... WHERE` (partial unique indexes)

Multiple Medusa core modules use partial unique indexes with `WHERE` clauses. These are the closest precedent to what we need:

**Customer module** (`Migration20240524123112.js`):

```js
this
  .addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_email_has_account_unique"
  ON "customer" (email, has_account) WHERE deleted_at IS NULL;`);

this
  .addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_address_unique_customer_billing"
  ON "customer_address" (customer_id) WHERE "is_default_billing" = true;`);
```

**Return reason** (in Order module's initial migration):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_return_reason_value"
  ON "return_reason" USING btree (value ASC NULLS LAST)
  WHERE deleted_at IS NULL;
```

### Precedent for expression-based indexes: NONE found

I searched every migration across all 29 Medusa core modules. **Zero** modules use expression indexes (GIN, GIST, `to_tsvector`, or `(metadata->>'key')` syntax). All existing indexes are on simple columns. This is not a limitation — it simply means no Medusa developer has needed one before. The `Migration.addSql()` API accepts any valid SQL, and PostgreSQL's expression index syntax is valid SQL.

---

## 3. Confirmed: Custom/Raw SQL Migrations Are Supported

Medusa has **two distinct migration systems**, both of which support our use case:

### System A: MikroORM Module Migrations (DDL schema changes)

- Tracked in the `mikro_orm_migrations` table
- Each module's `dist/migrations/` directory is auto-discovered
- Migration files follow the pattern `Migration<YYYYMMDDHHmmss>.js`
- Custom modules can define their own `migrations/` directory — auto-discovered by Medusa's loader at `{modulePath}/migrations/`
- Several modules already mix conditional `this.execute()` with `this.addSql()` for conditional DDL

### System B: Migration Scripts (data + DDL scripts)

- Tracked in the `script_migrations` table
- Files placed in module/plugin `migration-scripts/` directories
- Scripts export a default function receiving `{ container }` with access to:
  - `pgConnection` — raw Knex connection (for arbitrary SQL like `CREATE INDEX`)
  - `logger` — structured logger
  - All registered Medusa services via `container.resolve()`
- Scripts run sequentially with a distributed lock (via the Locking Module)
- Scripts are idempotent by name — the `script_migrations` table has a unique index on `script_name`

**Core Medusa migration scripts location:**
`node_modules/@medusajs/medusa/dist/migration-scripts/`

**Project migration scripts location:**
`apps/backend/src/migration-scripts/` (auto-discovered as the app is treated as a plugin)

### Recommendation: Migration Script (System B)

For a one-off, project-level DDL change to a core table, a **migration script** is the correct mechanism because:

1. It doesn't require creating a custom module (which would be unnecessary overhead for a single index)
2. Scripts have access to `pgConnection.raw()` — can execute any SQL including `CREATE UNIQUE INDEX`
3. Scripts are naturally idempotent by name — safe to run multiple times
4. Scripts are a documented, supported extension point (Medusa itself ships 8+ migration scripts)
5. The existing `migration-scripts/initial-data-seed.ts` in this project already demonstrates the pattern

---

## 4. Confirmed: Unique-Constraint Violation Handling

### MikroORM exception class

`UniqueConstraintViolationException` from `@mikro-orm/core`, mapped from Postgres error code `23505`.

**Inheritance chain:**

```
Error → DriverException → ServerException → ConstraintViolationException → UniqueConstraintViolationException
```

**Mapping** (`PostgreSqlExceptionConverter.js` line 33):

```js
case '23505':
    return new UniqueConstraintViolationException(exception);
```

### Three detection methods (all valid)

```typescript
// Method A: instanceof (cleanest)
import { UniqueConstraintViolationException } from "@mikro-orm/core"
if (err instanceof UniqueConstraintViolationException) { ... }

// Method B: error code check (works even if the error is wrapped)
if (err.code === "23505") { ... }

// Method C: Medusa utility
import { isDuplicateError } from "@medusajs/framework/utils"
if (isDuplicateError(err)) { ... }
```

### Medusa's existing error handling layers

1. **Repository layer** (`db-error-mapper.js`): Automatically catches `UniqueConstraintViolationException` on all repository methods and converts to `MedusaError(INVALID_DATA)` — but this only applies to MikroORM-managed operations, not raw `pgConnection.raw()` calls.

2. **HTTP middleware** (`exception-formatter.js`): Catches raw `err.code === '23505'` at the HTTP layer and converts to `MedusaError(DUPLICATE_ERROR)` with HTTP 422.

### How this applies to the workflow

The race condition happens inside `createOrderWorkflow` (Medusa's built-in workflow), which internally calls the Order module's `createOrders()` method. The Order module uses MikroORM's repository layer, which has `dbErrorMapper` applied via Proxy. This means:

- **If the unique constraint violation fires during `createOrders()`**, the MikroORM repository will catch it and convert it to a `MedusaError(INVALID_DATA)`.
- **Our `create-or-get-order.ts` step** can catch this error, check if it's a duplicate, and then query for the existing order (which the concurrent webhook call just created).

The pattern would be:

```typescript
try {
  const { result: order } = await createOrderWorkflow(container).run({ input });
} catch (err) {
  if (isDuplicateError(err)) {
    // Race: another webhook created this order between our check and our create.
    // Query for the now-existing order and return it.
    const existing = await queryForExistingOrder(input);
    return new StepResponse(existing, existing.id);
  }
  throw err;
}
```

---

## 5. Null Metadata Caveat & Partial Index Need

### The issue

The `order.metadata` column is `jsonb NULL`. Orders created through normal channels (storefront checkout, draft orders, admin manual orders) have `metadata` that either:

- Contains other keys entirely (e.g., `{ "custom_field": "value" }`)
- Is SQL `NULL`

### How PostgreSQL handles NULL in unique indexes

PostgreSQL treats `NULL` values as distinct for unique constraint purposes (per SQL standard + PG documentation). So a unique index on `(metadata->>'marketplace', metadata->>'marketplace_order_id')` would:

- Allow rows where both expressions evaluate to `NULL` (non-marketplace orders) — they don't conflict with each other
- Correctly enforce uniqueness when both expressions evaluate to non-NULL values

**However**, there's a subtle edge case: if a non-marketplace order happens to have `metadata = { "marketplace": "shopee" }` (only one of the two keys), then `metadata->>'marketplace_order_id'` would be `NULL`, and the `(NULL, NULL)` for that path would allow duplicates for that case. This is acceptable since such orders aren't marketplace orders and such metadata would be coincidental.

### Recommendation: Partial index (explicit NULL exclusion)

Despite PostgreSQL's NULL handling making a plain expression index mostly safe, a **partial index** with explicit `WHERE` clause is clearer, safer, and consistent with Medusa's existing partial index patterns:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_marketplace_idempotency"
  ON "order" ((metadata->>'marketplace'), (metadata->>'marketplace_order_id'))
  WHERE metadata->>'marketplace' IS NOT NULL
    AND metadata->>'marketplace_order_id' IS NOT NULL;
```

This:

- Only indexes rows where both marketplace keys are present (true marketplace orders)
- Leaves non-marketplace orders completely out of the index (saves space, no false positives)
- Matches Medusa's existing pattern of partial unique indexes (`WHERE deleted_at IS NULL`, `WHERE is_default_billing = true`)
- Prevents the coincidental-metadata edge case described above

---

## 6. Recommended Approach: Expression-Based Partial Unique Index

### Tradeoffs vs. promoting marketplace fields to real columns

| Dimension                 | Expression Index                                                       | Real Columns                                                                      |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Invasiveness**          | Minimal — one migration script                                         | High — requires modifying the Order model (core module)                           |
| **Medusa upgrade safety** | Safe — index is on a core table column that won't change               | Unsafe — would need to maintain a fork, or risk upgrade clobbering custom columns |
| **Query performance**     | Slightly slower than real-column index (expression evaluation per row) | Optimal                                                                           |
| **Self-documenting**      | Index name documents the purpose                                       | Column names + types document the purpose                                         |
| **Schema enforcement**    | Only at the index level (no FK, no type constraint)                    | Full — can add NOT NULL, FK references, etc.                                      |
| **Implementation effort** | ~30 lines (migration script + catch logic)                             | ~100+ lines (DML model changes, migration, maintaining through upgrades)          |
| **Risk**                  | Very low — index is additive, easily dropped                           | Medium — needs ongoing upgrade maintenance                                        |

**Recommendation for this project's scale:** Expression-based partial unique index. The simplicity and upgrade-safety advantages decisively outweigh the negligible performance difference. Real columns would be warranted only if marketplace metadata needed foreign-key relationships or complex query patterns — neither of which applies here.

---

## 7. Concrete Implementation Plan

### Phase A: Migration Script

**New file:** `apps/backend/src/migration-scripts/create-marketplace-order-idempotency-index.ts`

```typescript
import { MedusaContainer } from "@medusajs/framework";

export default async function createMarketplaceOrderIdempotencyIndex({
  container,
}: {
  container: MedusaContainer;
}) {
  const pgConnection = container.resolve("pgConnection");
  const logger = container.resolve("logger");

  logger.info("Creating marketplace order idempotency index...");

  await pgConnection.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_marketplace_idempotency"
      ON "order" ((metadata->>'marketplace'), (metadata->>'marketplace_order_id'))
      WHERE metadata->>'marketplace' IS NOT NULL
        AND metadata->>'marketplace_order_id' IS NOT NULL;
  `);

  logger.info(
    "Marketplace order idempotency index created (or already exists).",
  );
}
```

This runs with `medusa db:migrate:scripts` (or `npx medusa db:migrate` in newer versions) and is idempotent due to `IF NOT EXISTS`.

### Phase B: Catch-and-Resolve in `create-or-get-order.ts`

**Modified file:** `apps/backend/src/workflows/marketplace/steps/create-or-get-order.ts`

The existing `createOrderWorkflow(container).run()` call (line 81) needs a try/catch around it:

```typescript
// Inside createOrGetOrderStep, replace the direct:
//   const { result: order } = await createOrderWorkflow(container).run({...})
// with:

import { isDuplicateError } from "@medusajs/framework/utils"

let order: Awaited<ReturnType<typeof createOrderWorkflow>["result"]>

try {
  const result = await createOrderWorkflow(container).run({
    input: input.normalized,
  })
  order = result.result
} catch (err) {
  if (isDuplicateError(err)) {
    // Lost the race — another concurrent webhook call created this
    // marketplace order between our idempotency check and this insert.
    // The unique index caught the duplicate. Find and return the
    // now-existing order.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "currency_code"],
      filters: {
        metadata: {
          marketplace: /* from input */,
          marketplace_order_id: /* from input */,
        },
      },
    })

    const existing = orders[0]
    if (!existing) {
      // Should be unreachable — the index violation means a row exists
      throw err
    }

    return new StepResponse(
      {
        id: existing.id,
        status: existing.status,
        total: existing.total,
        currency_code: existing.currency_code,
      },
      existing.id,
    )
  }
  throw err
}
```

**Important:** The catch-and-resolve needs the marketplace + marketplace_order_id values to re-query. These are available from `input.marketplace_order_id` and `input.normalized` (which contains the marketplace metadata). The exact metadata key names may need to match what the current `check-idempotency.ts` and `createOrderWorkflow` pass through.

### Phase C (Optional Optimization): Remove `checkIdempotencyStep`

Once the unique index is in place and the catch-and-resolve logic works, the `checkIdempotencyStep` becomes a pre-check optimization rather than the sole idempotency mechanism. It can be:

- **Kept** — reduces the frequency of constraint violations (most idempotent replays hit the fast path)
- **Removed** — simplifies the workflow; the index + catch handles everything

Recommendation: **keep it.** The check-then-create pattern handles 99.9% of replays without throwing an exception. The index is the safety net for the 0.1% race condition. Removing the check would turn every idempotent replay into an exception-driven flow, which is slower and noisier.

---

## 8. Risks and Unknowns

### Risks (mitigated)

- **Index on `pgConnection.raw()` bypasses MikroORM's migration tracking.** Mitigated: migration scripts are tracked in `script_migrations` table with a unique constraint on script name — the script is naturally idempotent via `IF NOT EXISTS`.
- **If metadata key names change** (e.g., `marketplace` renamed to `source`), the index silently stops protecting. Mitigated: the index is additive (doesn't block writes), and any rename would be a deliberate code change that includes updating the index.

### Unknowns (flagged, not glossed over)

- **`createOrderWorkflow` internals may catch and wrap the unique constraint violation** before it propagates to our try/catch. The workflow runs inside its own transaction context, and Medusa's `dbErrorMapper` converts `UniqueConstraintViolationException` to `MedusaError(INVALID_DATA)` at the repository layer. We need to verify that the error actually surfaces at the workflow level (it should, since `MedusaError` is not caught internally). **Verification required:** write a test that fires two concurrent webhook calls and confirm the second one hits the catch block.
- **The `isDuplicateError` utility checks `err.code === '23505'`.** `MedusaError` with type `INVALID_DATA` does NOT carry `code === '23505'` (it's wrapped). We may need to check for `MedusaError` explicitly or use `err.message` matching as a fallback. **Recommendation:** catch broadly (`err.code === '23505' || err.type === MedusaError.Types.INVALID_DATA || err.type === MedusaError.Types.DUPLICATE_ERROR`) for robustness.
- **Concurrent transactions and visibility:** If the first webhook's transaction hasn't committed when the second one's `createOrderWorkflow` runs, the unique index won't see the first row yet (transaction isolation). However, the unique index on the `order` table will **block** the second insert until the first transaction commits or rolls back. If commit → 23505 fires; if rollback → second proceeds. This is the correct behavior. No additional handling needed.

---

## 9. Verification Steps (post-implementation)

1. **Manual test:** Send two identical webhook payloads as fast as possible (e.g., with `curl` in parallel or a script with `Promise.all`)
2. **Verify:** Only one Order exists in the database for that `marketplace_order_id`
3. **Verify:** Both webhook responses return the same `order_id` (HTTP 200, not 500)
4. **Verify:** The `script_migrations` table records the migration script as executed
5. **Verify:** The index exists: `SELECT indexname FROM pg_indexes WHERE indexname = 'IDX_order_marketplace_idempotency'`
