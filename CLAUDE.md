# Cosmos Shop

Client project forked from [high6-medusa-omnichannel-template](https://github.com/high6/high6-medusa-commerce) at `v1.0.0` (2026-07-17).

This is a **fresh fork** — no client-specific features have been built yet. The repo is currently identical to the template at `v1.0.0` except for the tooling setup documented below.

## Template Relationship

- **[TEMPLATE_BOUNDARY.md](TEMPLATE_BOUNDARY.md)** — definitive list of which files are template-owned vs. client-owned. Do not edit template-owned files in this repo; changes to those belong upstream in the template.
- **[TEMPLATE_SYNC.md](TEMPLATE_SYNC.md)** — procedure for pulling template updates via `git merge <tag>`.

## AI Tooling

- **Graphify** — knowledge graph index of the repo. Run `/graphify` to query the codebase structure. Use `graphify query "<question>"` for architecture and data-flow questions before reading raw files. **⚠️ Always `cd` into the project root before `graphify update`** — running it from a parent directory (e.g. `~/work`) will silently re-index every project into a single bloated graph, corrupting both this project's index and the shared multi-project graph at the work-root level.
- **Engram** — persistent memory across sessions. Project-scoped to `cosmos-shop` (`.engram/config.json`). Saves decisions, bugs, discoveries, and conventions automatically.

## Skills

- **graphify** — `/graphify` — query the knowledge graph for codebase architecture, file relationships, and data flow.
- **ui-ux-pro-max** — `/ui-ux-pro-max` — UI/UX design intelligence. 67 styles, 96 palettes, 57 font pairings. Trigger on any UI task.
- **medusa-dev:building-with-medusa** — Backend modules, API routes, workflows, data models.
- **medusa-dev:building-storefronts** — Storefront SDK, React Query, data fetching patterns.
- **medusa-dev:building-admin-dashboard-customizations** — Admin UI widgets, custom pages, forms, tables.
- **medusa-dev:db-generate** / **medusa-dev:db-migrate** — Database migrations.

## Quick Start

```bash
npm run dev              # Start all apps (turbo dev)
npm run backend:dev      # Start backend only
npm run storefront:dev   # Start storefront only
```
