import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Text } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { sdk } from "../lib/client";

/**
 * Widget injected at `user.list.after` that displays role assignments for
 * each user in a compact card below the built-in Users table.
 *
 * Medusa's official admin dashboard (v2.15.5) does not surface role data
 * on the user list page — columns are limited to email, first_name, last_name,
 * created_at, and updated_at. This widget queries users with the `rbac_roles`
 * relation and renders a simple email → role(s) mapping.
 */

interface UserWithRoles {
  id: string;
  email: string;
  rbac_roles?: { id: string; name: string }[];
}

const UserListRolesWidget = () => {
  const { data, isPending, isError } = useQuery({
    queryKey: ["users-with-roles"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{ users: UserWithRoles[] }>(
        "/admin/users?fields=id,email,rbac_roles.*&limit=50",
      );
      return res.users ?? [];
    },
    staleTime: 60 * 1000,
  });

  if (isError || !data?.length) {
    return null;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Role Assignments
        </Text>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {data.length} user{data.length !== 1 ? "s" : ""}
        </Text>
      </div>
      {isPending ? (
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Loading…
          </Text>
        </div>
      ) : (
        <div className="px-6 py-4">
          <div className="flex flex-col gap-y-2">
            {data.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-x-4"
              >
                <Text size="small" leading="compact" className="truncate">
                  {user.email}
                </Text>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {user.rbac_roles?.length ? (
                    user.rbac_roles.map((role) => (
                      <span
                        key={role.id}
                        className="bg-ui-tag-neutral-bg text-ui-tag-neutral-text border-ui-tag-neutral-border text-ui-tag-neutral-icon txt-compact-xsmall inline-flex items-center rounded-md border px-2 py-0.5"
                      >
                        {role.name}
                      </span>
                    ))
                  ) : (
                    <Text
                      size="small"
                      leading="compact"
                      className="text-ui-fg-subtle"
                    >
                      No role
                    </Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "user.list.after",
});

export default UserListRolesWidget;
