import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { sdk } from "../lib/client";
import {
  computeHiddenActionRoutes,
  computeHiddenRoutes,
  computeResourcesWithoutDelete,
  computeSettingsLandingPage,
} from "../lib/nav-permissions";

/**
 * Invisible topbar widget that hides UI the current user has no permission
 * for — for ANY role, derived from the user's real permission set, with no
 * role-name branches or hardcoded nav subsets. Two surfaces:
 *
 * 1. Sidebar nav items (NAV_ROUTE_PERMISSIONS, exact-href match) — Medusa's
 *    dashboard renders all core + settings nav unconditionally; rbacGuard
 *    blocks the API but the items stay visible and deny on click.
 * 2. Write-action links (ACTION_ROUTE_PERMISSIONS, prefix-href match) —
 *    "Create" buttons and Import/Export links on pages the user can read
 *    but not write (e.g. Customer Support on Products).
 *
 * Section headings: any sidebar group whose nav links are ALL hidden (e.g.
 * Settings "General" for Customer Support, "Developer" for Store Owner) is
 * hidden wholesale — structurally, not by matching translated heading text.
 *
 * How visibility is decided (single chain, same data as enforcement):
 *   GET /admin/me/permissions          → the user's real resource:operation
 *   computeHidden(Action)Routes(...)   → routes whose mapped permission is
 *                                        absent (lib/nav-permissions.ts,
 *                                        mirrors the guard's URL_RESOURCE_MAP)
 *
 * History: the first version hardcoded the 3 Developer routes behind an
 * any-of permission gate. That "worked" only because Store Owner — the only
 * role browser-tested at the time — could read everything else; Customer
 * Support exposed the gap, and Store Owner gaining rbac_role:read (§2.4)
 * silently un-hid the Developer items again. Per-item, permission-set-driven
 * filtering fixes the class, not the instance.
 *
 * Known limit — Delete actions (partial fix, b1 MutationObserver strategy):
 *
 * Delete actions are <button> elements inside <ActionMenu> / DataTable
 * dropdowns, not <a> anchors — the CSS-selector-on-href approach used for
 * nav items and create/import/export links cannot target them.
 *
 * b1 (this implementation): the MutationObserver finds [role="menuitem"]
 * elements containing BOTH the label text "Delete" AND an SVG icon, and
 * hides them when the current page's resource lacks delete permission.
 * Resources covered: /products → product:delete, /inventory → inventory_item:delete.
 *
 * b2 (escalation path): if ANY location fails to hide on first real-browser
 * click, escalate that location to a patch-package + usePermissions() check
 * inside the Medusa dashboard source component. Do NOT add increasingly
 * specific selector hacks to force b1 to work. Trigger: Delete still visible
 * in an actual browser after this code ships.
 *
 * Unresolved (follow-up, not covered here): order-detail flows
 * (returns/claims/exchanges/edits/refunds) — these are operational workflow
 * actions, not Delete. Backend enforcement still denies those correctly.
 *
 * Renders nothing visible.
 */

// Admin SPA base paths to try when building href selectors. The project uses
// the default admin path ("/app"); the bare variant covers non-prefixed links.
const BASE_PATHS = ["/app", ""];

const STYLE_ID = "rbac-sidebar-filter";

function buildHideCSS(
  hiddenNavRoutes: string[],
  hiddenActionRoutes: string[],
): string {
  const rules: string[] = [];
  for (const route of hiddenNavRoutes) {
    // Exact match — "/orders" must never also hide "/draft-orders"
    const selectors = BASE_PATHS.map((base) => `a[href="${base}${route}"]`);
    rules.push(`${selectors.join(", ")} { display: none !important; }`);
  }
  for (const route of hiddenActionRoutes) {
    // Prefix match — import/export links carry ?query suffixes. Action
    // routes end in a terminal segment (/create, /import, /export, /invite),
    // so prefixes cannot collide with sibling routes.
    const selectors = BASE_PATHS.map((base) => `a[href^="${base}${route}"]`);
    rules.push(`${selectors.join(", ")} { display: none !important; }`);
  }
  // Also hide wrappers/sections that we tag via MutationObserver
  rules.push(`.${STYLE_ID}-hidden { display: none !important; }`);
  return rules.join("\n");
}

function queryHiddenNavAnchors(hiddenNavRoutes: string[]): HTMLAnchorElement[] {
  const anchors: HTMLAnchorElement[] = [];
  for (const route of hiddenNavRoutes) {
    for (const base of BASE_PATHS) {
      document
        .querySelectorAll<HTMLAnchorElement>(`a[href="${base}${route}"]`)
        .forEach((a) => anchors.push(a));
    }
  }
  return anchors;
}

