import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Text } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { sdk } from "../lib/client";

/**
 * Collapsible role reference injected at `user.list.before` (Settings → Users).
 * Shows a one-line summary; click to expand and see what each role can do.
 */

interface RoleInfo {
  id: string;
  name: string;
  description?: string;
}

const BENCHED = [
  "Operations Manager",
  "Catalog / Product Manager",
  "Marketing",
];

const RoleCapabilityGuideWidget = () => {
  const [open, setOpen] = useState(false);

  const { data: roles } = useQuery({
    queryKey: ["rbac-role-capability-guide"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{ roles: RoleInfo[] }>(
        "/admin/rbac/roles?limit=50&fields=id,name,description",
      );
      return res.roles ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });

  if (!roles?.length) return null;

  return (
    <Container className="p-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-ui-bg-base-hover"
      >
        <Text size="small" leading="compact" weight="plus">
          {open ? "▾" : "▸"} Role Capability Guide ({roles.length} roles)
        </Text>
      </button>
      {open && (
        <div className="flex flex-col gap-y-2 border-t px-4 py-3">
          {roles.map((role) => (
            <div key={role.id}>
              <Text size="small" leading="compact" weight="plus">
                {role.name}
                {BENCHED.includes(role.name) && (
                  <Text
                    size="xsmall"
                    leading="compact"
                    className="ml-2 text-ui-tag-orange-text"
                    as="span"
                  >
                    (not yet available)
                  </Text>
                )}
              </Text>
              <Text
                size="xsmall"
                leading="compact"
                className="text-ui-fg-subtle"
              >
                {role.description || "No description available."}
              </Text>
            </div>
          ))}
        </div>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "user.list.before",
});

export default RoleCapabilityGuideWidget;
