import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CreateMarketplaceOrderSchema } from "./middlewares";
import createMarketplaceOrderWorkflow from "../../../../workflows/marketplace/create-marketplace-order";

/**
 * POST /webhooks/marketplace/orders
 *
 * Receives a normalized marketplace order payload and creates a native
 * Medusa Order. Individual marketplace integration layers (Shopee, Lazada,
 * etc.) are responsible for mapping their webhook payloads into this
 * endpoint's expected shape before forwarding the request.
 *
 * ## Signature Verification
 *
 * TODO: Implement marketplace-specific signature verification before
 * processing the payload. Each marketplace uses a different signing scheme:
 * - Shopee: HMAC-SHA256 with partner key + authorization URL redirect
 * - Lazada: Request signature with app secret
 *
 * Until parsers are built, the verification middleware is a no-op stub.
 * The endpoint still validates the body against the normalized schema.
 *
 * ## Idempotency
 *
 * The workflow prevents duplicate order creation based on the
 * `marketplace` + `marketplace_order_id` dedupe key. If the same
 * webhook is delivered multiple times, subsequent requests return
 * the existing order (HTTP 200, not 201).
 */
export async function POST(
  req: MedusaRequest<CreateMarketplaceOrderSchema>,
  res: MedusaResponse,
) {
  const body = req.validatedBody;

  const { result } = await createMarketplaceOrderWorkflow(req.scope).run({
    input: body,
  });

  res.status(200).json({ order: result });
}
