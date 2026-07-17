import { defineMiddlewares } from "@medusajs/framework/http";
import { marketplaceOrderMiddlewares } from "./webhooks/marketplace/orders/middlewares";
import { rbacGuard } from "./middleware-utils/rbac-guard";
import {
  inviteRolesRequiredGuard,
  lastRoleRemovalGuard,
  assignableRoleGuard,
  filterAssignableResponseGuard,
} from "./middleware-utils/no-roleless-guard";

export default defineMiddlewares({
  routes: [
    // RBAC enforcement on all admin routes
    {
      matcher: "/admin/*",
      middlewares: [rbacGuard],
    },
    // No-roleless-state enforcement (decision #81)
    {
      matcher: "/admin/invites",
      method: ["POST"],
      middlewares: [inviteRolesRequiredGuard],
    },
    // Filter benched roles from the assignable-list response (dropdown source)
    {
      matcher: "/admin/rbac/roles/assignable",
      method: ["GET"],
      middlewares: [filterAssignableResponseGuard],
    },
    // Block assignment of benched (not-yet-verified) roles
    {
      matcher: "/admin/users/:id/roles",
      method: ["POST"],
      middlewares: [assignableRoleGuard],
    },
    {
      matcher: "/admin/rbac/roles/:id/users",
      method: ["POST"],
      middlewares: [assignableRoleGuard],
    },
    // User-centric role removal (bulk) — last-role guard
    {
      matcher: "/admin/users/:id/roles",
      method: ["DELETE"],
      middlewares: [lastRoleRemovalGuard],
    },
    // User-centric role removal (single role) — last-role guard
    {
      matcher: "/admin/users/:id/roles/:role_id",
      method: ["DELETE"],
      middlewares: [lastRoleRemovalGuard],
    },
    // Role-centric user removal (Settings → Roles UI) — last-role guard
    {
      matcher: "/admin/rbac/roles/:id/users",
      method: ["DELETE"],
      middlewares: [lastRoleRemovalGuard],
    },
    ...marketplaceOrderMiddlewares,
  ],
});
