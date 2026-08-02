# Profile History Navigation Fix

## Problem

After a player profile is saved or cleared, `setMyPlayer()` renders the dashboard directly. The visible content therefore changes to the dashboard while the URL, `history.state`, internal `currentState`, and back-button state can still describe the profile route.

This produces inconsistent browser behavior: the page looks like the dashboard but remains at `#profile`, and Back can jump to an unexpected earlier route.

## Root Cause

Profile navigation enters through `navigateTo('profile')`, which synchronizes history and application state. Profile persistence exits through a direct `renderDashboard()` call, bypassing that navigation contract.

## Desired Behavior

Saving or clearing a profile completes the profile-selection step and replaces the current profile history entry with the dashboard:

- visible content is the dashboard;
- the URL is `#dashboard`;
- `history.state` and `currentState` both describe the dashboard;
- dashboard back-button visibility is applied;
- the mobile navigation remains closed through the existing navigation path;
- Back returns to the route visited before the profile form;
- Forward returns to the dashboard, not to a stale profile state.

## Design

Keep player and team persistence unchanged. Replace only the direct post-persistence rendering path:

1. Replace the current browser history entry with `{ type: 'dashboard', id: null }` and `#dashboard`.
2. Render that route through `navigateTo('dashboard', null, false)` so no second history entry is created.
3. Use the same behavior after profile save and profile deletion because both paths complete or clear the profile form and currently share `setMyPlayer()`.

This is intentionally a focused fix. It does not redesign the general `navigateTo()` API or introduce new history modes.

## Error and State Handling

- Persistence occurs before route replacement, preserving the current save/delete ordering.
- Existing team detection and local-storage behavior remain unchanged.
- Existing alerts remain unchanged.
- The navigation path remains null-safe through the existing `navigateTo()` implementation.

## Verification

### Automated regression

Add an executable regression that proves the profile persistence path:

- replaces the active entry with dashboard state and `#dashboard`;
- delegates dashboard rendering to `navigateTo(..., false)`;
- no longer calls `renderDashboard()` directly;
- retains player persistence and sidebar-label updates.

Run the focused regression, complete pytest suite, and JavaScript syntax check.

### Browser QA

At a `390 x 844` viewport:

1. Start on the dashboard and navigate to Head-to-Head.
2. Open the profile form from the mobile navigation.
3. Select and save a public player without retaining or reporting personal data.
4. Confirm dashboard content, `#dashboard`, dashboard history state, closed mobile navigation, and hidden dashboard back button.
5. Press Back and confirm Head-to-Head is restored.
6. Press Forward and confirm the dashboard is restored.
7. Reopen the profile form, clear the profile, and verify the same dashboard/history contract.
8. Confirm Match Preview remains accessible, there is no horizontal overflow, and there are no application console errors. A favicon `404` remains an allowed non-application issue.

## Non-goals

- Do not change initial deep-link handling or the existing startup replacement of hashes.
- Do not change scraper, data, archive, service-worker, layout, or deployment behavior.
- Do not redesign browser history for other routes.
- Do not change profile fields, player lookup, team detection, or Match Preview logic.

## Acceptance Criteria

- Profile save and delete never leave dashboard content at `#profile`.
- URL, browser state, application state, back-button state, and rendered view agree after both actions.
- The completed profile entry is replaced rather than retained as an extra Back destination.
- Back/Forward behavior matches the desired route sequence.
- Automated and mobile-browser verification pass without regressions.

## Rollback

The change is isolated to the profile persistence exit path and its regression coverage. It can be reverted without affecting stored public data or the scraper pipeline.
