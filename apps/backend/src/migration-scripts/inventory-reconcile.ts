// @ts-nocheck — migration script, not application code
import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils";
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows";

const TARGET_STOCK_LOCATION = "Default Stock Location (Test)";
const STOCKED_QTY = 50;

export default async function inventory_reconcile({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const productService = container.resolve(ModuleRegistrationName.PRODUCT);
  const inventoryService = container.resolve(ModuleRegistrationName.INVENTORY);

  // 1. Find target stock location
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
    filters: { name: TARGET_STOCK_LOCATION },
  });
  const locationId = locations[0].id;
  logger.info(`Target Stock Location: ${locationId} (${TARGET_STOCK_LOCATION})`);

  // 2. Get test-batch variants
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "variants.id", "variants.sku", "variants.title", "variants.manage_inventory", "variants.inventory_items.inventory_item_id"],
    filters: { handle: [
      "pilot-bl-g2-10-black-g2-tb", "pilot-bls-g2-10-black-tb", "pilot-bps-30sk-tb",
      "nichiban-tn-tei-tape-glue-tb", "panfix-pct-cellulose-tape-tb",
    ]},
  });

  const allVariants: Array<{ id: string; sku: string; product_title: string }> = [];
  for (const p of products) {
    for (const v of p.variants) {
      allVariants.push({ id: v.id, sku: v.sku, product_title: p.title });
    }
  }
  logger.info(`Found ${allVariants.length} test-batch variants`);

  // 3. Enable manage_inventory
  for (const v of allVariants) {
    await productService.updateProductVariants(v.id, { manage_inventory: true });
  }
  logger.info("manage_inventory enabled on all variants");

  // 4. Create inventory items (idempotent — skip if already exists)
  const invItemIds: string[] = [];
  for (const v of allVariants) {
    // Check if variant already has linked inventory items
    const { data: existing } = await query.graph({
      entity: "variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: v.id },
    });

    const existingItems = existing[0]?.inventory_items ?? [];
    if (existingItems.length > 0) {
      const id = existingItems[0].inventory_item_id;
      invItemIds.push(id);
      logger.info(`  Already linked: ${v.sku} → ${id}`);
      continue;
    }

    // Check if inventory item with this SKU exists (orphaned from prior partial runs)
    const { data: orphanedItems } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "sku"],
      filters: { sku: v.sku },
    });

    let itemId: string;
    if (orphanedItems.length > 0) {
      itemId = orphanedItems[0].id;
      logger.info(`  Reusing orphaned: ${v.sku} → ${itemId}`);
    } else {
      const item = await inventoryService.createInventoryItems({ sku: v.sku });
      itemId = item.id;
      logger.info(`  Created: ${v.sku} → ${itemId}`);
    }

    // Link inventory item to variant (idempotent)
    try {
      await link.create({
        [Modules.PRODUCT]: { variant_id: v.id },
        [Modules.INVENTORY]: { inventory_item_id: itemId },
      });
    } catch (e: any) {
      if (!e.message?.includes("already exists")) throw e;
    }
    invItemIds.push(itemId);
  }

  // 5. Create inventory levels (idempotent — skip if already exists at this location)
  const { data: existingLevels } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id"],
    filters: { location_id: locationId },
  });
  const existingItemIds = new Set(existingLevels.map((l: any) => l.inventory_item_id));
  const newItemIds = invItemIds.filter((id) => !existingItemIds.has(id));

  if (newItemIds.length > 0) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: newItemIds.map((id) => ({
          location_id: locationId,
          stocked_quantity: STOCKED_QTY,
          inventory_item_id: id,
        })),
      },
    });
    logger.info(`Created ${newItemIds.length} new inventory levels`);
  } else {
    logger.info("All inventory levels already exist — skipping");
  }

  logger.info("============================================");
  logger.info("Inventory reconciliation complete.");
  logger.info(`  Location: ${TARGET_STOCK_LOCATION} (${locationId})`);
  logger.info(`  Variants: ${allVariants.length}`);
  logger.info(`  Inventory items created: ${invItemIds.length}`);
  logger.info(`  Stocked quantity: ${STOCKED_QTY} each`);
  logger.info("============================================");
}
