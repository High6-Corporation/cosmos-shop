import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Text } from "@medusajs/ui";
import type { DetailWidgetProps, AdminUser } from "@medusajs/framework/types";
import { useQuery } from "@tanstack/react-query";
import { sdk } from "../lib/client";

/**
 * Widget injected at `user.details.after` that displays the current user's
 * assigned RBAC roles on the individual user detail page.
 *
 * Medusa's built-in `UserGeneralSection` (user-detail.tsx) shows only email
 * and name — no role information. The permission section is explicitly
 * disabled via `detailPageDefaultEntries(user, { permissions: false })`.
 * This widget fills that gap.
 *
 * Uses the `data` prop (the AdminUser from the detail page) to know which
 * user we're viewing, then fetches full role details from the API.
 */

interface RoleDetail {
  id: string;
  name: string;
  description?: string;
}

interface UserWithRoles extends AdminUser {
  rbac_roles?: RoleDetail[];
}

const UserDetailRolesWidget = ({
  data: user,
}: DetailWidgetProps<AdminUser>) => {
  const { data: roles, isPending } = useQuery({
    queryKey: ["user-roles", user.id],
    queryFn: async () => {
      // Fetch the user with rbac_roles relation expanded
      const res = await sdk.client.fetch<{ user: UserWithRoles }>(
        `/admin/users/${user.id}?fields=id,email,rbac_roles.*`,
      );
      return res.user?.rbac_roles ?? [];
    },
    staleTime: 60 * 1000,
  });

  if (isPending || !roles) {
    return null;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Roles
        </Text>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {roles.length} assigned
        </Text>
      </div>
      <div className="px-6 py-4">
        {roles.length > 0 ? (
          <div className="flex flex-col gap-y-3">
            {roles.map((role) => (
              <div key={role.id} className="flex flex-col gap-y-1">
                <div className="flex items-center gap-x-2">
                  <span className="bg-ui-tag-neutral-bg text-ui-tag-neutral-text border-ui-tag-neutral-border txt-compact-xsmall inline-flex items-center rounded-md border px-2 py-0.5">
                    {role.name}
                  </span>
                </div>
                {role.description && (
                  <Text
                    size="small"
                    leading="compact"
                    className="text-ui-fg-subtle"
                  >
                    {role.description}
                  </Text>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            No roles assigned. This user has default read-only access.
          </Text>
        )}
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "user.details.after",
});

export default UserDetailRolesWidget;
