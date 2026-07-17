/**
 * RBAC Seed Module — lifecycle-based startup seed.
 *
 * Provides `onApplicationStart` which guarantees:
 * - Fires on every server boot (dev and production)
 * - Container is fully initialised (no setTimeout heuristic)
 * - Runs before any subscriber events
 *
 * The seed itself lives in utils/seed-rbac-core.ts — this module is purely
 * the lifecycle hook that wires it to framework startup.
 *
 * Dual-trigger design (documented #87):
 *   1. onApplicationStart (this module) — every boot
 *   2. UserWorkflowEvents.CREATED subscriber (seed-rbac-on-startup.ts) —
 *      fallback on every user creation
 */

/**
 * RBAC Seed Module — lifecycle-based startup seed.
 *
 * Provides `onApplicationStart` which guarantees:
 * - Fires on every server boot (dev and production)
 * - Container is fully initialised at call time (global singleton,
 *   same mechanism the stale scheduleStartupSeed() used, but hooked
 *   to the framework lifecycle instead of a heuristic setTimeout)
 *
 * The seed itself lives in utils/seed-rbac-core.ts — this module is purely
 * the lifecycle hook that wires it to framework startup.
 *
 * Dual-trigger design (documented #87):
 *   1. onApplicationStart (this module) — every boot
 *   2. UserWorkflowEvents.CREATED subscriber (seed-rbac-on-startup.ts) —
 *      fallback on every user creation
 */

// Global container import — not constructor injection. Model-less custom
// modules don't receive the DI container via constructor; the framework's
// global singleton is the same source the old compiled subscriber used,
// but onApplicationStart guarantees it's populated (unlike setTimeout).
// Ref: TEMPLATE_SYNC.md § Known Framework Quirks, Engram #87/#88.
import { container as globalContainer } from "@medusajs/framework";
import { seedRbacData } from "../../utils/seed-rbac-core";
import {
  ROLE_DEFINITIONS,
  BOOTSTRAP_USER_ROLES,
} from "../../utils/seed-rbac-roles";

export default class RbacSeedModuleService {
  readonly __hooks: { onApplicationStart: () => Promise<void> };

  constructor() {
    this.__hooks = {
      onApplicationStart: async () => {
        await seedRbacData(
          globalContainer,
          ROLE_DEFINITIONS,
          BOOTSTRAP_USER_ROLES,
        );
      },
    };
  }
}
