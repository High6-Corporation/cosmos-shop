# Settings Redirect Fix — React Router Architectural Analysis & Correct Fix

**Date:** 2026-07-16
**Session:** Follow-up — DOM mutation approach confirmed incompatible with React Router
**Status:** Fixed with click-interception approach; browser verification pending

---

## 1. Why `rewriteSettingsLink()` Never Worked

### The architectural mismatch

The Settings sidebar link is rendered by Medusa as a React Router `<Link to="/settings">` component. React Router's `<Link>` works by:

1. Rendering an `<a href="/app/settings">` element in the DOM
2. Attaching an `onClick` handler that calls `event.preventDefault()` + `navigate("/settings")` using the **`to` prop from component closure**, NOT by reading `event.target.href` at click time

`rewriteSettingsLink()` calls `link.setAttribute("href", "/app/settings/profile")` — this changes the DOM attribute but React Router **never reads it**. The `<Link>` component already captured `"/settings"` in its closure when it was first rendered.

**This is not a bug in our code — it's a fundamental incompatibility between DOM mutation and React Router's navigation model.** The DOM `href` does change (visible in devtools inspector), but clicks still navigate to the original `to` prop value, then `settings.tsx` hardcodes the redirect to `/settings/store`, and the 400 still fires.

### Evidence

- Confirmed via Medusa dashboard source: settings link rendered as `<Link to="/settings">` (main-layout.tsx, identified in prior sessions)
- Browser-verified by user: section-collapse works (proving the widget runs), but Settings click still 400s on `/settings/store` despite `rewriteSettingsLink` executing without error
- General React Router architecture: `<Link>` uses closure-captured `to` prop, not DOM `href` attribute

---

## 2. Fix — Capture-Phase Click Interception

### Approach

Replace DOM attribute mutation with **event-level interception** using a capture-phase click listener:

```typescript
function interceptSettingsClick(
  landingPath: string,
  navigate: (to: string) => void,
) {
  for (const base of BASE_PATHS) {
    const link = document.querySelector(`a[href="${base}/settings"]`);
    if (link && !link.hasAttribute("data-rbac-settings-intercept")) {
      link.setAttribute("data-rbac-settings-intercept", "true");
      link.addEventListener(
        "click",
        (e) => {
          e.preventDefault();       // Block default anchor navigation
          e.stopPropagation();      // Block React Router's synthetic handler
          navigate(landingPath);    // Use React Router's own navigate()
        },
        true, // ← CRITICAL: capture phase fires BEFORE React's synthetic events
      );
    }
  }
}
```

### Why capture phase is critical

Without `{ capture: true }`, the listener fires in the **bubble phase** — AFTER React's synthetic event system has already processed the click and called `navigate("/settings")`. In the capture phase, our listener fires first, before the event reaches React's delegation point at the document root.

### How `useNavigate` integrates

The widget now imports `useNavigate` from `react-router-dom` and passes it to `interceptSettingsClick`. This lets us call React Router's own navigation function rather than trying to manipulate browser history directly, ensuring React Router's internal state stays synchronized.

### Changes

| File | Change |
|---|---|
| `rbac-sidebar-filter.tsx` | Replaced `rewriteSettingsLink()` with `interceptSettingsClick()` |
| `rbac-sidebar-filter.tsx` | Added `import { useNavigate } from "react-router-dom"` |
| `rbac-sidebar-filter.tsx` | Added `const navigate = useNavigate()` to widget component |

The `computeSettingsLandingPage()` function and `SETTINGS_PAGE_PERMISSIONS` map (from the prior session) are unchanged — they correctly compute the landing page. Only the mechanism that APPLIES the computed page to actual navigation was wrong.

---

## 3. Verification

| Check | Result |
|---|---|
| Tests | 44/44 passing |
| Build | Clean (8.52s), zero Babel errors |
| Section collapse | Confirmed working (user-verified, regression fixed) |
| Click interception (browser) | **Pending — requires hard refresh + actual click as support.test** |

### Browser verification checklist

1. **Hard refresh** the admin dashboard (Cmd+Shift+R) — Vite HMR may not pick up widget changes without a full reload
2. Log in as `support.test@high6.dev`
3. Verify: General and Developer sidebar sections fully collapsed (already confirmed)
4. **Click "Settings"** in the main sidebar → should land on `/settings/profile` with no 400
5. Verify: `/settings/profile` shows the user's profile page
6. Log in as `owner.test@high6.dev`
7. Click "Settings" → should still land on `/settings/store` (first match in settings page order)
8. Verify: Store Owner's General section has all business items visible, Developer section hidden

---

## 4. Lessons Learned (Addendum to Prior Session's Regression Analysis)

| # | Lesson |
|---|---|
| 1 | **"Tests pass" is insufficient for UI widget verification** — already noted in prior session |
| 2 | **"DOM attribute looks correct in devtools" is also insufficient** — the attribute was there but React Router ignored it |
| 3 | **React Router `<Link>` uses closure-captured `to` prop, not DOM `href`** — DOM mutation of href on a React-managed link is a no-op for navigation |
| 4 | **Capture-phase event listeners are the correct interception point** for React-managed elements — they fire before React's synthetic event delegation |
| 5 | **`useNavigate` is available in widgets** — even ones that return null — enabling programmatic navigation from DOM-level event handlers |

---

## 5. Patch-Package Status

The `patch-package` gap flagged since v7 §3 remains unresolved. The current click-interception approach avoids patching `node_modules/@medusajs/dashboard` core files, but it's inherently fragile — it depends on:
- The Settings link rendering as `<a href="/app/settings">` or `<a href="/settings">`
- The capture-phase event listener firing before React's synthetic handler
- The `useNavigate` import working in Medusa's admin extension build

A proper `patch-package` setup for `settings.tsx:9-10` would be more robust long-term, but the click-interception fix addresses the immediate symptom without introducing a new dependency.

---

## 6. Graphify & Engram

- **Graphify**: Clean rebuild done earlier this session. The widget changes are captured.
- **Engram**: This analysis and the React Router lesson will be persisted.
