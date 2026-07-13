import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createOrderWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import type { NormalizedOrderInput } from "./normalize-order-input";

export const createOrGetOrderStepId = "create-or-get-marketplace-order";

// ---------------------------------------------------------------------------
// Race-condition safety net for marketplace order idempotency
// ---------------------------------------------------------------------------
//
// The idempotency check (check-idempotency.ts) uses check-then-create, which
// has a window between SELECT and INSERT where two concurrent webhook calls
// for the same marketplace_order_id could both pass the "not found" check.
//
// A partial unique index on the `order` table
//   ((metadata->>'marketplace'), (metadata->>'marketplace_order_id'))
//   WHERE both keys are non-null
// (created by the migration script `create-marketplace-order-idempotency-index.ts`)
// closes this window at the database level.
//
// When the loser of the race hits the unique constraint, this helper
// identifies the error so we can catch it and re-query for the now-existing
// order instead of propagating a 500.
//
// Four shapes the error can take through Medusa's wrapping layers:
//   1. Raw Postgres error                          → err.code === '23505'
//   2. MikroORM UniqueConstraintViolationException  → also carries .code '23505'
//   3. MedusaError (dbErrorMapper at repo layer)    → err.type === 'invalid_data'
//   4. PermanentStepFailureError wrapping shape 3   → err.name ===
//      'PermanentStepFailure' with the dbErrorMapper message preserved
//      in err.message (containing "already exists.")
//
// Shape 4 is what actually surfaces at our try/catch inside a workflow
// step: the workflow engine wraps step-level errors in
// PermanentStepFailureError before throwing from .run(), which strips
// the .type / .code properties and leaves only the message string.

function isUniqueConstraintViolation(err: unknown): boolean {
  // The workflow engine re-throws step errors as plain objects
  // (not instanceof Error), so we cannot gate on instanceof.
  const e = err as unknown as Record<string, unknown> | null | undefined;
  if (!e) return false;
  return (
    e.code === "23505" ||
    e.type === "invalid_data" ||
    e.type === "duplicate_error" ||
    // PermanentStepFailureError wrapping: the workflow engine wraps
    // step errors; dbErrorMapper's "… already exists." message is
    // the tell-tale signature of a unique-constraint violation.
    (e.name === "PermanentStepFailure" &&
      typeof e.message === "string" &&
      e.message.includes("already exists."))
  );
}

export type CreateOrGetOrderInput = {
  existingOrderId: string | null;
  normalized: NormalizedOrderInput;
  marketplace_transaction_id: string;
  marketplace_order_id: string;
};

export type MarketplaceOrderResult = {
  id: string;
  status: string;
  total?: unknown;
  currency_code: string;
};

/**
 * Step that either creates a new native Medusa Order or returns the
 * already-imported order (if found during the idempotency check).
 *
 * For new orders: delegates to createOrderWorkflow, queries the fresh
 * order to get computed totals, creates a payment collection for the
 * correct amount, links it, and marks it as paid.
 */
