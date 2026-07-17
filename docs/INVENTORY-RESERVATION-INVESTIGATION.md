# Inventory Reservation Timing: Marketplace vs. Storefront Orders

**Date:** 2026-07-10
**Status:** Investigation complete + implementation complete + end-to-end verified

## Executive Summary

**Reservation timing DOES differ between the two order-creation paths.** The marketplace path (`createOrderWorkflow`) never reserves inventory, while the storefront path (`completeCartWorkflow`) reserves immediately upon order creation. This is a third gap in the `createOrderWorkflow` direct-payload path — the same pattern as the already-fixed payment-collection and order-total bugs.

The original explanation ("Medusa reserves only during fulfillment") was **incorrect**. Reservation happens at order-creation time for ALL standard Medusa order paths. The fulfillment workflow _reads_ existing reservations and updates/deletes them — it does NOT create them. For items with `manage_inventory: true`, the fulfillment workflow will **throw an error** if no reservation exists.

## Evidence

### 1. `completeCartWorkflow` (storefront) — reserves at order creation

**File:** `node_modules/@medusajs/core-flows/dist/cart/workflows/complete-cart.js`, line 484

```javascript
(0, reserve_inventory_1.reserveInventoryStep)(formatedInventoryItems),
```

This calls `inventoryService.createReservationItems()` which:

- Creates `reservation_item` rows in the database
- Updates `reserved_quantity` on inventory levels: `MathBN.add(level.reserved_quantity, adjustment)`

**Source:** `node_modules/@medusajs/inventory/dist/services/inventory-module.js`, lines 115-146

### 2. `createOrderWorkflow` (marketplace) — confirms only, does NOT reserve

**File:** `node_modules/@medusajs/core-flows/dist/order/workflows/create-order.js`, lines 260-266

```javascript
confirm_variant_inventory_1.confirmVariantInventoryWorkflow.runAsStep({
  input: {
    sales_channel_id: salesChannel.id,
    variants,
    items: input.items,
  },
});
```

This calls `confirmVariantInventoryWorkflow` → `confirmInventoryStep` → `inventoryService.confirmInventory()`:

**Source:** `node_modules/@medusajs/inventory/dist/services/inventory-module.js`, lines 447-449

```javascript
async confirmInventory(inventoryItemId, locationIds, quantity, context = {}) {
    const availableQuantity = await this.retrieveAvailableQuantity(inventoryItemId, locationIds, context);
    return MathBN.gte(availableQuantity, quantity);
}
```

This is a **purely read-only check**. It computes `available = stocked - reserved`, compares against the requested quantity, and returns `true`/`false`. It does NOT mutate any database state. No reservations are created.

### 3. `createOrderFulfillmentWorkflow` — requires existing reservations, will throw if missing

**File:** `node_modules/@medusajs/core-flows/dist/order/workflows/create-fulfillment.js`, lines 150-153

```javascript
if (!reservations?.length) {
    if (item.variant?.manage_inventory) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA,
            `No stock reservation found for item ${item.id} - ${item.title} (${item.variant_title})`);
    }
    continue;
}
```

The fulfillment workflow:

1. **Reads** existing reservations for the line items being fulfilled (line 310-323)
2. **Validates** that reservations exist for items with `manage_inventory: true` (line 150-153)
3. **Updates or deletes** reservations based on fulfilled quantity (lines 168-179)
4. Does NOT create new reservations

**This means:** When a marketplace order with `manage_inventory: true` items reaches fulfillment, the fulfillment step will **throw an error and fail** because no reservation was ever created.

### 4. `convertDraftOrderWorkflow` — the other direct-order path DOES reserve

**File:** `node_modules/@medusajs/core-flows/dist/draft-order/workflows/convert-draft-order.js`, line 108

```javascript
(0, cart_1.reserveInventoryStep)(formatedInventoryItems);
```

The draft-order-to-pending-order conversion (the other non-cart order-creation path) also calls `reserveInventoryStep`. This proves `createOrderWorkflow` is the **outlier** — all other order-creation paths reserve inventory at creation time.

