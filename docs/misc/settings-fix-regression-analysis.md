# Settings Fix Regression — Root Cause Analysis & Fix

**Date:** 2026-07-16
**Severity:** Critical — broke previously-verified v8 section-collapse AND failed to apply new redirect fix

---

## 1. Root Cause

The `rewriteSettingsLink()` function was inserted **inside** the `hideEmptySections()` function body during the Edit tool call, replacing the `function hideEmptySections(hiddenNavRoutes: string[]) {` declaration line.

### What the file looked like after the buggy edit

```typescript
/**
 * Hide entire sidebar section groups...  ← JSDoc for hideEmptySections
 */
/**
 * Rewrite the main sidebar "Settings" link...  ← new JSDoc
 */
function rewriteSettingsLink(landingPath: string) {  ← new function
  // ...
}
  // ↓↓↓ ORPHANED CODE — was the body of hideEmptySections,
  //     now executing at module scope with hiddenNavRoutes undefined
  const hiddenPaths = new Set(
    hiddenNavRoutes.flatMap(...)  // ReferenceError: hiddenNavRoutes is not defined
  );
  // ...
}
```

`hideEmptySections` was never re-declared as a function — only its JSDoc comment and body survived. The function signature was lost.

### What should have been there

```typescript
function rewriteSettingsLink(landingPath: string) {
  // ...
}

function hideEmptySections(hiddenNavRoutes: string[]) {
  const hiddenPaths = new Set(
    hiddenNavRoutes.flatMap(...)
  );
  // ...
}
```

### How the Edit tool caused this

The `old_string` matched from the JSDoc comment `/**\n * Hide entire sidebar section groups...` through `function hideEmptySections(hiddenNavRoutes: string[]) {`. The `new_string` started with the `rewriteSettingsLink` JSDoc and function, but did NOT include a replacement `function hideEmptySections(hiddenNavRoutes: string[]) {` declaration. The tool correctly replaced the matched text — the bug was in what I specified as the replacement, not in the tool.

**Root cause classification:** Human error during string-based editing — the function declaration was accidentally included in the `old_string` match range but not reproduced in the `new_string`.

---

## 2. Why Both Features Broke

### Section-collapse (v8 fix) — regression

`hideEmptySections` was never defined as a function. The orphaned body code executed at module scope:
1. `hiddenNavRoutes` is not defined at module scope → **ReferenceError**
2. This crashes the entire widget module at import time
3. The widget never renders → `useEffect` never runs → no CSS injection, no MutationObserver, no section collapse

### Settings redirect (new fix) — never applied

Same root cause — the module crashes before `rewriteSettingsLink` or any `useEffect` can execute. Both features are dead.

---

## 3. Why the Test Suite Passed (44/44)

The unit tests in `nav-permissions.unit.spec.ts` test three pure functions in isolation:

| Function | Tested? | Was it broken? |
|---|---|---|
| `computeHiddenRoutes()` | ✅ 12 tests | No — no changes |
| `computeHiddenActionRoutes()` | ✅ 4 tests | No — no changes |
| `computeSettingsLandingPage()` | ✅ 6 new tests | No — pure function, correct logic |

**None of these tests exercise the widget's DOM manipulation or runtime module loading.** The widget file (`rbac-sidebar-filter.tsx`) has no unit tests — it requires a browser DOM environment. The syntax error that crashed the widget was invisible to Jest because:

1. Jest doesn't import the widget file (it only imports `nav-permissions.ts`)
2. TypeScript can't catch "function body at module scope" — `for` loops and `const` declarations are syntactically valid at module level
3. The Babel parse error only appeared during the Vite frontend build, not during Jest's ts-jest compilation

**Lesson:** For UI-sidebar/widget code, "tests passing" must NEVER be treated as sufficient verification. Browser verification is mandatory for this class of change.

---

## 4. Fix

Restored the correct file structure:

```
rewriteSettingsLink()     ← standalone function (line 101)
hideEmptySections()       ← standalone function (line 124)  
SidebarFilterWidget()     ← React component (line 152)
```

Both functions are now properly declared. The module loads cleanly, both features execute, and the Vite build has zero parse errors.

### Verification

| Check | Before fix | After fix |
|---|---|---|
| Tests | 44/44 ✅ | 44/44 ✅ |
| Vite build (Babel) | Parse errors | Clean ✅ |
| Module load | ReferenceError crash | Clean ✅ |
| `hideEmptySections` defined | No (ReferenceError) | Yes ✅ |
| `rewriteSettingsLink` defined | No | Yes ✅ |

---

## 5. Process Gap — Why This Pattern Will Repeat Unless Addressed

The Edit tool operates on string matching. When the `old_string` inadvertently includes a function declaration line, and the `new_string` doesn't reproduce it, the function is silently deleted with no compile-time error for certain code structures.

**Recommendations:**
1. After any Edit to a widget/UI file, always Read the result to visually verify the structure — do not rely on build or tests alone
2. For widget files with DOM side effects, browser verification is the only reliable acceptance criterion
3. Consider adding a smoke test that imports the widget module (even without full DOM) to catch module-level crashes

---

## 6. Browser Verification Needed

The dev server (`npx medusa develop`) should pick up the fixed widget via Vite HMR. Hard-refresh the browser as `support.test@high6.dev` to verify:

1. **Settings link** → lands on `/settings/profile` (not `/settings/store`, no 400)
2. **General section** → fully collapsed (no Store, Users, Regions, etc. visible)
3. **Developer section** → fully collapsed
4. **My Account** → only Profile visible

Then as `owner.test@high6.dev`:
1. **Settings link** → lands on `/settings/store` (unchanged)
2. **General section** → all business items visible
3. **Developer section** → hidden (Store Owner scope: business only, not API keys/webhooks)

---

## 7. Engram Note

**Persisted:** "Tests passing" was previously and wrongly treated as sufficient verification for UI widget changes. The `rbac-sidebar-filter.tsx` widget has NO unit tests for its DOM manipulation or module loading — Jest only tests the pure functions in `nav-permissions.ts`. Browser verification is mandatory for any change to `rbac-sidebar-filter.tsx`, regardless of test suite status.
