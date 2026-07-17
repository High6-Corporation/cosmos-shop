# Template Sync Procedure

How to pull template updates into a client fork of `high6-medusa-commerce` without losing
client-specific changes.

## Setup (once per client)

1. Add the template as a remote:
   ```bash
   git remote add template git@github.com:high6/high6-medusa-commerce.git
   ```
2. Record the starting tag:
   ```bash
   echo "v1.0.0" > TEMPLATE_VERSION
   git add TEMPLATE_VERSION && git commit -m "Record template starting point"
   ```

## Pull an Update

1. Fetch tags from the template:
   ```bash
   git fetch template --tags
   ```
2. Read the target tag's release notes. Every tag has a lightweight changelog in its annotation
   (`git tag -ln99 <tag>`) and a corresponding handoff document in `docs/`.
3. Merge the tag — **always a tag, never a branch** (pulling `main` risks merging half-finished
   work):
   ```bash
   git merge v1.1.0
   ```
4. **Post-merge verification** — the same standard this entire codebase was built on:
   ```bash
   npm run test                          # full unit suite must pass
   npm run dev                           # boot health: all roles (+0/-0), no errors
   ```
   If either fails, the merge succeeded on git's terms but broke semantically. Roll back
   (`git merge --abort` or `git reset --hard HEAD~1`) and investigate before retrying.
5. Update the version tracker:
   ```bash
   echo "v1.1.0" > TEMPLATE_VERSION
   git add TEMPLATE_VERSION && git commit -m "Update template to v1.1.0"
   ```

## What Happens to Client Changes

Files listed in `.gitattributes` with `merge=ours` will **never** be overwritten by a template
pull. During a merge, git always keeps the client's version of these files — no conflict prompt,
no risk of accepting the wrong side. The full boundary definition is in
**[TEMPLATE_BOUNDARY.md](TEMPLATE_BOUNDARY.md)**.

Client-owned paths (protected):

- `apps/backend/src/utils/seed-rbac-roles.ts` — role definitions
- `apps/backend/src/admin/widgets/marketplace-order-metadata.tsx` — client-specific marketplace UI
- `apps/backend/src/admin/widgets/user-detail-roles.tsx` — user detail role display
- `apps/backend/src/admin/widgets/user-list-roles.tsx` — user list role display
- `apps/backend/src/admin/i18n/index.ts` — translations
- `apps/backend/.env`, `apps/backend/.env.example` — environment

**Everything else is template-owned.** If a client needs to change a template-owned file, the
right path is: PR the change into the template repo, tag a new release, and pull it. Editing
template-owned files directly in a client fork will cause merge conflicts on the next pull.

## Resolving Conflicts

If a merge produces conflicts on template-owned files, you're editing something that should
change upstream. Options (in order of preference):

1. Accept the template version and re-apply your change as a PR to the template
2. If the change is genuinely client-specific and can't be upstreamed, add the file to
   `.gitattributes` and update `TEMPLATE_BOUNDARY.md` — then document the divergence so
   future maintainers understand why it's not upstream

## Known Framework Quirks

### Global container in rbac-seed module

The module at `src/modules/rbac-seed/service.ts` imports the framework's global container
singleton (`import { container } from "@medusajs/framework"`) instead of receiving it via
constructor injection. This is deliberate: model-less custom modules don't receive the DI
container through the constructor — only registered model services get injected. The global
container is the same source the old compiled subscriber used (`framework_1.container`), but
`onApplicationStart` guarantees it's fully populated by call time (unlike the old `setTimeout`
heuristic). Do not "simplify" this back to constructor injection unless Medusa adds container
injection for model-less modules. See Engram #87/#88.

### Post-merge subscriber verification

After updating the subscriber file (`seed-rbac-on-startup.ts`), confirm the boot log no longer
shows: `The subscriber in seed-rbac-on-startup.ts is not a function. skipped.`. This warning
indicates the subscriber wrapper was stripped (the bug that caused #87).

### Vite deps cache after dashboard patches

If dashboard patches (invite button, permissions wildcard) don't take effect after a restart,
clear the Vite deps cache: `rm -rf apps/backend/node_modules/.vite/deps/`

### package.json `name` field

`package.json` is template-owned (dependencies, scripts, workspace config), but its `name`
field is client-specific. Template merges may show a conflict on this single line. Resolution:
**keep Cosmos Shop's `name`, accept the template's side for everything else in the file.** Do
not add `package.json` to `.gitattributes` `merge=ours` — that would block legitimate template
dependency and script updates from reaching the client repo.
