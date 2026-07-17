/**
 * Unit tests for rbac-guard self-endpoint bypass (handoff v7 §4.2) and
 * fail-closed roleless enforcement (v12 #81/#82).
 *
 * The bypass must be exactly as narrow as Medusa core's own policy surface:
 * core registers NO policies on GET /admin/users/me (the only /admin/users
 * route without a `policies` array), and the custom GET /admin/me/permissions
 * endpoint must be readable before any policy is known. Everything else —
 * including /admin/users, /admin/users/:id, and the dead /admin/rbac/me/*
 * route — stays policy-checked.
 *
 * The fail-closed test validates that an actor with zero roles is denied
 * before hasPermission() is ever called (decision #81, finding #82).
 */
import { isSelfEndpoint, rbacGuard } from "../rbac-guard";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// Mock the hasPermission import so we can assert it's NOT called for roleless actors
jest.mock("@medusajs/framework", () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

describe("isSelfEndpoint", () => {
  describe("bypassed (own-data reads)", () => {
    it.each([
      ["GET", "/admin/users/me"],
      ["HEAD", "/admin/users/me"],
      ["GET", "/admin/users/me?fields=id,email"],
      ["GET", "/admin/me/permissions"],
      ["GET", "/admin/me/permissions?cache=false"],
    ])("%s %s → true", (method, url) => {
      expect(isSelfEndpoint(method, url)).toBe(true);
    });
  });

  describe("NOT bypassed (policy check still required)", () => {
    it.each([
      // collection / arbitrary-id user reads stay policy-checked
      ["GET", "/admin/users"],
      ["GET", "/admin/users?limit=10"],
      ["GET", "/admin/users/usr_01ABC"],
      // /admin/users/:id/roles with id="me" is a core policied route
      ["GET", "/admin/users/me/roles"],
      // writes are never self-bypassed (no POST /admin/users/me exists in core)
      ["POST", "/admin/users/me"],
      ["DELETE", "/admin/users/me"],
      ["POST", "/admin/me/permissions"],
      // dead route stays policy-checked (removal is a separate task)
      ["GET", "/admin/rbac/me/permissions"],
      // prefix safety: "me" must not match other resources
      ["GET", "/admin/metadata"],
      ["GET", "/admin/mediums"],
    ])("%s %s → false", (method, url) => {
      expect(isSelfEndpoint(method, url)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// rbacGuard — fail-closed for roleless actors (#81 / #82)
// ---------------------------------------------------------------------------

describe("rbacGuard — roleless fail-closed", () => {
  const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };

  // Query returning zero roles for the actor
  const rolelessQuery = {
    graph: jest.fn().mockResolvedValue({
      data: [
        {
          id: "user_zero_roles",
          rbac_roles: [], // ← zero roles
        },
      ],
    }),
  };

  function makeResolve(overrides: Record<string, any> = {}) {
    return (name: string) => {
      if (overrides[name]) return overrides[name];
      if (name === ContainerRegistrationKeys.QUERY) return rolelessQuery;
      if (name === ContainerRegistrationKeys.LOGGER) return mockLogger;
      if (name === ContainerRegistrationKeys.FEATURE_FLAG_ROUTER) {
        return { isFeatureEnabled: () => true };
      }
      throw new Error(`Unexpected resolve: ${name}`);
    };
  }

  it("denies access when actor has zero roles", async () => {
    const req = {
      method: "GET",
      originalUrl: "/admin/products",
      url: "/admin/products",
      auth_context: { actor_id: "user_zero_roles", actor_type: "user" },
      scope: { resolve: makeResolve() },
    } as any;

    await expect(rbacGuard(req, {} as any, jest.fn())).rejects.toThrow(
      "You don't have permission",
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Denied roleless actor"),
    );
  });

  it("warns on roleless actor (log coverage)", async () => {
    const req = {
      method: "GET",
      originalUrl: "/admin/rbac/roles",
      url: "/admin/rbac/roles",
      auth_context: { actor_id: "user_no_roles", actor_type: "user" },
      scope: { resolve: makeResolve() },
    } as any;

    await expect(rbacGuard(req, {} as any, jest.fn())).rejects.toThrow(
      "You don't have permission",
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("user_no_roles"),
    );
  });
});
