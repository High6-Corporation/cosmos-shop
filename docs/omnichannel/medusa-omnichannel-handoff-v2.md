# Medusa Commerce Integration (Omnichannel, Per-Client) — Handoff Document

> **Status:** Project bootstrapped and running locally. No feature work started yet (Roles and Shopee/Lazada wiring are next session).
> **Date:** July 10, 2026
> **Version:** v2 (supersedes v1)
> **Summary:** Session 2 covered project bootstrap only — scaffolding `high6-medusa-omnichannel-template` via `create-medusa-app`, resolving a Postgres connection issue (Docker container mismatch), resolving a slow/first-run install, and fixing a hard-crashing `useLocation()` Router context error on the Draft Orders admin page caused by a `react-router-dom` version mismatch. No role-based access or marketplace integration work has started. This doc also introduces a standard structure for writing Claude Code investigation/implementation prompts and for responding to the Agent's plans or findings, for use starting next session.

---

## 1. Project bootstrap — what was done this session

### 1.1 Naming
- **Template/scaffold repo:** `high6-medusa-omnichannel-template`
- **Per-client instances (pattern, for later provisioning):** `medusa-{client-slug}`

### 1.2 Setup path
Installed via official `create-medusa-app@2.17.2`:
```bash
npx create-medusa-app@latest high6-medusa-omnichannel-template
```
- Next.js Starter Storefront: installed (serves as the "own storefront" sales channel)
- Postgres: local Docker container (not the `veris-dev` Supabase container — kept isolated per the per-client-instance principle)
- Admin dashboard: `http://localhost:9000/app`
- Backend: `http://localhost:9000`
- Storefront: `http://localhost:8000`

### 1.3 Issues hit and resolved this session

**Postgres connection failure (`AggregateError`)**
- Cause: no plain Postgres container was running on host port 5432 — only a Supabase-bundled Postgres (`supabase_db_veris-dev`) mapped to port 54322, belonging to an unrelated project.
- Fix: spun up a dedicated Postgres container for this project rather than reusing the unrelated Supabase container, consistent with per-client instance isolation.

**Slow first-run install**
- `npm install` across the full monorepo (backend + admin + Next.js storefront) took materially longer than the documented 3-5 minutes, due to concurrent CPU/memory load from other running apps (Docker, VS Code, browser). Confirmed via `top`/`ps` that the process was actively working (high CPU, real disk I/O), not hung. No community-documented "known hang" bug found for `create-medusa-app` — treated as environment load, not a tool defect.

**`useLocation() may be used only in the context of a <Router> component` — hard crash on Draft Orders page**
- Confirmed via full-page error boundary screenshot, not just a console warning — this was a real blocker, not the cosmetic/non-blocking upstream issue recorded in a prior project's handoff doc (`medusa-cms-handoff-v4.md`). Important distinction for future sessions: the same error message can be either harmless or fatal depending on environment — always verify by attempting the actual feature (create/view a draft order), not just by reading the console.
- Root cause, confirmed via `npm ls`: `@medusajs/dashboard@2.17.2` requires `react-router-dom@6.30.4`; `@medusajs/draft-order@2.17.2` requires `6.30.3`. npm resolved this as an **invalid** tree (`ELSPROBLEMS`, `invalid: "6.30.4"`) instead of cleanly deduping — this project had `react-router-dom` pinned as a direct dependency at `6.30.3` in `apps/backend/package.json`.
- Fix: changed the direct dependency in `apps/backend/package.json` from `"react-router-dom": "6.30.3"` to `"react-router-dom": "6.30.4"`, then `rm -rf node_modules package-lock.json && npm install`. Verified with `npm ls react-router-dom` showing a single clean `6.30.4`, no `invalid`/`ELSPROBLEMS`. Confirmed fixed by reloading Draft Orders — page renders normally.
- **Note for future Medusa version upgrades:** re-check `npm ls react-router-dom` after any `@medusajs/*` version bump. This is a direct dependency pin in this project (not just transitive), so it can silently drift out of sync with what `@medusajs/dashboard` expects on future upgrades.

---

