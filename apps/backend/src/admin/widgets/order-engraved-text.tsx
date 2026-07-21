import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types";

/**
 * Widget that displays engraving text for order line items on the order
 * detail page. Injected at `order.details.after`.
 *
 * Renders a table of engraved items — each row shows the variant title,
 * quantity, and the text to engrave. Fulfillment staff use this to see
 * exactly what to engrave on each item without digging through raw metadata.
 */
const OrderEngravedTextWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  // Collect engraved line items
  const engravedItems = (order.items ?? []).filter(
    (item: any) =>
      item.metadata?.engraved === true || item.metadata?.engraved === "true",
  );

  if (engravedItems.length === 0) {
    return null;
  }

  return (
    <Container>
      <Heading level="h2" className="text-lg font-semibold mb-4">
        Engraving Details
      </Heading>
      <div className="flex flex-col gap-2">
        {engravedItems.map((item: any) => (
          <div
            key={item.id}
            className="flex flex-col gap-1 border-b border-gray-100 pb-2 last:border-0"
          >
            <div className="flex justify-between items-center">
              <Text size="small" weight="plus">
                {item.product_title ?? item.title}
                {item.variant_title ? ` — ${item.variant_title}` : ""}
              </Text>
              <Text size="small" className="text-ui-fg-muted">
                Qty: {item.quantity}
              </Text>
            </div>
            <div className="bg-gray-50 rounded-md px-3 py-2">
              <Text size="small" className="text-ui-fg-subtle">
                Engraving text:
              </Text>
              <Text
                size="base"
                weight="plus"
                className="font-mono tracking-wide"
              >
                {(item.metadata?.engraved_text as string)?.trim() || (
                  <span className="text-red-500 italic">(missing)</span>
                )}
              </Text>
            </div>
          </div>
        ))}
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.details.after",
});

export default OrderEngravedTextWidget;