/**
 * Intercept clicks on the main sidebar "Settings" link and redirect to the
 * first settings page the role CAN access.
 *
 * The Settings link is a React Router <Link to="/settings"> component.
 * Mutating its DOM href attribute via setAttribute has NO effect on actual
 * click navigation — React Router's <Link> intercepts clicks via its own
 * onClick handler using the `to` prop captured in its component closure,
 * not by reading the DOM's current href attribute at click time.
 *
 * So we intercept at the EVENT level: add a capture-phase click listener
 * that fires BEFORE React's synthetic event system, calls preventDefault
 * + stopPropagation to block React Router's handler, then calls React
 * Router's navigate() directly with the correct landing page.
 *
 * The `{ capture: true }` option is critical — without it, our listener
 * fires during the bubble phase AFTER React Router's synthetic handler
 * has already called navigate("/settings").
 */
function interceptSettingsClick(
  landingPath: string,
  navigate: (to: string) => void,
) {
  for (const base of BASE_PATHS) {
    const link = document.querySelector<HTMLAnchorElement>(
      `a[href="${base}/settings"]`,
    );
    if (link && !link.hasAttribute("data-rbac-settings-intercept")) {
      link.setAttribute("data-rbac-settings-intercept", "true");
      link.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(landingPath);
        },
        true, // capture phase — must fire BEFORE React's synthetic handler
      );
    }
  }
}

/**
 * Hide entire sidebar section groups that have no visible nav item left.
 *
 * For each hidden nav anchor, walk up the DOM while the ancestor's subtree
 * contains ONLY hidden nav anchors; tag the highest such ancestor. For a
 * fully-hidden section (heading + divider + items, e.g. Settings "General"
 * for Customer Support) that ancestor is the section group wrapper. The walk
 * stops as soon as an ancestor contains any visible anchor (e.g. Profile),
 * so a partially-visible section keeps its heading. Structural — no
 * dependence on translated heading text like the old "Developer" match.
 */
function hideEmptySections(hiddenNavRoutes: string[]) {
  const hiddenPaths = new Set(
    hiddenNavRoutes.flatMap((route) =>
      BASE_PATHS.map((base) => `${base}${route}`),
    ),
  );
  const isHiddenAnchor = (a: HTMLAnchorElement) =>
    hiddenPaths.has(a.getAttribute("href") ?? "");

  for (const anchor of queryHiddenNavAnchors(hiddenNavRoutes)) {
    let candidate: HTMLElement | null = null;
    let el: HTMLElement | null = anchor.parentElement;
    while (el && el !== document.body) {
      const anchors = Array.from(
        el.querySelectorAll<HTMLAnchorElement>("a[href]"),
      );
      if (anchors.length === 0 || !anchors.every(isHiddenAnchor)) {
        break;
      }
      candidate = el;
      el = el.parentElement;
    }
    if (candidate) {
      candidate.classList.add(`${STYLE_ID}-hidden`);
    }
  }
}

/**
 * Returns true if the element is a Delete action menu item.
 *
 * Two rendering patterns exist in the Medusa dashboard:
 * 1. ActionMenu (product list/detail, inventory list): uses
 *    <DropdownMenu.Item> → <div role="menuitem"> containing
 *    <svg> icon + <span>Delete</span>.
 * 2. DataTableActionCell (variant rows, reservations, location levels):
 *    uses <DropdownMenu.Item> → <div role="menuitem"> containing
 *    <svg> icon + raw "Delete" text node (NOT wrapped in <span>).
 *
 * For both patterns, the element's textContent is exactly the label text
 * ("Delete"), and both contain an SVG icon. We check textContent on the
 * element itself rather than searching <span> children to handle pattern #2.
 */
function isDeleteAction(el: Element): boolean {
  const text = el.textContent?.trim() ?? "";
  const hasIcon = el.querySelector("svg") !== null;
  return text === "Delete" && hasIcon;
}

/**
 * Returns true if the element is a Delete command in a CommandBar
 * (used by Media bulk actions on the product detail page).
 *
 * CommandBar.Command renders:
 *   <button><span>Delete</span><kbd>D</kbd></button>
 *
 * This is structurally different from DropdownMenu items (no SVG icon,
 * no role="menuitem", has <kbd> shortcut badge).
 */
function isDeleteCommand(el: Element): boolean {
  const firstSpan = el.querySelector("span");
  const spanText = firstSpan?.textContent?.trim() ?? "";
  const hasShortcut = el.querySelector("kbd") !== null;
  return spanText === "Delete" && hasShortcut;
}

