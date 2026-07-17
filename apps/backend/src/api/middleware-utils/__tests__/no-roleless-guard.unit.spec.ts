/**
 * Unit tests for no-roleless-state enforcement (v12 decision #81).
 *
 * Covers:
 * - inviteRolesRequiredGuard — rejects missing/empty roles, passes on valid
 * - lastRoleRemovalGuard — blocks last-role removal (both user-centric
 *   and role-centric endpoints), allows non-last role removals
 */
import {
  inviteRolesRequiredGuard,
  lastRoleRemovalGuard,
} from "../no-roleless-guard";

// ---------------------------------------------------------------------------
// inviteRolesRequiredGuard
// ---------------------------------------------------------------------------

describe("inviteRolesRequiredGuard", () => {
  function makeReq(body: any) {
    return { validatedBody: body } as any;
  }

  const next = jest.fn();

  beforeEach(() => next.mockClear());

  it("rejects missing roles field", async () => {
    const req = makeReq({ email: "test@example.com" });
    await expect(inviteRolesRequiredGuard(req, {} as any, next)).rejects.toThrow(
      "At least one role is required",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects null roles", async () => {
    const req = makeReq({ email: "test@example.com", roles: null });
    await expect(inviteRolesRequiredGuard(req, {} as any, next)).rejects.toThrow(
      "At least one role is required",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects empty roles array", async () => {
    const req = makeReq({ email: "test@example.com", roles: [] });
    await expect(inviteRolesRequiredGuard(req, {} as any, next)).rejects.toThrow(
      "At least one role is required",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows invite with at least one role", async () => {
    const req = makeReq({ email: "test@example.com", roles: ["role_123"] });
    await inviteRolesRequiredGuard(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lastRoleRemovalGuard — user-centric endpoint
// ---------------------------------------------------------------------------

describe("lastRoleRemovalGuard (user-centric)", () => {
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  function makeUserReq(params: any, body?: any) {
    return {
      params,
      validatedBody: body ?? {},
      originalUrl: "/admin/users/" + (params.id ?? "user_1") + "/roles",
      url: "/admin/users/" + (params.id ?? "user_1") + "/roles",
      scope: {
        resolve: jest.fn().mockReturnValue({
          graph: jest.fn().mockResolvedValue({
            data: [
              {
                id: params.id ?? "user_1",
                rbac_roles: [{ id: "role_A" }],
              },
            ],
          }),
        }),
      },
    } as any;
  }

  it("allows removal when other roles remain (bulk)", async () => {
    const req = makeUserReq(
      { id: "user_1" },
      { roles: ["role_A"] },
    ) as any;
    // Pretend user has 2 roles, removing one leaves 1
    (req.scope.resolve as jest.Mock).mockReturnValue({
      graph: jest.fn().mockResolvedValue({
        data: [{ id: "user_1", rbac_roles: [{ id: "role_A" }, { id: "role_B" }] }],
      }),
    });
    await lastRoleRemovalGuard(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects when removal would leave zero roles (bulk)", async () => {
    const req = makeUserReq(
      { id: "user_1" },
      { roles: ["role_A"] },
    ) as any;
    await expect(lastRoleRemovalGuard(req, {} as any, next)).rejects.toThrow(
      "Cannot remove the last role",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects single role deletion leaving zero roles", async () => {
    const req = {
      params: { id: "user_1", role_id: "role_A" },
      validatedBody: {},
      originalUrl: "/admin/users/user_1/roles/role_A",
      url: "/admin/users/user_1/roles/role_A",
      scope: {
        resolve: jest.fn().mockReturnValue({
          graph: jest.fn().mockResolvedValue({
            data: [{ id: "user_1", rbac_roles: [{ id: "role_A" }] }],
          }),
        }),
      },
    } as any;
    await expect(lastRoleRemovalGuard(req, {} as any, next)).rejects.toThrow(
      "Cannot remove the last role",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows single role deletion when other roles remain", async () => {
    const req = {
      params: { id: "user_1", role_id: "role_A" },
      validatedBody: {},
      originalUrl: "/admin/users/user_1/roles/role_A",
      url: "/admin/users/user_1/roles/role_A",
      scope: {
        resolve: jest.fn().mockReturnValue({
          graph: jest.fn().mockResolvedValue({
            data: [{ id: "user_1", rbac_roles: [{ id: "role_A" }, { id: "role_B" }] }],
          }),
        }),
      },
    } as any;
    await lastRoleRemovalGuard(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lastRoleRemovalGuard — role-centric endpoint
// ---------------------------------------------------------------------------

describe("lastRoleRemovalGuard (role-centric)", () => {
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  function makeRoleReq(body?: any) {
    return {
      params: { id: "role_A" },
      validatedBody: body ?? { users: ["user_1"] },
      originalUrl: "/admin/rbac/roles/role_A/users",
      url: "/admin/rbac/roles/role_A/users",
      scope: {
        resolve: jest.fn().mockReturnValue({
          graph: jest.fn().mockResolvedValue({
            data: [{ id: "user_1", rbac_roles: [{ id: "role_A" }] }],
          }),
        }),
      },
    } as any;
  }

  it("rejects role-centric removal leaving zero roles", async () => {
    const req = makeRoleReq();
    await expect(lastRoleRemovalGuard(req, {} as any, next)).rejects.toThrow(
      "Cannot remove the last role",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows role-centric removal when other roles remain", async () => {
    const req = makeRoleReq({ users: ["user_1"] });
    // Override the resolve mock to return multi-role user
    (req.scope.resolve as jest.Mock).mockReturnValue({
      graph: jest.fn().mockResolvedValue({
        data: [{ id: "user_1", rbac_roles: [{ id: "role_A" }, { id: "role_B" }] }],
      }),
    });
    await lastRoleRemovalGuard(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through when no user ids in body", async () => {
    const req = makeRoleReq({});
    await lastRoleRemovalGuard(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});
