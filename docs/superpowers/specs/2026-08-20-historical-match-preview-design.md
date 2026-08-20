# Historical Match Preview Design

## Status

Approved by the user on 2026-08-20. This document defines the product and data contract for making Match Preview useful before and during a season by combining current and historical BWEDL player data.

## Problem

Match Preview currently builds rosters and player strength exclusively from `ranking_data` for the selected current league. Before players have recorded results in the new season, a team can therefore have no selectable players. With only a few current appearances, a single unusually high or low result can also dominate the preview. The current percentage calculation compares two unadjusted lineup averages and does not account for the strength of the class in which earlier results were earned.

The preview must remain available from the start of the season, use actual appearances rather than ranking totals, compare performances across classes fairly, and explain when a forecast is based on uncertain historical roster information.

## Goals

- Provide a forecast for every scheduled regular-league matchup, including before the first matchday.
- Use points per actual appearance as the basic player-performance measure.
- Combine the two most recent completed seasons, with greater weight on the latest season.
- Let current-season evidence replace historical evidence continuously as appearances accumulate.
- Normalize performances earned in Bezirksliga, A-, B-, and C-Klasse using observed BWEDL class transitions.
- Avoid overrating players with very few appearances.
- Preserve user control over the four-player lineup.
- Show the source, recency, former class, roster certainty, and overall confidence of the forecast.
- Keep GitHub Pages as the only product runtime.

## Non-goals

- Claim that a historical roster is the officially registered current roster.
- Predict an exact real-world lineup without published current evidence.
- Infer a player transfer from names alone.
- Treat total ranking points as a performance average when appearances are unavailable.
- Add a server, database, account, or local runtime requirement.
- Guarantee a match result or hide model uncertainty behind a precise-looking percentage.
- Use cup matches or mixed competition formats to calibrate regular-class strength.

## Existing contracts to preserve

- Current league tables and fixtures remain the source for selectable matchups.
- `buildMatchPreviewTeams` continues to combine current table teams and ranking-derived teams, reject headings and byes, prefer exact normalized team matches, and deduplicate options.
- Current player identity and current club affiliation are authoritative over historical data.
- The home and away selections must both resolve and must not resolve to the same team.
- Team options and all new labels use safe DOM text APIs or the existing text-escaping boundary.
- The existing manual lineup selection, form display, pair matrix, and optimal-lineup feature remain available, but consume the adjusted player rating defined here.
- The ready-gated static publication workflow must retain the last valid artifacts if a new archive candidate is incomplete or invalid.

## Source data and artifact contract

The existing archive scraper already publishes player-season history in `archive_data.js`. Each usable player-season entry will be extended without removing current fields:

- `season`: canonical season identifier;
- `id`: stable BWEDL player identifier, also represented by the containing archive key;
- `name`: published player name;
- `v_nr`: the published club number for that season;
- `league`: the published class for that season;
- `rounds`: the published per-round values;
- `points`: the published season total;
- `appearances`: the count of numeric, actually played round values;
- `points_per_appearance`: `points / appearances` when `appearances > 0`.

The scraper and publication validators must require the following consistency for enriched entries:

- only finite non-negative numeric round results count as appearances;
- `appearances` equals the count of those round results;
- `points` equals their sum when the source exposes a complete round sequence;
- `points_per_appearance` equals the derived quotient within deterministic numeric precision;
- player ID, season, club number, and class must be non-empty and schema-valid;
- duplicate entries for the same player and season are rejected rather than silently overwritten.

If an old archive page exposes only a total and no complete round sequence, it may remain available to career views, but it is not eligible for Match Preview performance calculations. Existing archive consumers must continue to accept the added fields.

The two most recent completed seasons are used for an individual player's forecast. Older valid seasons may be used only to obtain a sufficiently robust population of class-transition observations and chronological backtests.

No new runtime API is introduced. GitHub Actions continues to generate and atomically publish the static artifacts consumed by GitHub Pages.

## Normalization and identity

Class names are normalized into the ordered regular-class categories `Bezirksliga`, `A-Klasse`, `B-Klasse`, and `C-Klasse`. Group and season suffixes do not create separate strength categories. Mix classes, cup competitions, unknown labels, and incompatible formats are not converted into this scale.

Historical entries are joined across seasons only when the stable player ID agrees and the normalized name does not contradict it. A name match without the stable ID is never sufficient. An ambiguity, duplicate, or contradictory identity fails closed for that player.

For roster assignment:

1. A published current-season player association is authoritative.
2. A player currently associated with another club is excluded from the old club's historical roster.
3. Otherwise, the most recent completed-season entry with the selected club number is a historical roster candidate.
4. If that roster provides fewer than four identifiable candidates, the preceding completed season may supply additional candidates up to four.
5. Second-season-only candidates are labeled more cautiously than latest-season candidates.
6. If a club/team mapping is ambiguous, the preview does not guess an individual assignment and uses the neutral fallback for the missing lineup slot.