### 5. Complete list of `reserveInventoryStep` callers in Medusa core-flows

| Workflow                                | Reserves Inventory? |
| --------------------------------------- | ------------------- |
| `completeCartWorkflow`                  | ✅ Yes (line 484)   |
| `convertDraftOrderWorkflow`             | ✅ Yes (line 108)   |
| `confirmExchangeRequestWorkflow`        | ✅ Yes              |
| `confirmOrderEditRequestWorkflow`       | ✅ Yes              |
| `confirmClaimRequestWorkflow`           | ✅ Yes              |
| **`createOrderWorkflow`** (marketplace) | **❌ No**           |

## Observed Behavior Prediction

Based on the code analysis, testing would show:

| Path                                | `reserved_quantity` after order creation | Fulfillment behavior                                                            |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Storefront (`completeCartWorkflow`) | `> 0` (reserved immediately)             | Works — reservations found, updated/deleted                                     |
| Marketplace (`createOrderWorkflow`) | `0` (never reserved)                     | **Throws "No stock reservation found"** for items with `manage_inventory: true` |

## The Three Gaps in `createOrderWorkflow` Direct-Payload Path

The marketplace path (via `createOrderWorkflow` called with direct payload, no Cart) has three behavioral gaps compared to the standard cart-completion flow:

| #   | Gap                                        | Status   | Fixed In                              |
| --- | ------------------------------------------ | -------- | ------------------------------------- |
| 1   | Payment collection not auto-created        | ✅ Fixed | `steps/create-or-get-order.ts:98-122` |
| 2   | Order totals not refreshed after tax lines | ✅ Fixed | `steps/create-or-get-order.ts:88-93`  |
| 3   | **Inventory not reserved**                 | ✅ Fixed | `steps/reserve-order-inventory.ts`    |

Gap #3 follows the identical pattern as the first two: `createOrderWorkflow` is a lower-level building block that expects callers to handle these concerns. The cart-completion flow handles them because `completeCartWorkflow` orchestrates them explicitly; the marketplace adapter must do the same.

## Implementation

### Files Changed

1. **New:** `apps/backend/src/workflows/marketplace/steps/reserve-order-inventory.ts`
   - Step that queries the created order for line item IDs, queries variant inventory data (`manage_inventory`, `inventory_items`), resolves stock locations for the sales channel, and calls `inventoryService.createReservationItems()`.
   - Compensation handler deletes reservations if the workflow rolls back.
   - Key design decisions:
     - Uses `query.graph()` for variant and channel queries (works for direct module fields and links).
     - **Does NOT query order items for quantity** — `query.graph({ entity: "order" })` doesn't return `quantity` or `raw_quantity` on items. Instead, quantities are passed through from the workflow input (`normalized.items`), avoiding the need for the Remote Query.
     - Stock locations are resolved from the sales channel side (`sales_channel → stock_locations`) — a direct link that `query.graph()` resolves correctly.
     - Inventory item locking (`Modules.LOCKING`) prevents race conditions during reservation creation.

2. **Modified:** `apps/backend/src/workflows/marketplace/create-marketplace-order.ts`
   - Added `when("reserve-inventory")` block that runs `reserveOrderInventoryStep` only for newly created orders (skips idempotent replays).

### Verification Evidence

**Before (pre-fix):**

```
reservations: []  (empty — no reservations created)
reserved_quantity: 0
```

**After (post-fix), order `order_01KX5SPXR5WA5C1Z0J4DK6Y5TR` with quantity 3:**

```
reservation: resitem_01KX5SPXR... qty=3 (matching quantity 3 × required_quantity 1)
reserved_quantity: 10 (3 real + previously accumulated debug reservations)
```

**Fulfillment end-to-end proof:**

```
POST /admin/orders/order_01KX5SPXR5WA5C1Z0J4DK6Y5TR/fulfillments
→ 200 OK — fulfillment created successfully
→ detail.fulfilled_quantity: 3
→ NO "No stock reservation found" error
```

The fulfillment workflow found the existing reservation, updated it, and adjusted inventory levels — exactly as it does for storefront orders.
