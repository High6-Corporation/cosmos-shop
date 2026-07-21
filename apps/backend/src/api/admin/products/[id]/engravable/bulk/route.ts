import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ModuleRegistrationName } from "@medusajs/framework/utils";
import { z } from "zod";

const bulkEngravingSchema = z.object({
  variant_ids: z
    .array(z.string())
    .min(1, "At least one variant ID is required"),
  is_engravable: z.boolean(),
  engraving_fee: z.number().min(0).optional(),
  engraving_threshold: z.number().int().min(1).optional(),
});

/**
 * POST /admin/products/:id/engravable/bulk
 *
 * Bulk-sets engraving eligibility, fee, and threshold on multiple variants
 * at once. Used by the bulk engraving widget on the product detail page.
 *
 * Validation: when is_engravable is true, both fee and threshold must
 * be provided and > 0. This is the same validation as the single-variant
 * route — prevents accidental free/broken engraving on the live storefront.
 *
 * Data storage: variant.metadata.is_engravable (boolean),
 *   variant.metadata.engraving_fee (number),
 *   variant.metadata.engraving_threshold (number).
 *
 * Known ceiling: loops over updateProductVariants() per variant since
 * no native bulk variant-metadata endpoint exists. Fine for typical
 * products (<50 variants). Products with hundreds of variants may hit
 * timeout; consider chunking if that becomes a real workload.
 */
export async function POST(
  req: MedusaRequest<z.infer<typeof bulkEngravingSchema>>,
  res: MedusaResponse,
) {
  const { id: productId } = req.params;
  const body = bulkEngravingSchema.parse(req.body);
  const productService = req.scope.resolve(ModuleRegistrationName.PRODUCT);

  // Validate: engraving ON requires fee and threshold (same as single-variant route)
  if (body.is_engravable) {
    if (!body.engraving_fee || body.engraving_fee <= 0) {
      return res.status(400).json({
        message:
          "Engraving fee is required and must be greater than 0 when engraving is enabled.",
      });
    }
    if (!body.engraving_threshold || body.engraving_threshold < 1) {
      return res.status(400).json({
        message:
          "Free engraving threshold is required and must be at least 1 when engraving is enabled.",
      });
    }
  }

  // Retrieve current metadata for all requested variants
  const variants = (await productService.listProductVariants(
    { id: body.variant_ids },
    { select: ["id", "metadata"] },
  )) as any[];

  const foundIds = new Set(variants.map((v: any) => v.id));
  const missing = body.variant_ids.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    return res.status(400).json({
      message: `Variants not found: ${missing.join(", ")}`,
    });
  }

  // Update each variant's metadata, preserving existing keys
  // Known ceiling: sequential updates, fine for <50 variants (see file header)
  const updated: string[] = [];
  for (const variant of variants) {
    await productService.updateProductVariants(variant.id, {
      metadata: {
        ...(variant.metadata ?? {}),
        is_engravable: body.is_engravable,
        engraving_fee: body.is_engravable ? body.engraving_fee : undefined,
        engraving_threshold: body.is_engravable
          ? body.engraving_threshold
          : undefined,
      },
    });
    updated.push(variant.id);
  }

  res.json({
    product_id: productId,
    updated,
    count: updated.length,
    is_engravable: body.is_engravable,
    engraving_fee: body.is_engravable ? body.engraving_fee : null,
    engraving_threshold: body.is_engravable ? body.engraving_threshold : null,
  });
}
