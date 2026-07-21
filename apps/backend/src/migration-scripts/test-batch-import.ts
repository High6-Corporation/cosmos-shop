// @ts-nocheck — migration script, not application code
import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  createProductOptionsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  createInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Test-batch product import for Cosmos Shop.
 *
 * Creates a provisional PHP region + stock location (if none exists), then
 * imports a small subset of the WooCommerce product CSV:
 *
 *   Simple (3):
 *     P-BL-G2-10-B   - Pilot BL-G2-10 Black G-2 Ball Pen             (PHP 69.00)
 *     P-BLS-G2-10-B  - Pilot BLS-G2-10 Black Ball Pen G-2 1.0 Refill (PHP 46.50)
 *     P-BPS-30SK     - Pilot BPS-30SK Ball Pen                        (PHP 174.00)
 *
 *   Variable (2 families, 13 variations total):
 *     N-TN-TEI       - Nichiban TN-TEI Ichioshi Tape Glue              (6 COLOR variants)
 *     N-PCT          - Panfix PCT Cellulose Tape                       (7 SIZE variants)
 *
 * Mappings applied:
 *   - Currency:  PHP (provisional — swap once client confirms)
 *   - Brand:     attribute-slot "Brand" → product.type_id (ProductType)
 *   - Images:    live shop.cosmos-bazar.com URLs (as-is)
 *   - Stock:     manage_inventory: false for all (no tracked quantities in batch)
 *   - Attribute: import as-is (no normalization, per current instruction)
 */

