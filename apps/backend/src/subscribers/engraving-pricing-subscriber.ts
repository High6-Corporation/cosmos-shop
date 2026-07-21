/**
 * Subscriber: adjust engraved line-item prices after cart updates.
 *
 * WHY A SUBSCRIBER INSTEAD OF A WORKFLOW HOOK:
 * addToCartWorkflow only exposes `validate` and `setPricingContext` hooks.
 * The validate hook can throw to block execution but cannot modify input in
 * a way that persists through the workflow (mutations to input.items[].unit_price
 * are overwritten by the workflow's transform steps — confirmed via diagnostic
 * testing 2026-07-20). There is no onComplete hook.
 *
 * This subscriber runs AFTER the workflow completes and adjusts line-item
 * unit_price via the cart module's updateLineItems(). It guards against
 * infinite loops by checking whether the price already includes the fee
 * before updating.
 *
 * FORMULA:
 *   engraved && qty < threshold → unit_price = base_price + fee_per_unit
 *   engraved && qty >= threshold → free (no fee applied)
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  CartWorkflowEvents,
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  calculateEngravingPricing,
} from "../utils/engraving-pricing";

// Precision guard: if the current price is within this delta of the target,
// consider it already adjusted (prevents infinite update loops).
const PRICE_GUARD_DELTA = 0.01;

export default async function engravingPricingSubscriber({
  event,
  container,
}: SubscriberArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  logger.info(`[engraving-pricing] subscriber FIRED for cart ${(event.data as any)?.id}`);

  try {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const cartModule = container.resolve(Modules.CART);
  logger.info("[engraving-pricing] resolved services");

  const cartId = (event.data as any)?.id as string | undefined;
  if (!cartId) {
    logger.info("[engraving-pricing] subscriber: no cartId, skipping");
    return;
  }
  logger.info(`[engraving-pricing] querying cart ${cartId}`);

  // 1. Fetch the cart. Use query.graph with the same entity/fields that
  //    addToCartWorkflow itself uses for cart retrieval (entity: "cart",
  //    fields including currency — see add-to-cart.js line 100-105).
  //    Query items separately via the cart module because query.graph
  //    on "cart" may not resolve the "items" relation.
  const { data: cartData } = await query.graph({
    entity: "cart",
    fields: ["id", "currency_code"],
    filters: { id: cartId },
  });

  const cart: any = Array.isArray(cartData) ? cartData[0] : cartData;
  logger.info(`[engraving-pricing] cart fetched: ${!!cart}`);

  // Fetch line items separately via the cart module
  const lineItems = await cartModule.listLineItems(
    { cart_id: cartId },
    { select: ["id", "variant_id", "metadata", "unit_price", "quantity"] },
  );
  logger.info(`[engraving-pricing] line items: ${lineItems.length}`);

  if (!cart) {
    logger.info("[engraving-pricing] cart is null, skipping");
    return;
  }

  // 2. Find engraved line items
  const engravedItems = lineItems.filter(
    (item: any) =>
      item.metadata?.engraved === true || item.metadata?.engraved === "true",
  );

  logger.info(`[engraving-pricing] engraved items: ${engravedItems.length}`);

  if (engravedItems.length === 0) {
    logger.info("[engraving-pricing] no engraved items, done");
    return;
  }

  // 3. Look up variant metadata + prices for engraved variants
  const variantIds = engravedItems
    .map((i: any) => i.variant_id)
    .filter(Boolean);

  if (variantIds.length === 0) return;

  const { data: rawVariants } = await query.graph({
    entity: "variant",
    fields: ["id", "metadata", "prices.*"],
    filters: { id: variantIds },
  });

  const variants = (rawVariants ?? []) as any[];
  const currencyCode = (cart as any)?.currency_code ?? "php";

  // Build lookup: variant id → { metadata, basePrice }
  const variantLookup = new Map<string, { metadata: Record<string, unknown>; basePrice: number }>();
  for (const v of variants) {
    const prices = (v.prices ?? []) as any[];
    const matchingPrice = prices.find(
      (p: any) => p.currency_code === currencyCode,
    );
    variantLookup.set(v.id, {
      metadata: (v.metadata ?? {}) as Record<string, unknown>,
      basePrice: matchingPrice?.amount ?? 0,
    });
  }

  // 4. Calculate and apply engraving fee for each line item
  let adjustedCount = 0;
  for (const lineItem of engravedItems) {
    const variantInfo = variantLookup.get(lineItem.variant_id ?? "");
    if (!variantInfo || variantInfo.basePrice <= 0) continue;

    const result = calculateEngravingPricing(
      {
        variantId: lineItem.variant_id ?? "",
        quantity: Number(lineItem.quantity ?? 1),
        metadata: lineItem.metadata,
      },
      variantInfo.metadata,
    );

    if (!result.engraved || result.totalFee <= 0) continue;

    const targetPrice = variantInfo.basePrice + result.feePerUnit;

    // Guard: if price is already correct (within delta), skip to avoid loop
    if (Math.abs(Number(lineItem.unit_price ?? 0) - targetPrice) < PRICE_GUARD_DELTA) {
      continue;
    }

    await cartModule.updateLineItems([
      {
        id: lineItem.id,
        unit_price: targetPrice,
      },
    ]);

    adjustedCount++;
    logger.info(
      `[engraving-pricing] subscriber variant=${lineItem.variant_id} ` +
        `qty=${lineItem.quantity} fee=${result.feePerUnit}/unit ` +
        `base=${variantInfo.basePrice} adjusted=${targetPrice}`,
    );
  }

  if (adjustedCount > 0) {
    logger.info(
      `[engraving-pricing] subscriber adjusted ${adjustedCount} line items on cart ${cartId}`,
    );
  }
  } catch (err: any) {
    logger.error(`[engraving-pricing] subscriber ERROR: ${err?.message ?? err}`);
  }
}

export const config: SubscriberConfig = {
  event: CartWorkflowEvents.UPDATED,
};
