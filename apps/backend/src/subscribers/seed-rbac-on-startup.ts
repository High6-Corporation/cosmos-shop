/**
 * Subscriber: seed RBAC data on user creation (fallback).
 *
 * Dual-trigger design (#87):
 *   1. onApplicationStart — rbac-seed module (primary, every boot)
 *   2. UserWorkflowEvents.CREATED — this subscriber (fallback, every
 *      user creation)
 *
 * The primary startup seed runs via the rbac-seed module's lifecycle hook,
 * which guarantees a fully-initialised container. This subscriber catches
 * any user created after boot — e.g. new admin accounts created via the
 * dashboard Invite flow, or migration scripts creating users.
 *
 * The seed logic itself lives in utils/seed-rbac-core.ts (template-owned).
 * Role definitions are in utils/seed-rbac-roles.ts (client-owned).
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { UserWorkflowEvents } from "@medusajs/framework/utils";
import { seedRbacData } from "../utils/seed-rbac-core";
import {
  ROLE_DEFINITIONS,
  BOOTSTRAP_USER_ROLES,
} from "../utils/seed-rbac-roles";

export default async function handleUserCreated({ container }: SubscriberArgs) {
  await seedRbacData(container, ROLE_DEFINITIONS, BOOTSTRAP_USER_ROLES);
}

export const config: SubscriberConfig = {
  event: UserWorkflowEvents.CREATED,
};