export default async function test_batch_import({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  // ------------------------------------------------------------------
  // Step 0: Scaffold — store, region, stock location (idempotent-ish)
  // ------------------------------------------------------------------

  // Check whether a store already exists
  let { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_currency_code", "default_sales_channel_id"],
  });

  let store = stores[0];

  if (!store) {
    logger.info("No store found — creating provisional store (PHP)…");

    // Sales channel
    const { result: [sc] } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          { name: "Default Sales Channel", description: "Created by test-batch-import" },
        ],
      },
    });

    // Store with PHP as default
    const { result: [newStore] } = await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "Cosmos Shop (Test)",
            supported_currencies: [
              { currency_code: "php", is_default: true },
              { currency_code: "usd", is_default: false },
            ],
            default_sales_channel_id: sc.id,
          },
        ],
      },
    });
    store = newStore;
    logger.info(`Store created: ${store.id}`);
  } else {
    logger.info(`Store exists: ${store.id} (default currency: ${store.default_currency_code})`);
  }

  // Check whether a PHP region already exists (seed may have created EUR only)
  let { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  });

  let region = regions.find((r: any) => r.currency_code === "php");

  if (!region) {
    logger.info("No PHP region found — creating provisional PHP region…");
    const { result: [r] } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Philippines (Provisional)",
            currency_code: "php",
            countries: ["ph"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    region = r;

    // Tax region for PH
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "ph", provider_id: "tp_system" }],
    });

    logger.info(`PHP region created: ${region.id}`);
  } else {
    logger.info(`PHP region exists: ${region.id} (${region.name})`);
  }

  // Check whether a stock location exists
  let { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });

  let stockLocation = stockLocations[0];

  if (!stockLocation) {
    logger.info("No stock location found — creating provisional location…");
    const { result: [sl] } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "Default Warehouse (Test)",
            address: {
              city: "Manila",
              country_code: "PH",
              address_1: "",
            },
          },
        ],
      },
    });
    stockLocation = sl;

    // Link to sales channel
    if (store.default_sales_channel_id) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocation.id, add: [store.default_sales_channel_id] },
      });
    }

    logger.info(`Stock location created: ${stockLocation.id}`);
  } else {
    logger.info(`Stock location exists: ${stockLocation.id} (${stockLocation.name})`);
  }

  // ------------------------------------------------------------------
  // Step 1: Ensure categories exist
  // ------------------------------------------------------------------
  const categoryTitles = [
    "Roller Ball Pen/Gel Pen",
    "Refill",
    "Ballpoint Pen",
    "Tape Glue",
    "Cellulose Tape",
  ];

  const existingCats = (await query.graph({ entity: "product_category", fields: ["id", "name"] })).data;
  const catMap = new Map(existingCats.map((c: any) => [c.name, c.id]));

  const missingCats = categoryTitles.filter((t) => !catMap.has(t));
  if (missingCats.length > 0) {
    const { result: newCats } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingCats.map((name) => ({ name, is_active: true })),
      },
    });
    for (const c of newCats) catMap.set(c.name, c.id);
    logger.info(`Categories created: ${missingCats.join(", ")}`);
  }

  // ------------------------------------------------------------------
  // Step 2: Ensure product options exist (import as-is, no normalization)
  // ------------------------------------------------------------------
  const optionDefs = [
    { title: "COLOR", values: ["Aqua", "Blue", "Cherry", "Green", "Lemon", "Red"] },
    {
      title: "SIZE",
      values: [
        "12mm x 9m (C1)",
        "12mm x 33m (C1)",
        "12mm x 33m (C3)",
        "19mm x 33m (C1)",
        "19mm x 33m (C3)",
        "25mm x 33m (C1)",
        "25mm x 33m (C3)",
      ],
    },
  ];

  const existingOpts = (await query.graph({ entity: "product_option", fields: ["id", "title"] })).data;
  const optIdMap = new Map(existingOpts.map((o: any) => [o.title, o.id]));

  for (const def of optionDefs) {
    if (!optIdMap.has(def.title)) {
      const { result: [created] } = await createProductOptionsWorkflow(container).run({
        input: { product_options: [def] },
      });
      optIdMap.set(def.title, created.id);
      logger.info(`Product option created: ${def.title}`);
    }
  }

  // Ensure a "Default" option exists for simple products (Medusa requires options on ALL products)
  const DEFAULT_OPT_TITLE = "Default Option";
  if (!optIdMap.has(DEFAULT_OPT_TITLE)) {
    const { result: [created] } = await createProductOptionsWorkflow(container).run({
      input: { product_options: [{ title: DEFAULT_OPT_TITLE, values: ["Default"] }] },
    });
    optIdMap.set(DEFAULT_OPT_TITLE, created.id);
    logger.info(`Product option created: ${DEFAULT_OPT_TITLE}`);
  }
  const defaultOptId = optIdMap.get(DEFAULT_OPT_TITLE)!;

  // ------------------------------------------------------------------
  // Step 3: Create products
  // ------------------------------------------------------------------

  // 3a: Simple products (with mandatory Default Option)
  const simpleProducts = [
    {
      title: "Pilot BL-G2-10 Black G-2 Ball Pen",
      handle: "pilot-bl-g2-10-black-g2-tb",
      sku: "P-BL-G2-10-B-TB",
      price: 69.0,
      category: "Roller Ball Pen/Gel Pen",
      type: "Pilot",
      images: [
        "https://shop.cosmos-bazar.com/wp-content/uploads/2020/12/P-BL-G2-10-B.jpg",
        "https://shop.cosmos-bazar.com/wp-content/uploads/2020/12/P-BL-G2-10-B-2.jpg",
      ],
    },
    {
      title: "Pilot BLS-G2-10 Black Ball Pen G-2 1.0 Refill",
      handle: "pilot-bls-g2-10-black-tb",
      sku: "P-BLS-G2-10-B-TB",
      price: 46.5,
      category: "Refill",
      type: "Pilot",
      images: [
        "https://shop.cosmos-bazar.com/wp-content/uploads/2020/12/P-BLS-G2-10-B.jpg",
      ],
    },
    {
      title: "Pilot BPS-30SK Ball Pen",
      handle: "pilot-bps-30sk-tb",
      sku: "P-BPS-30SK-TB",
      price: 174.0,
      category: "Ballpoint Pen",
      type: "Pilot",
      images: [
        "https://shop.cosmos-bazar.com/wp-content/uploads/2020/12/P-BPS-30SK.jpg",
      ],
    },
  ];

  logger.info("Creating 3 simple products…");
  const { result: createdSimples } = await createProductsWorkflow(container).run({
    input: {
      products: simpleProducts.map((p) => ({
        title: p.title,
        handle: p.handle,
        status: ProductStatus.PUBLISHED,
        type_id: null, // Will set via metadata below — ProductType needs separate handling
        images: p.images.map((url) => ({ url })),
        category_ids: [catMap.get(p.category)!],
        // Medusa requires options on ALL products — use Default Option for simples
        options: [{ id: defaultOptId }],
        variants: [
          {
            title: p.title,
            sku: p.sku,
            manage_inventory: false,
            allow_backorder: false,
            options: { [DEFAULT_OPT_TITLE]: "Default" },
            prices: [{ amount: p.price, currency_code: "php" }],
          },
        ],
        sales_channels: [{ id: store.default_sales_channel_id }],
        metadata: {
          woocommerce_id: null,
          brand: p.type, // Store brand in metadata for now; ProductType migration later
        },
      })),
    },
  });
  logger.info(`Simple products created: ${createdSimples.length}`);

  // 3b: Variable product — N-TN-TEI (COLOR variants)
  const ntnTeiColorOptId = optIdMap.get("COLOR")!;

  const ntnTeiVariants = [
    { title: "Nichiban TN-TEI Ichioshi Tape Glue - Aqua",   sku: "N-TN-TEI-TB-A", option: "Aqua",   price: 136 },
    { title: "Nichiban TN-TEI Ichioshi Tape Glue - Blue",   sku: "N-TN-TEI-TB-B", option: "Blue",   price: 136 },
    { title: "Nichiban TN-TEI Ichioshi Tape Glue - Cherry", sku: "N-TN-TEI-TB-C", option: "Cherry", price: 136 },
    { title: "Nichiban TN-TEI Ichioshi Tape Glue - Green",  sku: "N-TN-TEI-TB-D", option: "Green",  price: 136 },
    { title: "Nichiban TN-TEI Ichioshi Tape Glue - Lemon",  sku: "N-TN-TEI-TB-E", option: "Lemon",  price: 136 },
    { title: "Nichiban TN-TEI Ichioshi Tape Glue - Red",    sku: "N-TN-TEI-TB-F", option: "Red",    price: 136 },
  ];

  logger.info("Creating variable product: N-TN-TEI (6 COLOR variants)…");
  const { result: [ntnTei] } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Nichiban TN-TEI Ichioshi Tape Glue",
          handle: "nichiban-tn-tei-tape-glue-tb",
          status: ProductStatus.PUBLISHED,
          category_ids: [catMap.get("Tape Glue")!],
          images: [{ url: "https://shop.cosmos-bazar.com/wp-content/uploads/2020/12/N-TN-TEIR.jpg" }],
          options: [{ id: ntnTeiColorOptId }],
          variants: ntnTeiVariants.map((v) => ({
            title: v.title,
            sku: v.sku,
            manage_inventory: false,
            allow_backorder: false,
            prices: [{ amount: v.price, currency_code: "php" }],
            options: { COLOR: v.option },
          })),
          sales_channels: [{ id: store.default_sales_channel_id }],
          metadata: {
            brand: "Panfix",
            woocommerce_parent_sku: "N-TN-TEI",
          },
        },
      ],
    },
  });
  logger.info(`N-TN-TEI created: ${ntnTei.id} (${ntnTeiVariants.length} variants)`);

  // 3c: Variable product — N-PCT (SIZE variants)
  const nPctSizeOptId = optIdMap.get("SIZE")!;

  const nPctVariants = [
    { title: "Panfix PCT Cellulose Tape - 12mm x 9m (C1)",   sku: "N-PCT-TB129C1", option: "12mm x 9m (C1)",   price: 35.75 },
    { title: "Panfix PCT Cellulose Tape - 12mm x 33m (C1)",  sku: "N-PCT-TB1233C1", option: "12mm x 33m (C1)",  price: 35.75 },
    { title: "Panfix PCT Cellulose Tape - 12mm x 33m (C3)",  sku: "N-PCT-TB1233C3", option: "12mm x 33m (C3)",  price: 39 },
    { title: "Panfix PCT Cellulose Tape - 19mm x 33m (C1)",  sku: "N-PCT-TB1933C1", option: "19mm x 33m (C1)",  price: 57 },
    { title: "Panfix PCT Cellulose Tape - 19mm x 33m (C3)",  sku: "N-PCT-TB1933C3", option: "19mm x 33m (C3)",  price: 57 },
    { title: "Panfix PCT Cellulose Tape - 25mm x 33m (C1)",  sku: "N-PCT-TB2533C1", option: "25mm x 33m (C1)",  price: 70 },
    { title: "Panfix PCT Cellulose Tape - 25mm x 33m (C3)",  sku: "N-PCT-TB2533C3", option: "25mm x 33m (C3)",  price: 70 },
  ];

  logger.info("Creating variable product: N-PCT (7 SIZE variants)…");
  const { result: [nPct] } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Panfix PCT Cellulose Tape",
          handle: "panfix-pct-cellulose-tape-tb",
          status: ProductStatus.PUBLISHED,
          category_ids: [catMap.get("Cellulose Tape")!],
          images: [{ url: "https://shop.cosmos-bazar.com/wp-content/uploads/2020/12/N-PCT-1233C1.jpg" }],
          options: [{ id: nPctSizeOptId }],
          variants: nPctVariants.map((v) => ({
            title: v.title,
            sku: v.sku,
            manage_inventory: false,
            allow_backorder: false,
            prices: [{ amount: v.price, currency_code: "php" }],
            options: { SIZE: v.option },
          })),
          sales_channels: [{ id: store.default_sales_channel_id }],
          metadata: {
            brand: "Panfix",
            woocommerce_parent_sku: "N-PCT",
          },
        },
      ],
    },
  });
  logger.info(`N-PCT created: ${nPct.id} (${nPctVariants.length} variants)`);

  // ------------------------------------------------------------------
  // Step 4: Skip inventory level seeding — all test products use manage_inventory: false
  // and the seed data already handled inventory for any pre-existing items.
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Done
  // ------------------------------------------------------------------
  logger.info("============================================");
  logger.info("Test-batch import complete.");
  logger.info(`  Store:     ${store.id} (${(store as any).default_currency_code || "php"})`);
  logger.info(`  Region:    ${region!.id} (${region!.name}, ${region!.currency_code})`);
  logger.info(`  Warehouse: ${stockLocation?.id}`);
  logger.info(`  Products:  ${createdSimples.length} simple, 2 variable (${ntnTeiVariants.length + nPctVariants.length} variations total)`);
  logger.info("============================================");
}
