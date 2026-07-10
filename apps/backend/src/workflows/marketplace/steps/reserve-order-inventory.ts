import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  ContainerRegistrationKeys,
  MathBN,
  Modules,
} from "@medusajs/framework/utils";

export const reserveOrderInventoryStepId =
  "reserve-marketplace-order-inventory";

export type ReserveOrderInventoryInput = {
  orderId: string;
  salesChannelId: string;
  /** Quantity map: variant_id → ordered quantity. Avoids querying the
   *  order for item quantities (query.graph() doesn't return them). */
  items: { variant_id?: string; quantity: number }[];
};

/**
 * Compensation data passed to the compensation handler.
 */
type CompensationData = {
  reservationIds: string[];
  inventoryItemIds: string[];
};

/**
 * Step that creates inventory reservations for a newly created marketplace
 * order, mirroring what `completeCartWorkflow` and `convertDraftOrderWorkflow`
 * do via `reserveInventoryStep`.
 *
 * This step MUST run after the order is created (line item IDs must exist)
 * and before any fulfillment attempt, since the fulfillment workflow
 * requires reservations to already exist for managed-inventory items.
 *
 * Items with `manage_inventory: false` or no variant are silently skipped.
 */
export const reserveOrderInventoryStep = createStep(
  reserveOrderInventoryStepId,
  async (
    input: ReserveOrderInventoryInput,
    { container },
  ): Promise<StepResponse<any[], CompensationData>> => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    // 1. Build a quantity map from the input items: variant_id → total quantity.
    //    Multiple input items can reference the same variant (unlikely but safe).
    const variantQtyMap = new Map<string, number>();
    for (const item of input.items) {
      if (!item.variant_id) continue;
      const prev = variantQtyMap.get(item.variant_id) ?? 0;
      variantQtyMap.set(item.variant_id, prev + item.quantity);
    }

    const variantIds = Array.from(variantQtyMap.keys());
    if (!variantIds.length) {
      return new StepResponse([], { reservationIds: [], inventoryItemIds: [] });
    }

    // 2. Query the freshly created order to get line item IDs (generated
    //    during order creation). We only need id + variant_id since
    //    quantity comes from the input above.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.variant_id"],
      filters: { id: input.orderId },
    });

    const order = orders[0] as any;
    if (!order?.items?.length) {
      return new StepResponse([], { reservationIds: [], inventoryItemIds: [] });
    }

    // 3. Query variant inventory data (manage_inventory, allow_backorder,
    //    inventory_item_id, required_quantity).
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: [
        "id",
        "manage_inventory",
        "allow_backorder",
        "inventory_items.inventory_item_id",
        "inventory_items.required_quantity",
      ],
      filters: { id: variantIds },
    });

    const variantMap = new Map((variants as any[]).map((v: any) => [v.id, v]));

    // 4. Resolve stock locations linked to the sales channel.
    const { data: channelData } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "stock_locations.id"],
      filters: { id: input.salesChannelId },
    });

    const channelLocations: string[] = (
      (channelData[0] as any)?.stock_locations ?? []
    ).map((sl: any) => sl.id);

    if (!channelLocations.length) {
      return new StepResponse([], { reservationIds: [], inventoryItemIds: [] });
    }

    // 5. Build reservation items
    const reservationItems: {
      line_item_id: string;
      inventory_item_id: string;
      quantity: number;
      allow_backorder: boolean;
      location_id: string;
    }[] = [];

    const inventoryItemIds: string[] = [];

    // Helper: query.graph() may return numeric fields as { value, precision }
    // objects. Extract the plain number.
    const asNumber = (val: any): number => {
      if (val == null) return 0;
      if (typeof val === "number") return val;
      if (typeof val === "string") return Number(val);
      if (typeof val?.value !== "undefined") return Number(val.value);
      return Number(val);
    };

    const locationId = channelLocations[0];

    for (const rawItem of order.items) {
      const item = rawItem as any;
      if (!item?.variant_id) continue;

      const variant = variantMap.get(item.variant_id);
      if (!variant?.manage_inventory) continue;

      const itemQty = variantQtyMap.get(item.variant_id) ?? 0;
      if (itemQty <= 0) continue;

      for (const ii of variant.inventory_items ?? []) {
        const requiredQty = asNumber(ii.required_quantity) || 1;
        const qty = MathBN.mult(requiredQty, itemQty).toNumber();

        inventoryItemIds.push(ii.inventory_item_id);
        reservationItems.push({
          line_item_id: item.id,
          inventory_item_id: ii.inventory_item_id,
          quantity: qty,
          allow_backorder: variant.allow_backorder ?? false,
          location_id: locationId,
        });
      }
    }

    if (!reservationItems.length) {
      return new StepResponse([], { reservationIds: [], inventoryItemIds: [] });
    }

    // 6. Create reservations under lock
    const inventoryService = container.resolve(Modules.INVENTORY);
    const locking = container.resolve(Modules.LOCKING);

    const lockingKeys: string[] = Array.from(new Set(inventoryItemIds));
    const reservations: any[] = await locking.execute(lockingKeys, async () => {
      return await inventoryService.createReservationItems(reservationItems);
    });

    const createdReservations = Array.isArray(reservations)
      ? reservations
      : [reservations];

    return new StepResponse(createdReservations, {
      reservationIds: createdReservations.map((r: any) => r.id),
      inventoryItemIds,
    });
  },
  // Compensation: delete reservations created by this step
  async (data, { container }) => {
    const compensationData = data as CompensationData;
    if (!compensationData?.reservationIds?.length) return;

    const inventoryService = container.resolve(Modules.INVENTORY);
    const locking = container.resolve(Modules.LOCKING);
    const lockingKeys: string[] = Array.from(
      new Set(compensationData.inventoryItemIds),
    );

    await locking.execute(lockingKeys, async () => {
      await inventoryService.deleteReservationItems(
        compensationData.reservationIds,
      );
    });
  },
);
