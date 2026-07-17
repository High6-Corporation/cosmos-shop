/**
 * Smoke test: rbac-sidebar-filter.tsx module load.
 *
 * The single job of this test is catching the exact class of bug from the
 * v7→v8 regression session — orphaned code at module scope, undefined
 * references, syntax errors — at import time, before any browser round-trip.
 *
 * Two sessions ago a syntax mistake (function body orphaned at module scope)
 * shipped silently through a green test suite because no test imported this
 * file. The bug was only caught by manual browser testing. This test closes
 * that gap.
 *
 * HOW IT WORKS: the static import below goes through Jest's @swc/jest
 * transform pipeline. If the module's top-level code throws (orphaned
 * function body, undefined reference, syntax error), the import itself fails
 * and the entire test suite fails to load — which IS the test. The explicit
 * assertions on `default` and `config` are secondary: they confirm the module
 * loaded and its exports have the expected shape, but the primary guard is
 * the import itself.
 *
 * This does NOT test widget behaviour — that's browser verification's job.
 * Mocks are deliberately minimal, just enough to let the module load in a
 * Node test environment.
 */

// ---- mocks (jest hoists these above the static import) ----

jest.mock("@medusajs/admin-sdk", () => ({
  defineWidgetConfig: (cfg: unknown) => cfg,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

jest.mock("react", () => {
  const react = jest.requireActual("react");
  return {
    ...react,
    useEffect: jest.fn((fn: () => void) => fn()),
    useRef: jest.fn(() => ({ current: null })),
  };
});

jest.mock("react-router-dom", () => ({
  useNavigate: jest.fn(() => jest.fn()),
}));

jest.mock("../../lib/client", () => ({
  sdk: {
    client: {
      fetch: jest.fn(() => Promise.resolve({ user: { id: "test-user" } })),
    },
  },
}));

jest.mock("../../lib/nav-permissions", () => ({
  computeHiddenActionRoutes: jest.fn(() => []),
  computeHiddenRoutes: jest.fn(() => []),
  computeResourcesWithoutDelete: jest.fn(() => []),
  computeSettingsLandingPage: jest.fn(() => "/settings/store"),
}));

// ---- static import — this IS the primary assertion ----

import SidebarFilterWidget, { config } from "../rbac-sidebar-filter";

// ---- secondary assertions (module shape) ----

describe("rbac-sidebar-filter module load", () => {
  it("exports a default component function", () => {
    // If we got here, the module loaded without throwing — that's the
    // smoke-test win. This assertion just confirms the export shape.
    expect(typeof SidebarFilterWidget).toBe("function");
  });

  it("exports a widget config with zone topbar", () => {
    expect(config).toBeDefined();
    expect(config.zone).toBe("topbar");
  });
});