## 2. Carried forward from v1 (still open, not started)

### 2.1 Role-based access (next session candidate)
- Does stock Medusa's built-in Admin user/permission system cover this out of the box, or does it need a custom layer? Still needs investigation — don't assume.
- What roles exist for a client team? Needs a real conversation with Sir JM/Sir Jeff/client stakeholders — no assumed list yet.
- Whether this connects to the old `User↔Tenant` question from the benched project, or whether that's now moot.

### 2.2 Shopee & Lazada wiring (next session candidate)
- Feasibility confirmed (see v1, Section 3.1) — both platforms have official partner/open APIs.
- Still undecided: which platform to prototype first.
- Still undecided: sync direction/source-of-truth per data type (catalog, inventory, orders) — likely bidirectional but not confirmed.
- Still unscoped: whether Shopee/Lazada map onto Medusa's Sales Channel concept directly, or need a separate integration layer.
- Still unscoped: per-client credential storage/rotation for marketplace OAuth tokens across N instances.
- Still unscoped: rate-limit-safe (queued) sync architecture — direction is clear, no implementation started.

### 2.3 Also still open
- Per-client instance provisioning/deployment approach (new territory, not addressed).
- Re-ask the client access-model question (dedicated site vs. admin access) in this new architecture's context.

---

## 3. Standard structure — writing Claude Code prompts for this project

Use this structure for any investigation or implementation brief given to the Agent, in Claude Code or otherwise.

```
## Task: [one-line description]

**Skills to invoke:** [Graphify / Engram / UI-UX Pro Max — pick what applies]

**Mode: [Investigation only — no file changes / Implementation — proceed after plan approval]**

### Context
[What's happening, what error/requirement prompted this, relevant file paths or
prior handoff doc references. Paste exact error messages/stack traces verbatim
where relevant — don't paraphrase them.]

### Investigation/Implementation steps
1. [Specific, ordered steps — not vague instructions]
2. ...

### Report back with / Deliverable
[What the Agent should return: a written report only, a plan for approval,
or actual code changes — be explicit about which.]

[If Implementation mode: "Do not proceed past the plan stage without my
explicit confirmation."]
```

**Rules for this project (per established working pattern):**
- **Plan-first gate:** for any implementation task, the Agent proposes a plan and stops — no code changes until the plan is explicitly approved.
- **Step-by-step confirmation:** multi-phase work proceeds one phase at a time; the Agent does not chain phases without a checkpoint.
- **Investigation before implementation:** for anything with an unverified assumption (e.g. "is this a version mismatch or a code bug"), always investigate first, report findings, and get direction before touching files.
- **Inline brief pasting preferred** over referencing external files the Agent would need to locate itself.

---

## 4. Standard structure — responding to the Agent's plan or findings

When the Agent returns a plan or investigation report, respond using this shape:

1. **Acknowledge what's confirmed vs. still uncertain.** If the Agent's report includes assumptions or unverified claims, flag them explicitly before approving — don't let an assumption slide through as if it were confirmed.
2. **Ask for direct verification when the report's conclusion depends on behavior, not just code.** E.g. "the report says X is non-blocking" — confirm that by testing the actual feature, not by re-reading the same doc reference.
3. **Approve scope explicitly and narrowly.** State exactly what the Agent is cleared to do next (e.g. "apply the one-line version fix only, don't touch anything else") rather than a blanket "go ahead."
4. **If the Agent's fix works, close the loop with a verification step** (reload the page, retry the original failing action) before considering the task done — don't accept "should be fixed" without checking.
5. **Capture the outcome in the handoff doc** (this document) before moving to the next task, especially root causes and fixes that could recur on future upgrades.

---

## References

- `medusa-cms-handoff-v15.md` — final state of the benched multi-tenant project, reusable patterns
- `medusa-omnichannel-handoff-v1.md` — architecture pivot decision, Shopee/Lazada feasibility research
- Shopee Open Platform: https://open.shopee.com/
- Lazada Open Platform: https://open.lazada.com/
- Medusa `create-medusa-app` docs: https://docs.medusajs.com/learn/installation