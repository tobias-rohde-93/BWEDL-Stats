# Historical Match Preview Segment Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every archive season and every legitimate player/class/club segment, then use the segment evidence safely in the already implemented historical Match Preview.

**Architecture:** Keep `ARCHIVE_DATA[playerId] -> seasonContainers[]` backward-compatible and add deterministic `segments[]` to each enriched season. Parser and validator preserve all source segments; the pure model adapts legacy flat records and aggregates valid segment evidence without guessing identities or affiliations. The public artifact is replaced only after two identical real generations, ready-gate publication, and a non-skipped chronological backtest.

**Tech Stack:** Python 3.13, Playwright archive scraper, SHA-256 canonical JSON, existing ready-gated pipeline, vanilla JavaScript UMD model, Node `assert`, pytest, Chromium, static GitHub Pages.

---

## Scope and file map

**Modify**

- `pipeline/archive_players.py` — administrative round parsing, segment construction, season containers, deterministic identities.
- `archive_scraper.py` — discover every archive season and pass stable table context into the parser.
- `pipeline/validation.py` — strict v1/v2 validation, lossless migration, per-segment no-loss gate and metrics.
- `tests/fixtures/archive_ranking_players.json` — multi-class, transfer, administrative-marker, overlap, and older-season fixtures.
- `tests/test_archive_players.py` — segment parser and container contracts.
- `tests/test_scraper_outputs.py` — all-season discovery, multi-table merge, deterministic candidate and failure diagnostics.
- `tests/test_validation.py` — v2 schema, migration, ambiguity, no-loss, marker and segment rewrite contracts.
- `tests/test_update_data.py` — ready-gated publication and exact-byte retention.
- `match_preview_model.js` — dual reader, segment aggregation, class means, prior, roster and participant resolution.
- `tests/test_match_preview_model.js` — multi-segment statistics, identity, roster, cutoff and mutation contracts.
- `tests/test_match_preview_backtest.js` — segment-aware chronology and coverage assertions without weaker quality gates.
- `tests/test_match_preview_backtest.py` — unchanged pytest execution/skip boundary; update only for new exact output fields.
- `bundle_v31.js` — render multi-class provenance if the model returns more than one source class.
- `tests/test_historical_match_preview_ui.js` — safe multi-class evidence text and no player-season duplication.
- `tests/test_reported_ui_regressions.js` — career/preview consumers count one season container once.
- `README.md` and `USER_GUIDE.md` — clarify all-season storage versus two-season forecasting.
- `archive_data.js` — only the twice-generated, validated real artifact.

No league, ranking, club, calendar, Ligapokal, service-worker, or favorites artifact is in scope.

### Task A: Parse lossless archive segments and all observed round markers

**Files:**
- Modify: `pipeline/archive_players.py`
- Modify: `tests/fixtures/archive_ranking_players.json`
- Modify: `tests/test_archive_players.py`

- [ ] **Step 1: Add failing segment fixtures and tests**

Add one same-season Bezirksliga/A pair for ID `1416`, one same-class club transfer, numeric zero, `x`, `VW`, `Vw`, `D`, `d`, `kp`, and `*`. Assert unknown `?` blocks. The public test shape is:

```python
result = merge_archive_entries([
    parsed_segment(id="1416", season="2025/2026", league="Bezirksliga", v_nr="043", rounds={"R1": "VW", "R2": 5, "R3": 6}),
    parsed_segment(id="1416", season="2025/2026", league="A-Klasse", v_nr="043", rounds={"R1": 7, "R2": 8, "R3": 9, "R4": 10, "R5": 10}),
])
container = result["1416"][0]
assert container["season"] == "2025/2026"
assert container["points"] == 55
assert len(container["segments"]) == 2
assert {segment["league"] for segment in container["segments"]} == {"Bezirksliga", "A-Klasse"}
```

Add a collision test proving identical semantic segments raise `ArchivePlayerParseError`, and a name-conflict test proving both raw names remain stored while the container is marked identity-ambiguous.

- [ ] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests/test_archive_players.py -q -p no:cacheprovider
```

Expected: the duplicate player-season fixture still raises `duplicate player-season identity`, and observed administrative markers still raise `invalid round value`.

- [ ] **Step 3: Implement canonical segment construction**

In `pipeline/archive_players.py`, add exact helpers:

```python
ADMIN_ROUND_MARKERS = frozenset({"x", "vw", "d", "kp", "*"})

