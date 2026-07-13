import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types";

/**
 * Widget that displays marketplace-specific metadata on the order details page.
 *
 * Injected at `order.details.after` — appears below the native order summary
 * for marketplace orders only. Non-marketplace orders render nothing.
 *
 * Data source: `order.metadata` (jsonb), populated by
 * `normalizeOrderInputStep` during marketplace order creation.
 * Transaction ID is read from `created_by` on the payment collection's
 * first capture (set via the `captured_by` param to
 * `markPaymentCollectionAsPaid`, persisted as `BaseCapture.created_by`).
 *
 * ## Multi-capture note
 *
 * `markPaymentCollectionAsPaid` captures the full order amount in a single
 * capture, so `captures[0]` is always correct for marketplace orders. If
 * partial captures are ever introduced, map over all captures and join
 * the `created_by` values.
 */
const MarketplaceOrderMetadataWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  // Only render for marketplace orders — identified by the `marketplace`
  // metadata key set in normalizeOrderInputStep
  const marketplace = order.metadata?.marketplace as string | undefined;
  if (!marketplace) {
    return null;
  }

  const marketplaceOrderId = order.metadata?.marketplace_order_id as
    string | undefined;

  // Transaction ID is persisted as `created_by` on the first capture of
  // the first payment. The workflow passes it as the `captured_by` param
  // to markPaymentCollectionAsPaid, but the stored field is `created_by`
  // (BaseCapture.created_by). The workflow creates exactly one payment
  // collection and captures it synchronously, so index [0] is correct.
  const transactionId: string | undefined = order.payment_collections?.[0]
    ?.payments?.[0]?.captures?.[0]?.created_by as string | undefined;

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Marketplace Order</Heading>
      </div>
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Marketplace
          </Text>
          <Text size="small" leading="compact" weight="plus">
            {marketplace}
          </Text>
        </div>
        <div className="flex flex-col gap-y-1">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Marketplace Order ID
          </Text>
          <Text size="small" leading="compact" weight="plus">
            {marketplaceOrderId ?? "—"}
          </Text>
        </div>
        <div className="flex flex-col gap-y-1">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Transaction ID
          </Text>
          <Text size="small" leading="compact" weight="plus">
            {transactionId ?? "Not yet captured"}
          </Text>
        </div>
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.details.after",
});

export default MarketplaceOrderMetadataWidget;
