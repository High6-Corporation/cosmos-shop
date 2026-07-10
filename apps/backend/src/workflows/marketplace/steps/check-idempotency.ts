import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export const checkIdempotencyStepId = "check-marketplace-order-idempotency";

export type CheckIdempotencyInput = {
  marketplace: string;
  marketplace_order_id: string;
};

export type CheckIdempotencyOutput = {
  existingOrderId: string | null;
};

/**
 * Step that checks whether a marketplace order has already been imported.
 *
 * Uses `query.graph()` to search for an existing order with matching
 * marketplace + marketplace_order_id in its metadata. This prevents
 * duplicate webhook deliveries from creating multiple Medusa Orders
 * for the same marketplace transaction.
 *
 * If an existing order is found, downstream steps should short-circuit and
 * return the existing order rather than creating a duplicate.
 */
export const checkIdempotencyStep = createStep(
  checkIdempotencyStepId,
  async (input: CheckIdempotencyInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const { data: existingOrders } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: {
        metadata: {
          marketplace: input.marketplace,
          marketplace_order_id: input.marketplace_order_id,
        },
      } as Record<string, unknown>,
    });

    const existingOrderId =
      existingOrders.length > 0 ? existingOrders[0].id : null;

    return new StepResponse(
      { existingOrderId } satisfies CheckIdempotencyOutput,
      existingOrderId,
    );
  },
);
