# Match Preview Carousel and Percentage Matrix Design

## Status

Approved by the user on 2026-08-21. The user also approved implementation after reviewing the combined desktop and smartphone mockup.

## Problem

The Match Preview currently renders every detected upcoming game as a full-width card in a vertical list. Several games therefore consume most of the page before the league, teams, and lineup controls become reachable. The 16 one-on-one comparisons are rendered as plain text rows, which obscures the four-by-four relationship between both lineups and is difficult to scan on a smartphone.

The redesigned view must make the upcoming-game selector compact and attractive without changing which games are detected. It must also present all 16 player matchups as an understandable percentage matrix without misrepresenting the derived values as calibrated individual win probabilities.

## Goals

- Present detected upcoming games in a compact horizontal carousel.
- Keep the selected matchup visually prominent while neighboring games remain partially visible.
- Make each game card itself the selection target.
- Replace the 16 plain pairing rows with a four-by-four matrix.
- Express every pairing as complementary whole-number percentages.
- Preserve the current and historical player model, manual lineup controls, team forecast, and GitHub Pages-only runtime.
- Keep the view usable at 320 CSS pixels and above without document-level horizontal overflow.
- Preserve safe rendering, keyboard access, screen-reader semantics, and reduced-motion behavior.

## Non-goals

- Change fixture detection, fixture ordering, favorites, or profile selection.
- Change historical archive data, roster construction, class normalization, player ratings, team outcome calibration, or forecast confidence.
- Claim a calibrated one-on-one win probability.
- Introduce a server, API, account, dependency, image asset, or non-static runtime.
- Redesign the league and team selectors, lineup editor, form curves, history, optimal-lineup panel, or team forecast.
- Add drag libraries, animation frameworks, or a custom gesture engine.

## Existing contracts to preserve

- `detectNextMatch`, the remembered game, and `BwedlAppUtils.mergeMatchPreviewGames` remain the only sources and ordering contract for carousel games.
- Selecting a game continues to use `applyMatchSelectorAutoFill` and populates the league, home team, away team, roster, and lineup through the existing guarded asynchronous flow.
- Manual changes continue to invalidate a stale automatic card selection.
- Home and away must resolve to different teams.
- Every forecast lineup contains exactly four safe player slots after neutral completion.
- Player names, team names, league names, dates, and all other published values remain untrusted text and are inserted with safe DOM text APIs.
- The existing team-level probability or relative-strength forecast keeps its current meaning and calculation.
- GitHub Pages remains the only product runtime; the service worker must publish a compatible asset set.

## Visual direction

The Match Preview keeps the existing dark slate palette but adopts a compact sports-scoreboard presentation. Blue identifies the home side, red identifies the away side, cyan marks the active selection, and restrained green, amber, and red cells communicate the one-on-one strength balance. The view uses the current typography and tokens so the feature remains part of BWEDL Stats rather than becoming a separate visual theme.

The approved composition is:

1. horizontal upcoming-game carousel;
2. existing matchup and lineup selection panel;
3. existing team forecast and lineup summaries;
4. existing form information;
5. new percentage matrix in place of the plain 16-row pairing list;
6. existing optimal-lineup and supporting panels.

The mockup is a presentation reference, not a new data contract. It uses illustrative team names, dates, and percentages.

## Upcoming-game carousel

### Structure

The existing `match-preview-next-games` section becomes a bounded carousel region. Its track uses native horizontal overflow and CSS scroll snap. On a smartphone, one primary card occupies roughly 78-88% of the track so the next card remains visible as a cue. Wider layouts show at least two useful cards when space permits. The region has a fixed compact card height determined by content rather than a viewport-relative height.

Each game is rendered as one semantic button styled as a card. It contains league or competition, matchday when available, home team, away team, and date or `Termin offen`. The whole card meets the 44-by-44 CSS pixel minimum target and receives a visible focus ring.