## Player rating model

### 1. Seasonal performance

For player `p` in season `s`:

`raw(p,s) = points(p,s) / appearances(p,s)`

Only actual numeric round results contribute to either side of the quotient. Empty cells, `x`, headings, and administrative placeholders are not appearances.

### 2. Small-sample stabilization

Each completed-season value is shrunk toward the appearance-weighted mean of its class and season using four prior-equivalent appearances:

`stable(p,s) = (points(p,s) + 4 * class_mean(class,s)) / (appearances(p,s) + 4)`

This prevents one exceptional appearance from outranking a consistently strong full-season record. The initial model version fixes the prior strength at four; changing it later requires a model-version change and chronological backtest evidence.

### 3. Class adjustment

Class adjustments are learned from players who:

- have the same unambiguous stable identity in consecutive seasons;
- changed between regular ordered classes;
- recorded at least four actual appearances in each season;
- have complete round-derived performance data in both seasons.

For each adjacent class transition, observations are direction-normalized and aggregated with a robust weighted median so outliers and one-game effects cannot dominate. At least eight qualifying transition pairs are required for a published adjacent-class adjustment. Adjustments are chained only across adjacent categories and expressed on the selected matchup's current-class scale.

If an applicable transition lacks the required sample, no invented class factor is applied. The player's forecast remains available, but confidence is downgraded and the UI states that the historical class change is not calibrated. Mix classes and unknown classes use the same fail-safe behavior.

Consequently, equal raw averages from different classes need not produce equal adjusted ratings. A performance earned against stronger-class opposition can result in a higher current-class equivalent.

### 4. Two-season historical prior

After class adjustment to the current matchup's class:

- the latest completed season receives 70% weight;
- the preceding completed season receives 30% weight;
- if exactly one usable season exists, it receives 100% weight;
- if neither is usable, the current-class mean becomes the neutral prior.

The second historical season changes the performance prior, but it supplies roster candidates only under the limited fallback rule defined above.

### 5. Current-season transition

When current results exist, the historical value acts as four prior-equivalent appearances:

`current_rating = (current_points + 4 * historical_prior) / (current_appearances + 4)`

This makes current evidence contribute approximately two thirds of the rating after eight appearances and 80% after sixteen appearances. With no current appearance, the historical prior remains the rating. A player with current data but no usable history uses the current-class mean as the prior.

The displayed player value is always the adjusted rating, never the unqualified season total.

## Team roster and lineup behavior

The team roster shown in Match Preview is assembled in this order:

1. current-season players assigned to the team;
2. latest completed-season historical candidates not contradicted by current affiliation;
3. preceding-season candidates, only when fewer than four candidates exist;
4. neutral current-class placeholders for any remaining lineup slots.

Players are sorted first by usable evidence and then by adjusted rating. The four strongest candidates are selected automatically. Users may select or remove known players exactly as today.

A forecast always models four lineup slots. If fewer than four known players are selected or available, each missing slot uses the current-class neutral prior and is rendered as an explicit neutral estimate. Missing players are not silently treated as zero-strength players.

The optimal-lineup calculation and one-on-one comparison matrix use adjusted ratings. Historical form can show the per-round values from the season supplying the visible evidence. It must not present a historical series as current form.

## Match forecast

The existing ratio `strengthA / (strengthA + strengthB)` is not retained as a claimed win probability. The forecast layer consumes the four adjusted lineup ratings, home/away state, and their evidence uncertainty.

Where sufficient unambiguous historical training matches exist, an ordered outcome model is calibrated chronologically to produce separate home-win, draw, and away-win probabilities. Training examples may be used only when both teams, the class, match result, and the participating round can be connected without ambiguous club/team assignment. Ambiguous multi-team club cases are excluded from calibration rather than guessed.

The model reports:

- the central home/draw/away forecast;
- a plausible probability range derived from player, roster, class-adjustment, and calibration uncertainty;
- a team score for comparing the selected lineups;
- the quality and provenance of the evidence.

If the historical match sample is insufficient to calibrate outcome probabilities, the UI displays a relative lineup-strength comparison instead of labeling the result a probability. The preview remains available through the neutral fallback.

Direct historical team meetings may be displayed as separate context. They do not receive an additional hidden weight in the player-based forecast, avoiding double counting.

## Confidence and user-facing explanation

Each player row states its evidence source using one of these labels:

- `Aktuell`;
- `Aktuell + Historie`;
- `Vorjahreskader`;
- `Historischer Ersatzkader`;
- `Neutraler Klassenwert`.

Applicable transitions are shown, for example `Klassenwechsel: A -> B`. Historical roster candidates also show `Kaderzugehörigkeit unbestätigt` until current-season evidence confirms them.

Player confidence follows these rules:

- `hoch`: at least eight current appearances and no identity or class ambiguity;
- `mittel`: one to seven current appearances with usable history, or two usable completed seasons with adequate appearances and calibrated class conversion;
- `vorläufig`: historical roster evidence only, or only one usable historical season;
- `sehr unsicher`: a neutral placeholder, second-season-only roster fallback, or uncalibrated/ambiguous class conversion.

Team confidence cannot exceed the weakest evidence that materially fills the four slots. Two or more neutral placeholders make the team forecast `sehr unsicher`.

The result must explain the source in plain language. A representative presentation is:

> SchömbergerEck 57% - Unentschieden 12% - Heavy Weights 31%
> Plausibler Heimsieg-Bereich: 49-64%
> Datenqualität: mittel
> Heavy Weights basiert teilweise auf einem historischen A-Klasse-Spieler und drei neutral geschätzten B-Klasse-Plätzen.

Exact percentages in documentation are illustrative, not prescribed outputs.

## Failure and publication behavior

- A failed or incomplete archive scrape must not replace the last ready archive artifacts.
- Malformed numeric data, duplicate player-season entries, contradictory stable identities, and unsafe text cause the affected candidate or candidate publication to fail closed according to the existing ready gate.
- Unknown class labels produce no fabricated conversion.
- Absence of historical data produces a labeled neutral forecast, not a broken selector or an empty result.
- Current affiliation changes invalidate stale historical roster assignment immediately after the new static data publication.
- All displayed source strings remain untrusted data and pass the existing safe text boundary.
- The service worker version and asset policy must be updated so a deployed model never combines incompatible bundle and archive schemas.

## Backtesting and calibration

Validation is chronological. For each eligible historical target season, only data that would have been available before that season or match may be used to construct the forecast.

Backtests cover:

- player points-per-appearance error against the subsequent observed season;
- promoted and relegated players separately;
- players with one to three appearances separately from established players;
- outcome calibration and Brier score where unambiguous historical team matches can be reconstructed;
- coverage and accuracy of the displayed plausible ranges;
- comparison against a current-only baseline and an unadjusted previous-season baseline.

No tuning run may use its target season as training data. Calibration parameters and their schema/model version are deterministic for the same committed input artifacts.

## Testing requirements

### Scraper and pipeline tests

- Parse per-round historical ranking values, appearances, club number, identity, and class from representative archive layouts.
- Reject duplicate, contradictory, partial, and non-numeric performance entries.
- Preserve career-only historical entries without treating totals-only records as Match Preview evidence.
- Retain previous published artifacts after candidate failure.
- Produce byte-deterministic artifacts from the same source inputs.

### Model unit tests

- Calculate points per actual appearance and ignore non-appearance cells.
- Stabilize one-appearance outliers toward the class mean.
- Apply two-season 70/30 weighting and renormalize when one season is missing.
- Learn and apply directionally correct A-to-B, B-to-C, and chained adjustments from qualifying transitions.
- Downgrade rather than invent an adjustment below the transition sample threshold.
- Blend current evidence with four historical prior-equivalent appearances.
- Make current affiliation override historical assignment.
- Reject name-only and contradictory identity joins.
- Fill fewer-than-four lineups with visible neutral class placeholders.
- Keep forecasts available when no historic player can be assigned.

### UI and integration tests

- Render current, combined, historical, and neutral evidence labels safely.
- Show the former and current class for adjusted players.
- Keep manual selection, four-slot behavior, pair comparison, and optimal lineup functional.
- Distinguish current form from historical form.
- Show three-way probabilities only when the outcome model is calibrated; otherwise show relative strength.
- Show confidence and neutral-fallback explanations on desktop and small smartphone screens.
- Verify GitHub Pages subpath loading, offline behavior for the last compatible cached release, and service-worker schema compatibility.
- Preserve exact team matching, distinct home/away selection, and safe option construction regressions.

## Success criteria

- Every scheduled regular-league matchup can produce a four-slot preview before the first matchday.
- The preview never derives player quality from total points without actual appearance evidence.
- A player with one exceptional appearance cannot outrank an established player solely because of that raw average.
- Cross-class history is adjusted only from qualified observed transitions and is visibly identified.
- After eight current appearances, current results contribute approximately two thirds of a player's combined rating.
- Current transfers remove stale historical roster assignments.
- Unknown teams and incomplete rosters receive explicit neutral estimates instead of zeroes or `Keine Spieler gefunden`.
- Users can see which seasons, classes, and roster assumptions produced the result.
- The full automated suite, focused scraper/model/UI contracts, syntax checks, deterministic generation, mobile browser smoke, and `git diff --check` pass before publication.

## Expected implementation scope

The implementation plan should confine changes to the archive scraper and validators, pure Match Preview model helpers, Match Preview rendering and styles, static data fixtures/artifacts, focused tests, user documentation, service-worker compatibility, and the bounded GitHub publication allowlist if the artifact contract requires it. Unrelated league, calendar, favorites, and Ligapokal behavior remain out of scope.
