// @ts-nocheck — migration script, not application code
import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function cleanup_test_batch({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const handles = [
    "pilot-bl-g2-10-black-g2",
    "pilot-bls-g2-10-black",
    "pilot-bps-30sk",
    "nichiban-tn-tei-tape-glue",
    "panfix-pct-cellulose-tape",
  ];

  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title"],
    filters: { handle: handles },
  });

  if (data.length === 0) {
    logger.info("No test-batch products to clean up.");
    return;
  }

  const productService = container.resolve("product");
  for (const p of data) {
    await productService.deleteProducts(p.id);
    logger.info(`Deleted: ${p.title}`);
  }
  logger.info(`Cleaned up ${data.length} products.`);
}