The selected card has a cyan border, an `Ausgewählt` badge, and `aria-pressed="true"`. Unselected cards use `aria-pressed="false"`. There is no nested `Partie auswählen` button, avoiding duplicate actions and reducing card height.

### Interaction

- Touch and pointer scrolling browse the native carousel.
- Previous and next buttons move one card at a time and never wrap from the last game to the first.
- When focus is inside the carousel, Left and Right Arrow browse one card at a time without trapping Tab navigation.
- Activating a card selects the fixture and runs the existing guarded auto-fill operation.
- Successful selection centers the selected card with reduced-motion-aware scrolling.
- Dots report the currently browsed card and total when more than one game exists; the selected card remains independently identified by its badge and pressed state.
- A single detected game renders as one compact selected card without disabled arrows or redundant dots.
- If no game is detected, the carousel is omitted and manual selectors remain available exactly as today.

Automatic initial selection and remembered-game selection retain the existing generation guards. A late timer or earlier card action must never override a newer manual league, team, or card choice.

## One-on-one percentage matrix

### Semantic structure

The matrix is a real HTML table inside a dedicated `match-preview-matrix-scroll` region:

- four home players are row headers with `scope="row"`;
- four away players are column headers with `scope="col"`;
- the 16 body cells contain the home percentage as the primary visible value;
- the accessible cell label states both full player names and both complementary percentages;
- the caption and nearby legend state that each value is a relative strength comparison for the home player, not an individual win probability.

All names and values are created with DOM APIs and `textContent`. Published text is never interpolated into HTML.

### Percentage calculation

For home player `h` and away player `a`, the comparison consumes the same positive, class-adjusted rating already used by the selected lineup:

`home_share = rating(h) / (rating(h) + rating(a))`

`home_percent = round(100 * home_share)`

`away_percent = 100 - home_percent`

The two displayed whole-number values therefore always total exactly 100. No additional home advantage, historical meeting weight, form multiplier, or hidden adjustment is introduced. Current and historical evidence influence the matrix only through the already approved adjusted player rating.

The production model exposes this calculation through one pure helper so the rendering layer does not duplicate model validation. The helper accepts two completed lineup slots and returns bounded home and away shares plus an uncertainty flag. If either input is malformed despite lineup completion, it fails closed to an uncertain 50:50 comparison rather than rendering `NaN`, infinity, or a missing cell.

The percentage is labeled `Stärkevergleich` or `Einschätzung`, never `Siegchance`, `Gewinnwahrscheinlichkeit`, or a betting-style quote.

### Color and uncertainty

The rounded home percentage controls a symmetric three-band color scale:

- 55-100%: green, advantage for the home player;
- 46-54%: amber, broadly balanced;
- 0-45%: red, advantage for the away player.

Color is not the only signal: the numeric percentage remains visible, the legend names all three states, and accessible labels include the textual state.

A visible `?` and an uncertainty description are added when either compared slot has any of these conditions:

- `confidence` is `very-low`;
- `evidence` is `neutral` or `historical-fallback`;
- `rosterUnconfirmed` is true;
- the percentage helper had to use its defensive 50:50 fallback.

Historical evidence with a stronger supported confidence is not automatically marked uncertain. Existing evidence and roster explanations elsewhere in the preview remain visible.

## Responsive behavior

The shell and carousel never cause document-level horizontal overflow. The carousel track and matrix each own their horizontal movement.

At narrow widths:

- carousel cards retain neighboring-card visibility and snap cleanly;
- team and player names wrap or truncate only within their bounded cells;
- the matrix uses a minimum readable width inside its scroll region;
- the home-player header column remains visible when practical through a sticky first column;
- full names remain present in semantic headers and accessible cell labels;
- the matrix region receives a short `Seitlich wischen` hint only when it actually overflows.

At desktop widths, the matrix fits the available panel when possible and the carousel displays multiple cards without stretching them across the complete page.

