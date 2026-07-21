import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ModuleRegistrationName } from "@medusajs/framework/utils";
import { z } from "zod";

const engravingSchema = z.object({
  is_engravable: z.boolean(),
  engraving_fee: z.number().min(0).optional(),
  engraving_threshold: z.number().int().min(1).optional(),
});

/**
 * POST /admin/products/:id/variants/:variant_id/engravable
 *
 * Toggles engraving eligibility on a specific variant and sets
 * engraving fee + free-engraving quantity threshold.
 *
 * Validation: when is_engravable is true, both fee and threshold must
 * be provided and > 0. This prevents accidental free/broken engraving
 * on the live storefront.
 *
 * Data storage: variant.metadata.is_engravable (boolean),
 *   variant.metadata.engraving_fee (number),
 *   variant.metadata.engraving_threshold (number).
 */
export async function POST(
  req: MedusaRequest<z.infer<typeof engravingSchema>>,
  res: MedusaResponse,
) {
  const { id, variant_id } = req.params;
  const body = engravingSchema.parse(req.body);
  const productService = req.scope.resolve(
    ModuleRegistrationName.PRODUCT,
  );

  // Validate: engraving ON requires fee and threshold
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

  // Retrieve current variant metadata to merge
  const [variant] = (await productService.listProductVariants(
    { id: variant_id },
    { select: ["metadata"] },
  )) as any[];

  // Update variant metadata (preserving any existing keys)
  await productService.updateProductVariants(variant_id, {
    metadata: {
      ...(variant?.metadata ?? {}),
      is_engravable: body.is_engravable,
      engraving_fee: body.is_engravable ? body.engraving_fee : undefined,
      engraving_threshold: body.is_engravable
        ? body.engraving_threshold
        : undefined,
    },
  });

  res.json({
    product_id: id,
    variant_id,
    is_engravable: body.is_engravable,
    engraving_fee: body.is_engravable ? body.engraving_fee : null,
    engraving_threshold: body.is_engravable ? body.engraving_threshold : null,
  });
}