def parse_round_value(value: Any) -> int | str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    if re.fullmatch(r"[0-9]+", text):
        return int(text)
    if not text:
        return ""
    if text.casefold() in ADMIN_ROUND_MARKERS:
        return text
    raise ArchivePlayerParseError(f"invalid round value: {text!r}")

def archive_segment_id(player_id: str, season: str, segment: Mapping[str, Any]) -> str:
    payload = json.dumps(
        [player_id, season, segment],
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()
```

`parse_archive_player_row` must retain allowed marker spelling, count only integers including zero, and keep the existing exact numeric-sum rule. It returns a source segment with the stable outer ID still present for merging.

For the distinct `V-Nr.` source field, preserve the observed `Vw` value as segment-only `affiliation_marker` after NFKC+trim when case-folded to the exact initial allowlist `{vw}`. It is mutually exclusive with numeric `v_nr`, participates in the SHA-256 segment identity, and never supplies roster or participant affiliation. Reproduce live player `746` in `2020/2022` Bezirksliga with 3 points and one appearance; reject every unknown nonblank token with full scraper provenance.

- [ ] **Step 4: Implement deterministic season containers**

Change `merge_archive_entries` to group by `(player_id, canonical_season)`, construct immutable semantic segments, assign IDs, reject segment-ID collisions, sort segments deterministically, and publish one container per season. Use safe integer sums for container points. Publish flat preview fields only for one-segment containers. Mark `identity_ambiguous` and `round_overlap_ambiguous` without deleting source segments.

The primary display segment is selected by `(last_numeric_round, appearances, reverse_lexical_segment_id)` descending. Analytics must not consume the compatibility projection.

- [ ] **Step 5: Run GREEN and commit**

Run the parser suite and `python -m py_compile pipeline/archive_players.py`. Then:

```powershell
git add -- pipeline/archive_players.py tests/fixtures/archive_ranking_players.json tests/test_archive_players.py
git commit -m "feat: preserve segmented archive seasons"
```

### Task B: Scrape every discovered season and retain segment context

**Files:**
- Modify: `archive_scraper.py`
- Modify: `tests/test_scraper_outputs.py`

- [ ] **Step 1: Write failing all-season and multi-table tests**

Create a fake archive navigation containing `2018/2019`, `2020/2022`, and `2025/2026`. Assert all three canonical seasons are requested and published. Add two distinct league tables containing ID `1416` in the same season and assert one season container with two segments. Assert an unknown round marker exits nonzero, leaves the public root unchanged, and writes contextual diagnostics.

- [ ] **Step 2: Run RED**

```powershell
python -m pytest tests/test_scraper_outputs.py -q -p no:cacheprovider -k "archive"
```

Expected: `2018/2019` is filtered by the current hard-coded start year and multi-table rows reach the old duplicate-season failure.

- [ ] **Step 3: Remove the fixed start-year filter**

Accept every unique canonical season exposed by archive navigation. Sort by canonical start/end year, newest first. Pass the exact season and league/table label with each parsed row so failures identify season, table, row, and round. Do not derive chronology from table order.

- [ ] **Step 4: Verify deterministic orchestration and commit**

Run the full scraper-output suite twice against the fake pages and compare emitted bytes. Then:

```powershell
git add -- archive_scraper.py tests/test_scraper_outputs.py
git commit -m "feat: scrape all archive season segments"
```

### Task C: Validate v2 containers and lossless migration

**Files:**
- Modify: `pipeline/validation.py`
- Modify: `tests/test_validation.py`
- Modify: `tests/test_update_data.py`

- [ ] **Step 1: Write failing v2 and migration tests**

Add strict tests for segment IDs, canonical ordering, safe sums, exact derived fields, allowed marker spelling, unknown markers, name/overlap ambiguity flags, duplicate IDs, and unsafe numbers. Prove one previous totals-only record may migrate only when exactly one candidate segment matches its stable ID, season, normalized name, league, rank, and points.

Add a refresh test in which removing or changing any previously published segment returns `BLOCKED` and leaves `archive_data.js` bytes unchanged. Adding an older season or a new valid segment remains `PUBLISH`.

- [ ] **Step 2: Run RED**

```powershell
python -m pytest tests/test_validation.py tests/test_update_data.py -q -p no:cacheprovider -k "archive"
```

Expected: v2 containers are treated as malformed flat records and per-segment loss is not detected.

- [ ] **Step 3: Implement strict dual-schema validation**

Introduce `_archive_segments(record, player_key)` returning either one validated virtual legacy segment or a tuple of validated v2 segments. Validate every segment with the existing core and preview evidence rules, extended so strings are allowed only when `casefold()` is in the administrative allowlist. Recompute segment IDs and container aggregates; never trust published derived values.

Migration comparison uses:

```python
legacy_match = (
    player_key,
    canonical_season,
    normalized_name,
    normalized_league,
    rank,
    points,
)
```

and requires exactly one candidate segment match. V2 refresh comparison uses full canonical segment JSON keyed by segment ID. Emit deterministic metrics for seasons, containers, segments, preview-eligible segments, totals-only segments, markers, and ambiguity exclusions.

- [ ] **Step 4: Run GREEN and commit**

```powershell
python -m pytest tests/test_validation.py tests/test_update_data.py -q -p no:cacheprovider
git add -- pipeline/validation.py tests/test_validation.py tests/test_update_data.py
git commit -m "feat: validate segmented archive evidence"
```

### Task D: Aggregate segment evidence in the pure forecast model

**Files:**
- Modify: `match_preview_model.js`
- Modify: `tests/test_match_preview_model.js`

- [ ] **Step 1: Write failing model contracts**

Add tests proving:

- legacy flat records remain readable as one virtual segment;
- two same-class club segments aggregate before the four-appearance prior;
- two source classes convert separately, appearance-weight, then receive the prior once;
- numeric zero counts as an appearance;
- administrative markers never count;
- a multi-class season is excluded from transition learning;
- same class/club conflicting round overlap excludes only that player-season;
- an identity-ambiguous season does not discard other valid seasons;
- only the latest two completed season containers enter an individual prior;
- latest affiliation uses the greatest numeric played round and ties across clubs fail closed;
- all inputs and returned segments remain frozen/non-mutated.

The two-class expected value must be explicit:

```js
const converted = ((5 * 2) + (7 * 6)) / 8;
const expected = (converted * 8 + 4 * targetClassMean) / 12;
assert.equal(prior.seasons[0].rating, expected);
```

- [ ] **Step 2: Run RED**

```powershell
node tests/test_match_preview_model.js
```

Expected: `buildArchiveIndex` rejects the v2 container or reads only its compatibility projection.

- [ ] **Step 3: Implement the dual reader and aggregates**

Refactor normalized season records to contain frozen validated segments. `buildClassSeasonMeans` aggregates one player/class/season contribution. `buildClassCalibration` accepts only single-class season evidence. `buildHistoricalPrior` converts class groups, appearance-weights them, and applies the target prior once. Preserve exact one-segment behavior where source and target class are equal.

Roster and outcome participant resolution must use segment-local rounds and stable player IDs. They must never use `primary_segment_id` or compatibility `league`/`v_nr` for analytics.

An allowlisted segment `affiliation_marker` keeps the segment eligible for class performance and priors, but latest-roster affiliation and outcome participant indexing must ignore it and require a real numeric club/team mapping.

- [ ] **Step 4: Run GREEN, benchmarks, and commit**

Run the Node model suite, its pytest wrapper, syntax check, existing 100/250/500 match counters, and a 5,000-segment benchmark proving no quadratic scan. Then:

```powershell
git add -- match_preview_model.js tests/test_match_preview_model.js
git commit -m "feat: forecast from segmented player history"
```

### Task E: Preserve UI provenance and chronological backtest gates

**Files:**
- Modify: `bundle_v31.js`
- Modify: `tests/test_historical_match_preview_ui.js`
- Modify: `tests/test_reported_ui_regressions.js`
- Modify: `tests/test_match_preview_backtest.js`
- Modify: `tests/test_match_preview_backtest.py` only if exact successful output fields change.

- [ ] **Step 1: Write failing UI and backtest tests**

Render a player with Bezirksliga and A-Klasse segments into a B-Klasse preview. Assert safe text states both source classes and the target class without duplicating the player or season. Existing evidence labels, four slots, manual selection, form labels, and hostile-text contracts remain unchanged.

Extend the chronological fixture with a multi-class season, a transfer, an ambiguous overlap, and an administrative marker. Assert no target-season leakage, ambiguous exclusion, nonzero overall/class-change samples, and the unchanged MAE comparisons.

- [ ] **Step 2: Run RED**

```powershell
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
node tests/test_match_preview_backtest.js
```

Expected: provenance is singular or the backtest still follows flat compatibility fields.

- [ ] **Step 3: Render segment provenance and use segment-aware backtesting**

Use model-returned fixed arrays such as `sourceClasses` and `sourceSeasons`; join them into safe `textContent`. Never read raw `segments` in the bundle. The backtest must consume the public model API with a strict `beforeSeason` cutoff and report coverage/exclusion counts without weakening MAE, calibration, or sample assertions.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
node tests/test_match_preview_backtest.js
python -m pytest tests/test_historical_match_preview_ui.py tests/test_match_preview_model.py tests/test_match_preview_backtest.py -q -p no:cacheprovider
git add -- bundle_v31.js tests/test_historical_match_preview_ui.js tests/test_reported_ui_regressions.js tests/test_match_preview_backtest.js tests/test_match_preview_backtest.py
git commit -m "feat: explain segmented historical evidence"
```

### Task F: Generate, validate, publish, and audit the real all-season artifact

**Files:**
- Modify: `archive_data.js`
- Modify: `README.md`
- Modify: `USER_GUIDE.md`

- [ ] **Step 1: Generate outside the public root**

Create `.match-preview-segments-staging` and `.match-preview-segments-artifacts`, verify both resolve as direct children of the isolated worktree, and run the production archive scraper. If Playwright is sandbox-blocked, repeat the identical command with approval.

- [ ] **Step 2: Validate before copying**

Use `parse_javascript_assignment` and `validate_archive_payloads` against the committed artifact and archive tables. Require `PUBLISH`, every previous player-season retained, all discovered seasons present, nonzero segment/admin/preview metrics, and nonzero enriched records in the latest two completed seasons.

- [ ] **Step 3: Run the real backtest before public-root mutation**

Point the real backtest at the staged candidate. It must run rather than skip, report nonzero overall and class-change samples, zero leakage, and pass unchanged hybrid-versus-baseline MAE gates. A failure leaves the committed artifact untouched.

- [ ] **Step 4: Prove determinism**

Generate independently into `.match-preview-segments-staging-2` and `.match-preview-segments-artifacts-2`. Require identical SHA-256 for `archive_data.js` and identical validator metrics.

- [ ] **Step 5: Copy only the validated artifact and verify consumers**

Copy the first candidate to `archive_data.js`. Run parser, validation, update, model, UI, backtest, public-runtime, browser-security, and full pytest suites; run Node syntax checks and `git diff --check`. Verify career/history consumers count each player-season once and Match Preview uses only two completed seasons.

- [ ] **Step 6: Update documentation and clean exact task paths**

README and USER_GUIDE must say that every source-discovered archive season is stored, while a forecast uses two completed seasons. Resolve and print the four exact staging/artifact paths, require each parent equals the isolated worktree, and remove only those paths. Do not touch inaccessible pytest/reviewer directories.

- [ ] **Step 7: Commit**

```powershell
git add -- archive_data.js README.md USER_GUIDE.md
git commit -m "chore(data): publish segmented player history"
```

## Plan self-review checklist

- Every approved segment-design requirement maps to Tasks A-F.
- Storage contains all discovered seasons; forecast depth remains exactly two completed seasons.
- Source rows are never silently deduplicated or assigned by name.
- Administrative markers are preserved and never treated as points or appearances.
- The observed `V-Nr.` marker is preserved only as segment `affiliation_marker`; it is performance-only and never guessed as a club.
- Compatibility fields are display-only; analytics use validated segments.
- V1 migration is lossless, and subsequent v2 segment rewrites/removals block.
- Multi-class seasons cannot contaminate transition calibration.
- Real publication requires PUBLISH, two identical generations, a non-skipped unchanged-gate backtest, full tests, and browser evidence.
- No task authorizes push, merge, deployment, unrelated cleanup, or edits to league/calendar/favorites/Ligapokal artifacts.