Reduced-motion users receive immediate scrolling and no scale or slide transitions. Focus, selected state, and percentage meaning remain clear without animation, hover, or color.

## Failure and empty states

- No detected games: omit the carousel and keep manual selection usable.
- One detected game: render one compact card without redundant navigation.
- Missing date: render `Termin offen`.
- Fewer than four known players: preserve neutral lineup completion and render all 16 cells with uncertainty where applicable.
- Malformed player ratings: render an uncertain 50:50 cell through the pure helper.
- Stale remembered match or unresolved team: preserve the existing guarded failure message and manual controls.
- Missing Match Preview model: preserve the current accessible `Match-Preview ist derzeit nicht verfügbar` error panel.

## Testing requirements

### Pure model tests

- Equal valid ratings produce exactly 50:50.
- Unequal valid ratings use the approved ratio and complementary integer percentages total 100.
- The calculation consumes adjusted rating before raw rating.
- Malformed, non-finite, zero, or out-of-range inputs fail closed to uncertain 50:50.
- Neutral, historical-fallback, very-low-confidence, and unconfirmed slots mark the result uncertain.
- Supported historical or current evidence does not gain an uncertainty marker solely because it is historical.

### DOM contract tests

- Multiple games render inside one carousel track rather than as a vertical list.
- Every game is a semantic card button with a safe accessible name and pressed state.
- Card activation preserves existing auto-fill, stale-action, manual-interaction, and distinct-team guards.
- Previous, next, and Arrow key controls browse one card at a time and respect the ends.
- One game omits redundant controls; no games preserve manual selection.
- The matrix is a four-by-four semantic table with row and column headers.
- All 16 cells show bounded whole percentages and safe full-name accessible labels.
- Threshold classes match 55-100, 46-54, and 0-45.
- Uncertainty markers follow the approved evidence rules.
- Hostile published names remain inert text in carousel cards, table headers, and labels.

### Responsive and integration tests

- At 320, 390, and desktop widths, the document does not overflow horizontally.
- The carousel scroll position changes and cards remain reachable by touch-equivalent scrolling, buttons, and keyboard.
- A narrow overflowing matrix changes its own `scrollLeft` while the page remains fixed.
- The selected card, league, teams, four-player lineups, team forecast, form display, and matrix stay synchronized.
- Reduced-motion mode removes smooth scrolling and nonessential transitions.
- Existing Match Preview dependency, security, season-context, and historical-data regression tests remain green.
- JavaScript syntax checks, focused JavaScript tests, focused Python wrappers, the complete Python suite, `git diff --check`, and GitHub Pages runtime contracts pass before publication.

## Success criteria

- Upcoming games no longer form a full-page vertical list.
- A user can browse and select every detected game on a small smartphone without moving the document horizontally.
- The selected fixture is unmistakable and still drives the existing guarded auto-fill flow.
- All 16 one-on-one relationships are visible as a coherent four-by-four percentage matrix.
- Every visible percentage has an exact complement to 100 and is described as relative strength rather than win probability.
- Uncertain evidence remains visible rather than being hidden behind precise-looking percentages.
- Player and team names remain safe, accessible, and readable across supported widths.
- No fixture, roster, historical, calibration, team forecast, or deployment contract changes unintentionally.

## Expected implementation scope

Implementation is confined to:

- one pure pair-strength helper and export in `match_preview_model.js`;
- Match Preview rendering and interaction in `bundle_v31.js`;
- Match Preview presentation and responsive rules in `style.css`;
- focused Match Preview model, DOM, security, accessibility, and responsive tests;
- the Python wrappers or source contracts that intentionally mirror those focused checks;
- cache-busting and service-worker asset compatibility required to publish the changed static files;
- a concise Match Preview user-guide clarification if the visible terminology changes.

Archive generation, historical retention, calendars, favorites, league tables, Ligapokal, profiles, and unrelated tools remain out of scope.
