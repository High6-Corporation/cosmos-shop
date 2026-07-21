import { MedusaError } from "@medusajs/framework/utils";

export interface EngravingPricingInput {
  /** The variant ID being added to the cart */
  variantId: string;
  /** Quantity being added */
  quantity: number;
  /** Line-item metadata (set by storefront engraving toggle) */
  metadata?: Record<string, unknown> | null;
}

export interface EngravingPricingResult {
  /** Whether engraving pricing was applied */
  engraved: boolean;
  /** Per-unit fee to add (0 if engraved=false or threshold met) */
  feePerUnit: number;
  /** Total fee for this line */
  totalFee: number;
}

/**
 * Calculate engraving fee for a cart line item.
 *
 * Pure function — no side effects, no container access.
 *
 * Formula:
 *   if engraved AND quantity < threshold → fee_total = fee_per_unit × quantity
 *   else → 0 (free or not engraved)
 *
 * Reads engraving config from variant metadata.
 */
export function calculateEngravingPricing(
  input: EngravingPricingInput,
  variantMetadata: Record<string, unknown> | null | undefined,
): EngravingPricingResult {
  const defaultResult: EngravingPricingResult = {
    engraved: false,
    feePerUnit: 0,
    totalFee: 0,
  };

  // Not engraved — no change
  const isEngraved =
    input.metadata?.engraved === true || input.metadata?.engraved === "true";
  if (!isEngraved) return defaultResult;

  // Not an engravable variant (safety check)
  if (!variantMetadata?.is_engravable) return defaultResult;

  const feePerUnit = Number(variantMetadata.engraving_fee) || 0;
  const threshold = Number(variantMetadata.engraving_threshold) || 0;

  // Invalid config — silently skip (merchant hasn't set up properly)
  if (feePerUnit <= 0 || threshold < 1) return defaultResult;

  // Threshold met — free engraving
  if (input.quantity >= threshold) {
    return { engraved: true, feePerUnit: 0, totalFee: 0 };
  }

  // Below threshold — charge fee per unit
  const totalFee = feePerUnit * input.quantity;
  return { engraved: true, feePerUnit, totalFee };
}

/**
 * Validate that engraving metadata is consistent with variant eligibility.
 *
 * Throws a MedusaError (blocking the cart operation) if:
 *   - A line item has engraved=true but the variant is not engravable
 *
 * This prevents stale storefront state from creating engraved line items
 * on variants where the merchant has since disabled engraving.
 */
export function validateEngravingEligibility(
  input: EngravingPricingInput,
  variantMetadata: Record<string, unknown> | null | undefined,
): void {
  const isEngraved =
    input.metadata?.engraved === true || input.metadata?.engraved === "true";
  if (!isEngraved) return;

  if (!variantMetadata?.is_engravable) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Engraving is not available for variant ${input.variantId}. ` +
        `Please remove the engraving option and try again.`,
    );
  }
}
