# Historical Match Preview Segment Archive Design

## Status

Approved by the user on 2026-08-20. This document amends the approved Historical Match Preview design after the real BWEDL archive showed legitimate multi-class and transfer rows for the same stable player ID and season. Where this amendment conflicts with the original single-record assumption, this document governs.

## Confirmed source reality

The real archive exposes four distinct ranking tables per discovered season. Across the five seasons previously selected by the scraper, 196 player-season identities have 205 additional source rows. The rows are not duplicated tables or repeated DOM rows. They represent real class segments, club transfers, and a small number of identity ambiguities. The newest two completed seasons alone contain 68 affected player-season identities.

Historical round cells also contain bounded administrative markers such as `x`, `VW`, `Vw`, `D`, `d`, `kp`, and `*`. These values are not points and are not appearances. Unknown nonblank markers remain a source-schema error and block publication.

The live `2020/2022` Bezirksliga ranking also contains player `746` with `V-Nr. = Vw`, 3 points, and one numeric appearance. For this separate source field, a segment-only `affiliation_marker` preserves the NFKC-normalized, trimmed source spelling when its case-folded value is in the initial closed allowlist `{vw}`. It is mutually exclusive with numeric `v_nr`, is included in canonical segment identity, and never identifies a club or team. The segment's valid round performance remains analytically eligible; roster membership and match participation remain unresolved. Any other nonblank `V-Nr.` token blocks with full season/table/league/row context.

The committed legacy artifact contains 1,229 players and 3,401 player-season records across five seasons, but all records are totals-only. The new publication must retain every legacy player-season and may add every older season that the live archive navigation exposes. A hard-coded start year is not permitted.

## Artifact schema

The outer contract remains backward-compatible:

```js
window.ARCHIVE_DATA = {
  "1416": [
    {
      "season": "2025/2026",
      "name": "Ingo Eichenhofer",
      "rank": 11,
      "points": 55,
      "league": "A-Klasse",
      "primary_segment_id": "sha256:...",
      "segments": [
        {
          "segment_id": "sha256:...",
          "name": "Ingo Eichenhofer",
          "rank": 11,
          "points": 11,
          "league": "Bezirksliga",
          "v_nr": "043",
          "rounds": {"R1": "VW", "R2": 5, "R3": 6},
          "appearances": 2,
          "points_per_appearance": 5.5
        },
        {
          "segment_id": "sha256:...",
          "name": "Ingo Eichenhofer",
          "rank": 44,
          "points": 44,
          "league": "A-Klasse",
          "v_nr": "043",
          "rounds": {"R1": 7, "R2": 8, "R3": 9, "R4": 10, "R5": 10},
          "appearances": 5,
          "points_per_appearance": 8.8
        }
      ]
    }
  ]
};
```

Each stable outer player ID still owns one history array and at most one container per canonical season. Every source row becomes one immutable segment. `segment_id` is the lower-case SHA-256 of canonical JSON containing the outer ID, canonical season, and all semantic segment fields. Exact segment-ID collisions block publication rather than being silently dropped.

The season container keeps compatibility fields for existing career views. `points` is the safe sum of all segment points and `rank` is the best numeric segment rank. `league`, `name`, and `primary_segment_id` come from a deterministic display segment: greatest last numeric round, then greatest appearances, then lexical segment ID. These compatibility fields are never used by Match Preview analytics. Flat `v_nr`, `rounds`, `appearances`, and `points_per_appearance` are published only when the container has exactly one segment.

`affiliation_marker` remains segment-only even for a one-segment container. Validation recomputes it from source segments, requires exact canonical spelling and the closed allowlist, and rejects `v_nr` plus `affiliation_marker` on the same segment. Legacy v1 records do not gain this field.

Segment order is deterministic: normalized regular-class order, normalized league label, club number with missing values last, rank, then segment ID. Season containers remain newest-first; player IDs remain lexical. JSON is finite, UTF-8, deterministic, and contains no host paths.

## Round and identity rules

