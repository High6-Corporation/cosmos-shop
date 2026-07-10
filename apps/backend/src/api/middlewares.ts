import { defineMiddlewares } from "@medusajs/framework/http";
import { marketplaceOrderMiddlewares } from "./webhooks/marketplace/orders/middlewares";

export default defineMiddlewares({
  routes: [...marketplaceOrderMiddlewares],
});
