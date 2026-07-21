/**
 * Workflow hook registration for engraving validation.
 *
 * Validates that engraved=true line items are only added to engravable variants.
 * Throws NOT_ALLOWED to block the cart operation if validation fails.
 *
 * PRICING is handled by a separate subscriber (engraving-pricing-subscriber.ts)
 * because validate hooks cannot modify workflow input in a way that persists
 * through the workflow execution (confirmed via diagnostic testing 2026-07-20).
 *
 * Data source: variant.metadata (is_engravable, engraving_fee, engraving_threshold)
 *
 * Auto-discovered by Medusa's WorkflowLoader — no configuration needed.
 *
 * Linked to:
 *   - src/utils/engraving-pricing.ts (validation logic)
 *   - src/subscribers/engraving-pricing-subscriber.ts (pricing logic)
 */

import {
  addToCartWorkflow,
  createCartWorkflow,
} from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { validateEngravingEligibility } from "../utils/engraving-pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemWithVariant {
  variant_id?: string | null;
  quantity?: number;
  metadata?: Record<string, unknown> | null;
  unit_price?: number;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function resolveVariantMeta(
  query: any,
  items: ItemWithVariant[],
): Promise<Map<string, Record<string, unknown>>> {
  const variantMeta = new Map<string, Record<string, unknown>>();
  const variantIds = items
    .map((i) => i.variant_id)
    .filter((id): id is string => !!id);

  if (variantIds.length === 0) return variantMeta;

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "metadata"],
    filters: { id: variantIds },
  });

  for (const v of variants ?? []) {
    variantMeta.set(v.id, (v.metadata ?? {}) as Record<string, unknown>);
  }

  return variantMeta;
}

// ---------------------------------------------------------------------------
// addToCartWorkflow — validate only
// ---------------------------------------------------------------------------

addToCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const items = (input.items ?? []) as ItemWithVariant[];
  if (items.length === 0) return;

  const variantMeta = await resolveVariantMeta(query, items);

  for (const item of items) {
    if (!item.variant_id) continue;
    const meta = variantMeta.get(item.variant_id);
    validateEngravingEligibility(
      {
        variantId: item.variant_id,
        quantity: item.quantity ?? 1,
        metadata: item.metadata,
      },
      meta,
    );
  }
});

// ---------------------------------------------------------------------------
// createCartWorkflow — validate only
// ---------------------------------------------------------------------------

createCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const items = (input.items ?? []) as ItemWithVariant[];
  if (items.length === 0) return;

  const variantMeta = await resolveVariantMeta(query, items);

  for (const item of items) {
    if (!item.variant_id) continue;
    const meta = variantMeta.get(item.variant_id);
    validateEngravingEligibility(
      {
        variantId: item.variant_id,
        quantity: item.quantity ?? 1,
        metadata: item.metadata,
      },
      meta,
    );
  }
});
