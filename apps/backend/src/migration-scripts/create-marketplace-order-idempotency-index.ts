import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";

/**
 * Creates a partial unique index on the `order` table to enforce idempotency
 * at the database level for marketplace order creation.
 *
 * The index covers `(metadata->>'marketplace', metadata->>'marketplace_order_id')`
 * but only for rows where BOTH keys are non-null — i.e., actual marketplace
 * orders. Non-marketplace orders (storefront checkout, draft orders, etc.)
 * are excluded from the index entirely.
 *
 * This closes the race-condition window in the current check-then-create
 * idempotency pattern: if two near-simultaneous webhook calls for the same
 * marketplace_order_id both pass the SELECT check, the second INSERT hits
 * this unique constraint and the workflow's catch-and-resolve logic returns
 * the already-created order instead of producing a duplicate.
 *
 * Idempotent: uses IF NOT EXISTS — safe to run multiple times.
 */
export default async function createMarketplaceOrderIdempotencyIndex({
  container,
}: {
  container: MedusaContainer;
}) {
  const pgConnection = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as Knex;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    info: (msg: string) => void;
  };

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
