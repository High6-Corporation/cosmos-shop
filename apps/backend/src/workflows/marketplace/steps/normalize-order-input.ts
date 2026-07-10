import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { resolveShippingOption } from "../shipping-mappings";

export const normalizeOrderInputStepId = "normalize-marketplace-order-input";

/**
 * The generic marketplace order shape this module accepts.
 * Individual marketplace parsers (Shopee, Lazada, etc.) map their
 * platform-specific webhook payloads into this shape before invoking
 * the workflow.
 */
export type MarketplaceOrderInput = {
  marketplace: string;
  marketplace_order_id: string;
  marketplace_transaction_id: string;

  items: {
    variant_id?: string;
    sku?: string;
    title: string;
    quantity: number;
    unit_price: number;
    is_tax_inclusive?: boolean;
    tax_lines?: {
      rate: number;
      code: string;
      amount: number;
    }[];
    metadata?: Record<string, unknown>;
  }[];

  buyer: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  };

  shipping_address: {
    first_name: string;
    last_name: string;
    address_1: string;
    address_2?: string;
    city: string;
    country_code: string;
    postal_code?: string;
    phone?: string;
  };

  billing_address?: {
    first_name?: string;
    last_name?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    country_code?: string;
    postal_code?: string;
    phone?: string;
  };

  shipping_method: {
    name: string;
    amount: number;
    shipping_option_id?: string;
    metadata?: Record<string, unknown>;
  };

  sales_channel_id: string;
  currency_code: string;
  region_id?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

/**
 * The shape that `createOrderWorkflow` expects.
 * This is a subset — only the fields we populate from the marketplace input.
 */
export type NormalizedOrderInput = {
  items: {
    variant_id?: string;
    title: string;
    quantity: number;
    unit_price: number;
    is_tax_inclusive?: boolean;
    tax_lines?: {
      rate: number;
      code: string;
      amount: number;
    }[];
    metadata?: Record<string, unknown>;
  }[];
  email: string;
  customer_id?: string;
  shipping_address: {
    first_name?: string;
    last_name?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    country_code?: string;
    postal_code?: string;
    phone?: string;
    metadata?: Record<string, unknown>;
  };
  billing_address?: {
    first_name?: string;
    last_name?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    country_code?: string;
    postal_code?: string;
    phone?: string;
    metadata?: Record<string, unknown>;
  };
  shipping_methods?: {
    name: string;
    amount: number;
    shipping_option_id?: string;
    metadata?: Record<string, unknown>;
  }[];
  sales_channel_id: string;
  currency_code: string;
  region_id?: string;
  status: string;
  metadata?: Record<string, unknown>;
};

/**
 * Transforms a MarketplaceOrderInput into the shape `createOrderWorkflow`
 * expects. This step handles:
 *
 * 1. SKU → variant_id resolution (if sku is provided without variant_id)
 * 2. Shipping method mapping (courier name → shipping option ID)
 * 3. Buyer info → customer email/first_name/last_name
 * 4. Tax line passthrough (marketplace-computed tax preserved as-is)
 * 5. Metadata passthrough with marketplace auditing fields
 */
export const normalizeOrderInputStep = createStep(
  normalizeOrderInputStepId,
  async (input: MarketplaceOrderInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    // Resolve items: SKU → variant_id lookup where needed
    const resolvedItems = await Promise.all(
      input.items.map(async (item) => {
        if (item.variant_id) {
          return {
            variant_id: item.variant_id,
            title: item.title,
            quantity: item.quantity,
            unit_price: item.unit_price,
            is_tax_inclusive: item.is_tax_inclusive,
            tax_lines: item.tax_lines,
            metadata: item.metadata,
          };
        }

        // If SKU is provided without variant_id, look up the variant
        if (item.sku) {
          const { data: variants } = await query.graph({
            entity: "product_variant",
            fields: ["id"],
            filters: { sku: item.sku },
          });

          if (variants && variants.length > 0) {
            return {
              variant_id: variants[0].id,
              title: item.title,
              quantity: item.quantity,
              unit_price: item.unit_price,
              is_tax_inclusive: item.is_tax_inclusive,
              tax_lines: item.tax_lines,
              metadata: item.metadata,
            };
          }
        }

        // No variant_id and no SKU match — create as custom line item
        return {
          title: item.title,
          quantity: item.quantity,
          unit_price: item.unit_price,
          is_tax_inclusive: item.is_tax_inclusive,
          tax_lines: item.tax_lines,
          metadata: item.metadata,
        };
      }),
    );

    // Resolve shipping method: check config map for a matching option ID
    const shippingOptionId =
      input.shipping_method.shipping_option_id ??
      resolveShippingOption(input.shipping_method.name);

    const shippingMethod = {
      name: input.shipping_method.name,
      amount: input.shipping_method.amount,
      ...(shippingOptionId ? { shipping_option_id: shippingOptionId } : {}),
      ...(input.shipping_method.metadata
        ? { metadata: input.shipping_method.metadata }
        : {}),
    };

    // Build shipping address with marketplace metadata for audit
    const shippingAddress = {
      first_name: input.shipping_address.first_name,
      last_name: input.shipping_address.last_name,
      address_1: input.shipping_address.address_1,
      address_2: input.shipping_address.address_2,
      city: input.shipping_address.city,
      country_code: input.shipping_address.country_code,
      postal_code: input.shipping_address.postal_code,
      phone: input.shipping_address.phone,
    };

    // Default billing address to shipping address if not provided
    const billingAddress = input.billing_address
      ? {
          first_name: input.billing_address.first_name,
          last_name: input.billing_address.last_name,
          address_1: input.billing_address.address_1,
          address_2: input.billing_address.address_2,
          city: input.billing_address.city,
          country_code: input.billing_address.country_code,
          postal_code: input.billing_address.postal_code,
          phone: input.billing_address.phone,
        }
      : undefined;

    const normalized: NormalizedOrderInput = {
      items: resolvedItems,
      email: input.buyer.email,
      shipping_address: shippingAddress,
      billing_address: billingAddress,
      shipping_methods: [shippingMethod],
      sales_channel_id: input.sales_channel_id,
      currency_code: input.currency_code,
      region_id: input.region_id,
      status: input.status ?? "pending",
      metadata: {
        ...(input.metadata ?? {}),
        marketplace: input.marketplace,
        marketplace_order_id: input.marketplace_order_id,
      },
    };

    return new StepResponse(normalized);
  },
);
