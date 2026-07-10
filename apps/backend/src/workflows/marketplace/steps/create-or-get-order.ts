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

    // Create the order via Medusa's built-in workflow
    const { result: order } = await createOrderWorkflow(container).run({
      input: input.normalized,
    });

    // createOrderWorkflow returns the pre-refresh order (tax lines not yet
    // computed). Query the freshly persisted order to get the real total
    // that Medusa computed after its internal tax/adjustment refresh.
    const { data: freshOrders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "currency_code"],
      filters: { id: order.id },
    });
    const realTotal = Number(freshOrders[0]?.total ?? order.total ?? 0);

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

    return new StepResponse(
      {
        id: order.id,
        status: order.status,
        total: realTotal,
        currency_code: order.currency_code,
      },
      order.id,
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
