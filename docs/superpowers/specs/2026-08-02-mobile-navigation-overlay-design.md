# Mobile Navigation Overlay Fix

## Problem

In the mobile layout, navigating from the open sidebar can close the sidebar while leaving `#mobile-overlay` active. The invisible overlay then intercepts pointer events across the page. As a result, the menu cannot be reopened and profile or Match Preview interactions can be blocked even though the destination view rendered correctly.

The observed failure at a `390 x 844` viewport is caused by navigation paths that remove `sidebar.open` without also removing `mobile-overlay.active`.

## Scope

This change makes closing the mobile navigation a single, consistent operation.

- Add one shared `closeMobileNavigation()` helper.
- The helper removes both `sidebar.open` and `mobile-overlay.active`.
- Call the helper from `navigateTo()` so every application navigation restores the same closed state.
- Reuse the helper for existing overlay-click and menu-close paths where applicable.
- Preserve the existing menu-open and menu-toggle behavior.

This applies to top-level navigation, league pages, tools, Head-to-Head, player profiles, and browser-history navigation that flows through `navigateTo()`.

## Non-goals

- No changes to the scraper, archive validation, ranking data, or deployment workflow.
- No redesign of the sidebar, overlay, dashboard, profile, or Match Preview.
- No additional keyboard behavior or broader accessibility redesign in this focused fix.

## Behavioral Contract

The sidebar and overlay represent one mobile-navigation state:

- Open: the sidebar has `open` and the overlay has `active`.
- Closed: neither class is present.
- Application navigation always ends in the closed state.
- An active overlay must never remain after the sidebar has closed.
- After navigation, the hamburger control remains usable and can open the menu again.

Centralizing the close operation prevents individual routes or click handlers from updating only half of this state.

## Verification

### Automated regression coverage

Add a focused regression test that verifies navigation clears both classes and that the shared close behavior is used by the relevant handlers. Run the complete existing test suite and the JavaScript syntax check.

### Mobile browser QA

Validate at `390 x 844`:

1. Open the dashboard and mobile menu.
2. Navigate to Head-to-Head.
3. Confirm the Head-to-Head view renders, the sidebar is closed, and the overlay is inactive.
4. Reopen the mobile menu to prove it is not blocked.
5. Navigate to a player profile, complete the existing profile selection flow, and return to the dashboard.
6. Confirm the Match Preview entry can be opened and its view renders.
7. Confirm there is no horizontal overflow and no application console error. A known favicon `404` is not considered an application failure.

## Acceptance Criteria

- No supported navigation path leaves `#mobile-overlay.active` behind when the sidebar is closed.
- The mobile menu can be reopened after navigating to Head-to-Head.
- Profile interactions and Match Preview remain clickable after mobile navigation.
- Existing desktop and mobile navigation behavior otherwise remains unchanged.
- The full automated test suite passes.

## Rollback

The fix is isolated to the navigation-state helper, its callers, and regression coverage. It can be reverted as a single change without affecting data files or the scraper pipeline.
