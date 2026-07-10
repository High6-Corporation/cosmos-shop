/**
 * Shipping courier/service name → Medusa shipping option ID mappings.
 *
 * Populate these maps as marketplace integrations are built. The key is the
 * courier/service name as it appears in the marketplace webhook payload
 * (e.g. "Shopee Express", "J&T Express", "Lazada Logistics").
 *
 * If a courier name is not found here, the order is still created with a
 * custom shipping method (name + amount only, no shipping_option_id) —
 * an admin can assign one manually later.
 */

export type ShippingMapping = {
  shipping_option_id: string;
};

/**
 * Master mapping: marketplace → courier name → shipping option ID.
 *
 * Example entries (uncomment and populate with real IDs):
 *
 * "Shopee Express": { shipping_option_id: "so_xxx" },
 * "J&T Express":    { shipping_option_id: "so_yyy" },
 */
export const SHIPPING_MAPPINGS: Record<string, ShippingMapping> = {
  // Populated per marketplace as integrations are built
};

/**
 * Resolve a courier name to a Medusa shipping option ID.
 * Returns undefined if no mapping exists (callers should fall back to
 * custom shipping method creation).
 */
export function resolveShippingOption(courierName: string): string | undefined {
  return SHIPPING_MAPPINGS[courierName]?.shipping_option_id;
}