export const createOrGetOrderStep = createStep(
  createOrGetOrderStepId,
  async (input: CreateOrGetOrderInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    // Idempotent: if order already exists, fetch and return it
    if (input.existingOrderId) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "status",
          "total",
          "currency_code",
          "items.*",
          "items.tax_lines.*",
          "shipping_address.*",
          "shipping_methods.*",
          "payment_collections.*",
          "metadata.*",
        ],
        filters: { id: input.existingOrderId },
      });

      const existing = orders[0];
      if (!existing) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Existing order ${input.existingOrderId} not found`,
        );
      }

      return new StepResponse(
        {
          id: existing.id,
          status: existing.status,
          total: existing.total,
          currency_code: existing.currency_code,
        },
        existing.id,
      );
    }

    // Create the order via Medusa's built-in workflow.
    //
    // The idempotency check above handles the 99.9% case.  For the 0.1%
    // race — two concurrent webhook calls that both pass SELECT before
    // either INSERT commits — the DB-level unique partial index (created
    // by `create-marketplace-order-idempotency-index.ts`) catches the
    // duplicate.  We catch that violation here, re-query for the now-
    // existing order, and return it instead of propagating an error.
    let orderId: string;
    let orderStatus: string;
    let orderCurrencyCode: string;
    let realTotal: number;

    try {
      const { result: order } = await createOrderWorkflow(container).run({
        input: input.normalized,
      });

      orderId = order.id;
      orderStatus = order.status;
      orderCurrencyCode = order.currency_code;

      // createOrderWorkflow returns the pre-refresh order (tax lines not yet
      // computed). Query the freshly persisted order to get the real total
      // that Medusa computed after its internal tax/adjustment refresh.
      const { data: freshOrders } = await query.graph({
        entity: "order",
        fields: ["id", "total", "currency_code"],
        filters: { id: order.id },
      });
      realTotal = Number(freshOrders[0]?.total ?? order.total ?? 0);

      // createOrderWorkflow (direct, non-Cart path) does not auto-create a
      // payment collection, so we must create one explicitly, link it to the
      // order, then mark it as paid.
      const paymentModule = container.resolve(Modules.PAYMENT);
      const link = container.resolve(ContainerRegistrationKeys.LINK);

      const [pc] = await paymentModule.createPaymentCollections([
        {
          amount: Number(realTotal),
          currency_code: order.currency_code,
        },
      ]);

      // Link the payment collection to the order
      await link.create({
        [Modules.ORDER]: { order_id: order.id },
        [Modules.PAYMENT]: { payment_collection_id: pc.id },
      });

      // Mark the payment collection as paid via the system provider.
      // marketplace_order_id is stored as `captured_by` for audit trail.
      await markPaymentCollectionAsPaid(container).run({
        input: {
          order_id: order.id,
          payment_collection_id: pc.id,
          captured_by: input.marketplace_order_id,
        },
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        // Lost the race — another concurrent webhook call created this
        // marketplace order between our SELECT check and our INSERT.
        // The unique index caught the duplicate at the DB level.
        // Re-query for the now-existing order and return it.

        const marketplace = input.normalized.metadata?.marketplace as
          string | undefined;
        const marketplaceOrderId =
          (input.marketplace_order_id as string) ??
          (input.normalized.metadata?.marketplace_order_id as
            string | undefined);

        // Log which error shape triggered the catch — required for the
        // concurrency test (Section 9 of the investigation report) to
        // confirm whether we're seeing raw 23505, MedusaError(INVALID_DATA),
        // or MedusaError(DUPLICATE_ERROR).
        const e = err as unknown as Record<string, unknown>;
        const matchedShape =
          e.code === "23505"
            ? "raw/mikro-orm (err.code === '23505')"
            : e.type === "invalid_data"
              ? "MedusaError (err.type === 'invalid_data')"
              : e.type === "duplicate_error"
                ? "MedusaError (err.type === 'duplicate_error')"
                : "unknown";

        const { data: existingOrders } = await query.graph({
          entity: "order",
          fields: [
            "id",
            "status",
            "total",
            "currency_code",
            "items.*",
            "items.tax_lines.*",
            "shipping_address.*",
            "shipping_methods.*",
            "payment_collections.*",
          ],
          filters: {
            metadata: {
              marketplace,
              marketplace_order_id: marketplaceOrderId,
            },
          } as Record<string, unknown>,
        });

        const existing = existingOrders[0];
        if (!existing) {
          // The index violation proves a matching row exists.  If we can't
          // find it, something is wrong — re-throw the original error.
          throw err;
        }

        const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
        logger.warn(
          `[marketplace:idempotency] Race resolved — ` +
            `duplicate INSERT blocked by unique index, ` +
            `returning existing order ${existing.id} ` +
            `(marketplace=${marketplace}, marketplace_order_id=${marketplaceOrderId}). ` +
            `Error shape: ${matchedShape}`,
        );

        return new StepResponse(
          {
            id: existing.id,
            status: existing.status,
            total: existing.total,
            currency_code: existing.currency_code,
          },
          existing.id,
        );
      }
      throw err;
    }

    return new StepResponse(
      {
        id: orderId,
        status: orderStatus,
        total: realTotal,
        currency_code: orderCurrencyCode,
      },
      orderId,
    );
  },
  // Compensation: delete the created order if the workflow rolls back
  async (orderId, { container }) => {
    if (!orderId) {
      return;
    }
    const orderService = container.resolve(Modules.ORDER);
    try {
      await orderService.deleteOrders(orderId);
    } catch {
      // Best-effort cleanup — order may already be deleted by cascade
    }
  },
);
