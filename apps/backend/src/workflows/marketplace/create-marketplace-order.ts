import {
  createWorkflow,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { checkIdempotencyStep } from "./steps/check-idempotency";
import {
  normalizeOrderInputStep,
  type MarketplaceOrderInput,
} from "./steps/normalize-order-input";
import { createOrGetOrderStep } from "./steps/create-or-get-order";
import { reserveOrderInventoryStep } from "./steps/reserve-order-inventory";

export const createMarketplaceOrderWorkflowId = "create-marketplace-order";

/**
 * Workflow that creates a native Medusa Order from a normalized marketplace
 * order input (Shopee, Lazada, etc.). Designed to be invoked from a webhook
 * receiver, but can also be called programmatically.
 *
 * ## Flow
 *
 * 1. **Idempotency check** — queries for an existing order with the same
 *    marketplace order ID. If found, returns it immediately (no duplicate).
 * 2. **Normalize input** — transforms the generic marketplace shape into
 *    the shape `createOrderWorkflow` expects (SKU→variant resolution,
 *    shipping method mapping, buyer→customer mapping).
 * 3. **Create or get** — either delegates to Medusa's built-in
 *    `createOrderWorkflow` (handling guest customer creation, inventory
 *    confirmation, price validation, and tax line refresh), or returns
 *    the existing order if one was found in step 1.
 * 4. **Capture payment** — marks the auto-created payment collection as paid
 *    via the system payment provider, storing the marketplace transaction ID
 *    as metadata on the payment record.
 *
 * ## Idempotency
 *
 * The combination of `marketplace` + `marketplace_order_id` (stored in
 * order metadata) serves as the dedupe key. If a webhook is delivered
 * multiple times, the second invocation returns the existing order instead
 * of creating a duplicate.
 */
export const createMarketplaceOrderWorkflow = createWorkflow(
  createMarketplaceOrderWorkflowId,
  function (input: MarketplaceOrderInput) {
    // Step 1: Check whether this marketplace order already exists
    const { existingOrderId } = checkIdempotencyStep({
      marketplace: input.marketplace,
      marketplace_order_id: input.marketplace_order_id,
    });

    // Step 2: Normalize the marketplace input into createOrderWorkflow shape
    const normalized = normalizeOrderInputStep(input);

    // Step 3: Create a new order or return the existing one.
    // Payment capture (for new orders) is handled inside this step.
    const order = createOrGetOrderStep({
      existingOrderId,
      normalized,
      marketplace_transaction_id: input.marketplace_transaction_id,
      marketplace_order_id: input.marketplace_order_id,
    });

    // Step 4: Reserve inventory for newly created orders.
    // createOrderWorkflow only *confirms* availability (read-only check);
    // it does NOT create reservation items or update reserved_quantity.
    // The fulfillment workflow requires reservations to exist for managed-
    // inventory items, so we create them explicitly here — the same pattern
    // used by completeCartWorkflow and convertDraftOrderWorkflow.
    // Idempotent replays skip this step (reservations already exist).
    when("reserve-inventory", { existingOrderId }, ({ existingOrderId }) => {
      return !existingOrderId;
    }).then(() => {
      reserveOrderInventoryStep({
        orderId: order.id,
        salesChannelId: normalized.sales_channel_id,
        items: normalized.items,
      });
    });

    return new WorkflowResponse(order);
  },
);

export default createMarketplaceOrderWorkflow;
