# High6 Medusa Commerce

Medusa 2.x commerce platform — Turbo monorepo with backend and storefront.

- **Package manager:** npm (enforced by `package.json`)
- **Stack:** Medusa 2.17, Postgres, Redis, Turbo
- **Workspaces:** `apps/backend` (@dtc/backend), `apps/storefront` (@dtc/storefront)

## Commands

```bash
npm run dev              # Start all apps (turbo dev)
npm run build            # Build all apps
npm run backend:dev      # Start backend only
npm run storefront:dev   # Start storefront only
```

## Skills

### graphify

- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
  When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

### ui-ux-pro-max

- **ui-ux-pro-max** (`.claude/skills/ui-ux-pro-max/SKILL.md`) - UI/UX design intelligence. 67 styles, 96 palettes, 57 font pairings, 25 charts, 13 stacks.
  Trigger: `/ui-ux-pro-max`
  Usage rules:
- **Always** invoke `skill: "ui-ux-pro-max"` before any UI task
- Trigger on: plan, build, create, design, implement, review, fix, improve, optimize, enhance, refactor, check — when applied to UI/UX work
- Covers: components, layouts, dashboards, mobile views, forms, cards, modals

### Engram Memory

- **Engram** (MCP) — persistent memory across sessions. Always active. Saves decisions, bugs, discoveries, and conventions automatically. No explicit trigger needed.

## Medusa Skills (Global)

The following Medusa-specific skills are available globally:

- `medusa-dev:building-with-medusa` — Backend modules, API routes, workflows, data models
- `medusa-dev:building-storefronts` — Storefront SDK, React Query, data fetching
- `medusa-dev:building-admin-dashboard-customizations` — Admin UI widgets, custom pages, forms
- `medusa-dev:db-generate` / `medusa-dev:db-migrate` — Database migrations