- Non-negative JavaScript-safe integers are played-round points and count as appearances, including numeric zero.
- Empty cells and the observed administrative marker allowlist are preserved as normalized, trimmed strings and do not count as appearances or points.
- Unknown nonblank markers block the candidate with season, table, row, and round context.
- Numeric round sums must equal segment `points`; derived appearances and average must be exact within the existing deterministic tolerance.
- A repeated round number in different classes or clubs is segment-local and must not be deduplicated globally.
- Conflicting numeric values for the same player, season, normalized class, club, and round make that player-season analytically ambiguous. All source segments remain stored, but the season is excluded from preview ratings and calibration.
- Conflicting normalized names within one stable ID and season are preserved on their segments and mark only that season identity-ambiguous. Name-only joins remain forbidden.

## All-season storage and two-season forecasting

The scraper follows every canonical season offered by the archive navigation. It no longer filters by a fixed year. Older totals-only layouts remain stored for career/history views even when they provide no usable Match Preview evidence.

Storage depth and forecast depth are separate contracts:

- all discovered past seasons are stored and validated;
- older enriched seasons may contribute to class-transition calibration and chronological backtesting;
- an individual forecast still uses exactly the two most recent completed seasons before the target season;
- the preceding season is never replaced by a third-older season when it is unusable.

## Rating and calibration

The model dual-reads legacy flat records as virtual one-segment containers and validates v2 containers descriptor-safely.

For one player-season:

1. Group eligible segments by normalized source class.
2. Sum points and actual appearances inside each class group; club transfers inside the same class do not receive an extra prior.
3. Convert each class-group raw average to the target class only when the observed transition graph supports it.
4. Appearance-weight the converted class-group averages.
5. Apply the four-appearance target-class prior exactly once to the combined player-season evidence.

If a class group cannot be calibrated, the rating remains available through its conservative unconverted value, but the season and player confidence become `very-low`. Multi-class seasons are excluded from learning transition offsets because they do not provide one unambiguous source class for that season.

Class-season means aggregate each stable player ID at most once per class and season. Segment splitting must not give one player extra population weight.

## Roster and participant resolution

Current published affiliation remains authoritative. Historical roster membership uses the most recent completed roster season and, only when required to fill four slots, the immediately preceding completed season.

Within a historical season, the latest affiliation is determined by the greatest numeric round containing an appearance. If all segments at that latest round resolve to one club/team, that affiliation may be used. Different clubs/teams at the same latest round, missing numeric chronology, conflicting names, or unresolved mappings are ambiguous and produce no guessed player assignment. The neutral slot remains visible.

Outcome participant indexing operates on segment-local rounds and deduplicates the stable player ID inside one match. An analytically ambiguous player-season contributes no training example.

## Migration and validation

The ready gate supports one controlled v1-to-v2 migration:

- every previous legacy player-season must match exactly one candidate segment by stable ID, canonical season, normalized name, league, rank, and points;
- additive `v_nr`, round, appearance, average, and segment fields are permitted only when internally valid;
- every previously published v2 segment ID and full segment bytes must remain present in subsequent candidates;
- all previous seasons and tables remain a subset of the new candidate;
- source corrections that would rewrite or remove published segment evidence block publication for explicit review.

Metrics report discovered seasons, player-season containers, segments, administrative markers, totals-only segments, identity ambiguities, round overlaps, and preview-eligible segments.

## Failure behavior

Unknown markers, malformed identifiers, unsafe integers, duplicate segment identities, lost legacy records, lost seasons, non-deterministic generation, and schema drift block the entire candidate before public-root mutation. Identity and overlap ambiguities that are faithfully represented remain publishable but are excluded from analytics at the affected player-season boundary.

## Backtest and success criteria

The chronological backtest must run rather than skip after real enrichment. It must report nonzero overall and class-change samples, zero target-season leakage, coverage by season/class plus ambiguity exclusions, and the unchanged current-only and unadjusted-previous-season baselines. The hybrid model must meet the already approved MAE gates; the assertions may not be weakened merely because real data is harder.

Success additionally requires two independent real scrapes to produce byte-identical artifacts, all discovered seasons to be present, the production validator to return `PUBLISH`, the existing career views to count each player-season once, and the responsive Match Preview/browser/security contracts to remain green.
