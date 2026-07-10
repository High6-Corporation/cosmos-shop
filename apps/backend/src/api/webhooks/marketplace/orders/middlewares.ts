import {
  type MiddlewareRoute,
  validateAndTransformBody,
} from "@medusajs/framework/http";
import { z } from "zod";

/**
 * Zod schema for the marketplace order webhook payload.
 *
 * This is the generic normalized shape — individual marketplace webhook
 * receivers (Shopee, Lazada) must map their platform-specific payload
 * into this shape before calling the webhook endpoint.
 */

const TaxLineSchema = z.object({
  rate: z.number(),
  code: z.string(),
  amount: z.number(),
});

const OrderItemSchema = z.object({
  variant_id: z.string().optional(),
  sku: z.string().optional(),
  title: z.string(),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  is_tax_inclusive: z.boolean().optional(),
  tax_lines: z.array(TaxLineSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const BuyerSchema = z.object({
  email: z.string().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
});

const AddressSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  address_1: z.string(),
  address_2: z.string().optional(),
  city: z.string(),
  country_code: z.string().length(2),
  postal_code: z.string().optional(),
  phone: z.string().optional(),
});

const ShippingMethodSchema = z.object({
  name: z.string(),
  amount: z.number().nonnegative(),
  shipping_option_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateMarketplaceOrderSchema = z.object({
  marketplace: z.string(),
  marketplace_order_id: z.string(),
  marketplace_transaction_id: z.string(),

  items: z.array(OrderItemSchema).min(1),

  buyer: BuyerSchema,

  shipping_address: AddressSchema,
  billing_address: AddressSchema.optional(),

  shipping_method: ShippingMethodSchema,

  sales_channel_id: z.string(),
  currency_code: z.string().length(3),
  region_id: z.string().optional(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateMarketplaceOrderSchema = z.infer<
  typeof CreateMarketplaceOrderSchema
>;

/**
 * Middleware route for the marketplace order webhook.
 *
 * Signature verification middleware is included as a stub — the actual
 * signing scheme (HMAC-SHA256 with Shopee's partner key, Lazada's
 * signature header, etc.) will be implemented once the marketplace
 * parser modules are built.
 */
export const marketplaceOrderMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/webhooks/marketplace/orders",
    method: "POST",
    middlewares: [validateAndTransformBody(CreateMarketplaceOrderSchema)],
  },
];