/**
 * Hide Delete-labeled menu items on pages whose resource the user cannot
 * delete. Targets [role="menuitem"] elements (ActionMenu / DropdownMenu items)
 * containing BOTH "Delete" text and an SVG icon.
 *
 * Only fires when the current admin page path matches a resource in
 * DELETE_RESOURCE_MAP whose permission the user lacks (computed via
 * computeResourcesWithoutDelete, same permissions data as nav/action hiding).
 *
 * Called from the MutationObserver callback (catches dynamically-opened
 * dropdowns) AND from the initial setTimeout (catches already-rendered items
 * on SPA navigation).
 */
function hideDeleteActions(resourcesWithoutDelete: string[]) {
  if (resourcesWithoutDelete.length === 0) {
    return;
  }

  const adminPath = window.location.pathname.replace(/^\/app/, "");
  const shouldHide = resourcesWithoutDelete.some(
    (r) => adminPath === r || adminPath.startsWith(r + "/"),
  );
  if (!shouldHide) {
    return;
  }

  document.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach((item) => {
    if (isDeleteAction(item)) {
      item.classList.add(`${STYLE_ID}-hidden`);
    }
  });

  // Also scan for CommandBar Delete commands (media bulk actions on product
  // detail). These render as <button> elements inside a Radix Popover portal,
  // not as [role="menuitem"] dropdown items.
  document.querySelectorAll<HTMLElement>("button").forEach((btn) => {
    if (isDeleteCommand(btn)) {
      btn.classList.add(`${STYLE_ID}-hidden`);
    }
  });
}

const SidebarFilterWidget = () => {
  const observerRef = useRef<MutationObserver | null>(null);
  const navigate = useNavigate();

  // Resolve the current user first so the permissions query is keyed per
  // user — a role/user switch in the same tab can never serve another
  // user's cached nav state. Keys are "rbac-"-prefixed to avoid colliding
  // with dashboard-core query keys (the §3 query-key collision bug).
  const { data: me } = useQuery({
    queryKey: ["rbac-sidebar-me"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{ user: { id: string } }>(
        "/admin/users/me",
      );
      return res.user;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: permissions } = useQuery({
    queryKey: ["rbac-sidebar-permissions", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const res = await sdk.client.fetch<{ permissions: string[] }>(
        "/admin/me/permissions",
      );
      return res.permissions ?? [];
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (!permissions) {
      return;
    }

    const hiddenNavRoutes = computeHiddenRoutes(permissions);
    const hiddenActionRoutes = computeHiddenActionRoutes(permissions);
    const resourcesWithoutDelete = computeResourcesWithoutDelete(permissions);
    const settingsLanding = computeSettingsLandingPage(permissions);

    // 1. Inject/refresh CSS — immune to React re-renders. Content is
    // rewritten (not create-once) so a permission change recomputes the set.
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = buildHideCSS(hiddenNavRoutes, hiddenActionRoutes);

    // 2. Intercept clicks on the Settings main-nav link so it goes to the
    // first accessible settings page instead of /settings (which hardcodes
    // a redirect to /settings/store — 400 for roles without store:read).
    // Uses capture-phase click interception + React Router navigate() rather
    // than DOM href mutation, because the sidebar link is a React Router
    // <Link> component that never reads the DOM href at click time.
    interceptSettingsClick(settingsLanding, navigate);

    if (hiddenNavRoutes.length === 0 && hiddenActionRoutes.length === 0) {
      return;
    }

    // 3. Collapse already-rendered empty sections + hide already-rendered
    // Delete menu items (SPA navigation may have loaded them before this effect)
    const timer = setTimeout(() => {
      hideEmptySections(hiddenNavRoutes);
      hideDeleteActions(resourcesWithoutDelete);
    }, 50);

    // 4. Watch for dynamically added items (SPA navigation / dropdown open) —
    // also re-apply the settings link interception and delete hiding on DOM mutations.
    // CommandBar content (media bulk actions) renders inside a Radix Popover
    // portal — the portal wrapper may appear first with the buttons arriving
    // in a separate render tick. A rAF-deferred second pass catches them.
    // The `pendingRaf` guard prevents queuing redundant rAF callbacks when the
    // MutationObserver fires many times in rapid succession.
    let pendingRaf = false;
    const observer = new MutationObserver(() => {
      hideEmptySections(hiddenNavRoutes);
      hideDeleteActions(resourcesWithoutDelete);
      interceptSettingsClick(settingsLanding, navigate);
      if (!pendingRaf) {
        pendingRaf = true;
        requestAnimationFrame(() => {
          pendingRaf = false;
          hideDeleteActions(resourcesWithoutDelete);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      // Leave the <style> tag — removing it would flash the items back
    };
  }, [permissions]);

  return null;
};

export const config = defineWidgetConfig({
  zone: "topbar",
});

export default SidebarFilterWidget;
