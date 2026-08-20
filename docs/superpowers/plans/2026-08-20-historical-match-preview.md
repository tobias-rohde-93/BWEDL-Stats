# Historical Match Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Match Preview available and meaningfully calibrated from the first matchday by combining two completed seasons, current appearances, observed class transitions, and explicit neutral fallbacks.

**Architecture:** Extend the existing `archive_data.js` player-season records with round-derived evidence while preserving legacy career entries. Put all rating, class calibration, roster resolution, and forecast logic in a new pure UMD module that runs unchanged in Node tests and the GitHub Pages browser; keep `bundle_v31.js` responsible only for selection and rendering. The existing ready-gated archive publication remains authoritative, and incompatible bundle/data combinations are prevented by versioned static assets and a service-worker cache bump.

**Tech Stack:** Python 3.13, Playwright scraper, existing `pipeline.validation` ready gate, vanilla JavaScript UMD modules, Node `assert`, HTML/CSS, pytest, GitHub Actions, static GitHub Pages PWA.

---

## Scope and file map

Implementation must begin in an isolated worktree created with `superpowers:using-git-worktrees`, because the main worktree contains the unrelated user-owned modification `.agent/rules/git-workflow.md`.

**Create**

- `pipeline/archive_players.py` — pure parsing and enrichment of historical ranking rows.
- `match_preview_model.js` — pure class calibration, player prior, roster, lineup, and outcome forecast API.
- `tests/fixtures/archive_ranking_players.json` — representative modern, legacy, incomplete, and malformed archive tables.
- `tests/test_archive_players.py` — historical row-parser contracts.
- `tests/test_match_preview_model.js` — deterministic statistical and roster unit contracts.
- `tests/test_match_preview_model.py` — pytest wrapper so CI executes the Node contracts.
- `tests/test_historical_match_preview_ui.js` — focused renderer, mobile-label, and safe-text contracts.
- `tests/test_historical_match_preview_ui.py` — pytest wrapper for the UI contracts.
- `tests/test_match_preview_backtest.js` — chronological real-artifact comparison against the two baselines.
- `tests/test_match_preview_backtest.py` — pytest wrapper for the backtest.

**Modify**

- `archive_scraper.py` — collect table headers and delegate rows to `pipeline.archive_players`.
- `pipeline/validation.py` — validate enriched player evidence and allow a lossless legacy-to-enriched migration.
- `tests/test_validation.py` — ready-gate and migration regressions.
- `tests/test_scraper_outputs.py` — scraper orchestration and deterministic output regressions.
- `archive_data.js` — generated enriched historical player records after candidate validation.
- `bundle_v31.js` — consume the pure model, render evidence/confidence, fill four slots, and replace the raw ratio.
- `style.css` — responsive Match Preview evidence, probability, and fallback components.
- `index.html` — load the model before the bundle and bump changed asset keys.
- `sw_v31.js` — cache the model, bump the cache name, and keep archive data network-first.
- `tests/test_reported_ui_regressions.js` — preserve exact team matching and manual-selection behavior under the new model.
- `tests/test_season_context.js` — provide the model dependency to the extracted Match Preview renderer.
- `tests/test_browser_security.py` — exercise historical and neutral forecasts at a smartphone viewport.
- `tests/test_accessibility_contract.js` — verify responsive semantics and coherent asset keys.
- `tests/test_service_worker_status.js` — verify the new cache and asset contract.
- `tests/test_user_value_utils.js` — advance the shared service-worker version contract.
- `tests/test_public_status.py` — verify the deployed bundle/cache versions.
- `tests/test_github_pages_runtime.py` — verify script order and static-only runtime.
- `README.md` — summarize the historical Match Preview capability.
- `USER_GUIDE.md` — explain evidence labels, class adjustment, manual roster changes, and uncertainty.

No calendar, favorites, Ligapokal, or local-server product behavior is in scope.

## Public model API

`match_preview_model.js` must expose one frozen API as both `module.exports` and `window.BwedlMatchPreviewModel`:

```js
Object.freeze({
    normalizeLeagueClass,
    roundStats,
    buildArchiveIndex,
    buildClassCalibration,
    convertClassRating,
    buildHistoricalPrior,
    buildTeamRoster,
    completeLineup,
    buildOutcomeTrainingExamples,
    calibrateOutcomeModel,
    forecastMatch,
});
```

All functions return new objects and never mutate ranking, archive, club, or league inputs.

---

### Task 1: Parse round-derived historical player evidence

**Files:**
- Create: `pipeline/archive_players.py`
- Create: `tests/fixtures/archive_ranking_players.json`
- Create: `tests/test_archive_players.py`
- Modify: `archive_scraper.py`
- Modify: `tests/test_scraper_outputs.py`

- [ ] **Step 1: Add representative archive fixtures**

Create `tests/fixtures/archive_ranking_players.json` with these exact cases:

```json
{
  "modern": {
    "season": "2025/2026",
    "league": "A-Klasse",
    "headers": ["Pl.", "V-Nr.", "ID", "Vorname", "Nachname", "1", "2", "3", "Gesamt"],
    "rows": [["35", "018", "4711", "Mario", "Ackermann", "5", "x", "7", "12"]]
  },
  "combining_name": {
    "season": "2024/2025",
    "league": "B-Klasse",
    "headers": ["Platz", "V-Nr.", "ID", "Vorname", "Nachname", "R1", "R2", "Gesamt"],
    "rows": [["8", "035", "900", "Jose\u0301", "Mu\u0308ller", "6", "4", "10"]]
  },
  "totals_only": {
    "season": "2020/2022",
    "league": "C-Klasse",
    "headers": ["Pl.", "ID", "Name", "Gesamt"],
    "rows": [["9", "811", "Legacy Spieler", "21"]]
  },
  "inconsistent": {
    "season": "2023/2024",
    "league": "B-Klasse",
    "headers": ["Pl.", "V-Nr.", "ID", "Vorname", "Nachname", "1", "2", "Gesamt"],
    "rows": [["4", "035", "812", "Falsch", "Summe", "4", "5", "99"]]
  }
}
```

- [ ] **Step 2: Write failing parser tests**

Add tests that call `parse_archive_ranking_table` and `merge_archive_entries`:

```python
def test_modern_archive_row_keeps_round_evidence(fixture):
    result = parse_archive_ranking_table(**fixture["modern"])
    assert result == [{
        "season": "2025/2026",
        "rank": 35,
        "points": 12,
        "league": "A-Klasse",
        "name": "Mario Ackermann",
        "v_nr": "018",
        "rounds": {"R1": 5, "R2": "x", "R3": 7},
        "appearances": 2,
        "points_per_appearance": 6.0,
    }]

def test_total_only_archive_row_remains_career_only(fixture):
    record = parse_archive_ranking_table(**fixture["totals_only"])[0]
    assert record["points"] == 21
    assert not {"rounds", "appearances", "points_per_appearance"} & record.keys()

def test_complete_round_sequence_must_match_total(fixture):
    with pytest.raises(ArchivePlayerParseError, match="round total"):
        parse_archive_ranking_table(**fixture["inconsistent"])

def test_duplicate_player_season_is_rejected():
    entry = {"id": "4711", "season": "2025/2026", "league": "A-Klasse"}
    with pytest.raises(ArchivePlayerParseError, match="duplicate"):
        merge_archive_entries([entry, dict(entry)])
```

- [ ] **Step 3: Run the parser tests to confirm RED**

Run:

```powershell
python -m pytest tests/test_archive_players.py -q -p no:cacheprovider
```

Expected: collection fails because `pipeline.archive_players` does not exist.

- [ ] **Step 4: Implement the pure parser**

Create `pipeline/archive_players.py` with immutable input handling and these concrete boundaries:

```python
class ArchivePlayerParseError(ValueError):
    pass

ROUND_HEADER = re.compile(r"^(?:r(?:unde)?\s*)?(\d{1,2})$", re.IGNORECASE)

def parse_round_value(value: Any) -> int | str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    if re.fullmatch(r"\d+", text):
        return int(text)
    return "x" if text.casefold() == "x" else ""

def parse_archive_ranking_table(
    *, season: str, league: str, headers: list[str], rows: list[list[str]]
) -> list[dict[str, Any]]:
    columns = locate_archive_columns(headers)
    records = []
    for row in rows:
        record = parse_archive_player_row(season, league, columns, row)
        if record is not None:
            records.append(record)
    return records

def merge_archive_entries(entries: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    seen: set[tuple[str, str]] = set()
    for source in entries:
        record = deepcopy(source)
        player_id = str(record.pop("id", "")).strip()
        season = str(record.get("season", "")).strip()
        key = (player_id, season)
        if not all(key) or key in seen:
            raise ArchivePlayerParseError("duplicate or blank player-season identity")
        seen.add(key)
        result.setdefault(player_id, []).append(record)
    for history in result.values():
        history.sort(key=lambda item: canonical_season_start(item["season"]), reverse=True)
    return dict(sorted(result.items()))
```

`locate_archive_columns` must recognize `Pl.`/`Platz`, `V-Nr.`, `ID`, separate or combined name fields, numeric/`R1` round columns, and `Gesamt`. `parse_archive_player_row` must normalize Unicode names to NFC, preserve the source `x` markers, derive appearances from numeric round values, and reject a complete round sequence whose numeric sum differs from `Gesamt`.

- [ ] **Step 5: Change the browser extraction boundary**

In `archive_scraper.py`, make `extractTableData` return explicit headers and body rows:

```js
function extractTableData(table, league) {
    const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
    const fallbackHeader = Array.from(table.querySelectorAll('tr')).find((row) => (
        Array.from(row.querySelectorAll('th, td')).some((cell) => /^(?:Pl\.?|Platz|V-Nr\.?|ID|Gesamt)$/i.test(cell.innerText.trim()))
    ));
    const headers = (headerCells.length ? headerCells : Array.from(fallbackHeader?.querySelectorAll('th, td') || []))
        .map((cell) => cell.innerText.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
        .filter((row) => row !== fallbackHeader)
        .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.innerText.trim()))
        .filter((row) => row.length >= 3);
    return { league, headers, rows };
}
```

Replace the inline heuristic record construction with calls to `parse_archive_ranking_table`, collect entries across pages, then call `merge_archive_entries` once before `save_archive_data`. A parse error for a table that claims round columns must fail the archive scraper; totals-only legacy tables remain career-only.

- [ ] **Step 6: Add orchestration regressions**

Extend `tests/test_scraper_outputs.py` so a fake archive page returns one modern table. Assert that the candidate `archive_data.js` contains `v_nr`, `rounds`, `appearances`, and `points_per_appearance`, that the public root remains unchanged, and that duplicate player-season input makes the scraper exit nonzero with diagnostic artifacts.

- [ ] **Step 7: Run focused GREEN verification**

Run:

```powershell
python -m pytest tests/test_archive_players.py tests/test_scraper_outputs.py -q -p no:cacheprovider
```

Expected: all focused parser and scraper-output tests pass.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- pipeline/archive_players.py archive_scraper.py tests/fixtures/archive_ranking_players.json tests/test_archive_players.py tests/test_scraper_outputs.py
git commit -m "feat: preserve historical player appearances"
```

---

### Task 2: Validate enriched archives and migrate the legacy baseline safely

**Files:**
- Modify: `pipeline/validation.py`
- Modify: `tests/test_validation.py`
- Modify: `tests/test_update_data.py`

- [ ] **Step 1: Write failing enriched-schema tests**

Add a helper and the following cases to `tests/test_validation.py`:

```python
def enriched_archive_record(season="25/26", **overrides):
    record = {
        "season": season,
        "rank": 3,
        "points": 12,
        "league": "A-Klasse",
        "name": "Mario Ackermann",
        "v_nr": "018",
        "rounds": {"R1": 5, "R2": "x", "R3": 7},
        "appearances": 2,
        "points_per_appearance": 6.0,
    }
    record.update(overrides)
    return record

def test_archive_payload_accepts_lossless_legacy_to_enriched_migration():
    previous = {"4711": [archive_record("25/26", league="A-Klasse")]}
    previous["4711"][0].update(rank=3, points=12, name="Mario Ackermann")
    candidate = {"4711": [enriched_archive_record()]}
    tables = [archive_table("25/26", league="A-Klasse")]
    assert validation.validate_archive_payloads(candidate, previous, tables, tables).decision is Decision.PUBLISH

@pytest.mark.parametrize("mutation", [
    {"appearances": 3},
    {"points_per_appearance": 6.1},
    {"rounds": {"R1": 5, "R2": "x", "R3": 8}},
    {"v_nr": ""},
])
def test_archive_payload_blocks_inconsistent_preview_evidence(mutation):
    record = enriched_archive_record(**mutation)
    result = validation.validate_archive_payloads(
        {"4711": [record]}, {"4711": [enriched_archive_record()]},
        [archive_table("25/26")], [archive_table("25/26")],
    )
    assert result.decision is Decision.BLOCKED
```

Also prove that changing legacy `rank`, `points`, `name`, season, or league during enrichment is a lossy migration and remains blocked.

- [ ] **Step 2: Run the new validation tests to confirm RED**

Run:

```powershell
python -m pytest tests/test_validation.py -q -p no:cacheprovider -k "archive_payload and (enriched or preview or migration)"
```

Expected: the legacy-to-enriched case is blocked as a lost fingerprint and inconsistent derived fields are not yet diagnosed.

- [ ] **Step 3: Add enriched-record validation**

In `pipeline/validation.py`, introduce exact helpers:

```python
def _archive_player_identity(player_key: str, record: dict[str, Any]) -> tuple[str, str, str, str, int, int] | None:
    season = _parse_archive_season(record.get("season"))
    league = record.get("league")
    name = record.get("name")
    rank = record.get("rank")
    points = record.get("points")
    if season is None or not isinstance(league, str) or not league.strip():
        return None
    if not isinstance(name, str) or not name.strip() or not isinstance(rank, int) or not isinstance(points, int):
        return None
    return player_key, season, league.strip(), unicodedata.normalize("NFC", name.strip()), rank, points

def _validate_archive_preview_evidence(record: dict[str, Any]) -> str | None:
    preview_fields = {"v_nr", "rounds", "appearances", "points_per_appearance"}
    present = preview_fields & record.keys()
    if not present:
        return None
    if present != preview_fields:
        return "archive preview evidence is partial"
    if not isinstance(record["v_nr"], str) or not re.fullmatch(r"\d+", record["v_nr"]):
        return "archive preview club number is invalid"
    rounds = record["rounds"]
    if not isinstance(rounds, dict) or not rounds:
        return "archive preview rounds are invalid"
    numeric = [value for key, value in rounds.items() if re.fullmatch(r"R\d{1,2}", key) and isinstance(value, int) and not isinstance(value, bool) and value >= 0]
    if len(numeric) != record["appearances"]:
        return "archive preview appearance count is inconsistent"
    if sum(numeric) != record["points"]:
        return "archive preview round total is inconsistent"
    expected = record["points"] / record["appearances"] if record["appearances"] else 0.0
    if not isinstance(record["points_per_appearance"], (int, float)) or not math.isclose(record["points_per_appearance"], expected, rel_tol=0, abs_tol=1e-12):
        return "archive preview average is inconsistent"
    return None
```

Change player-history comparison from full-record fingerprints to an identity-aware migration rule: an exact fingerprint still matches; otherwise a previous legacy record may match exactly one candidate enriched record with the same `_archive_player_identity`. An already enriched previous record still requires an exact record so evidence cannot silently change.

- [ ] **Step 4: Update pipeline fixtures**

In `tests/test_update_data.py`, replace only the archive player fixture used for new candidates with one valid enriched record while retaining a legacy previous baseline in the migration test. Assert a valid migration publishes and an inconsistent `appearances` candidate returns `BLOCKED` and leaves the previous `archive_data.js` bytes unchanged.

- [ ] **Step 5: Run validation and update GREEN verification**

Run:

```powershell
python -m pytest tests/test_validation.py tests/test_update_data.py -q -p no:cacheprovider
```

Expected: all archive validation, no-loss, and update transaction tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- pipeline/validation.py tests/test_validation.py tests/test_update_data.py
git commit -m "feat: validate historical preview evidence"
```

---

### Task 3: Implement player statistics and empirical class calibration

**Files:**
- Create: `match_preview_model.js`
- Create: `tests/test_match_preview_model.js`
- Create: `tests/test_match_preview_model.py`

- [ ] **Step 1: Add the pytest-to-Node wrapper**

Create `tests/test_match_preview_model.py`:

```python
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def test_match_preview_model_in_node() -> None:
    subprocess.run(
        ["node", str(ROOT / "tests" / "test_match_preview_model.js")],
        cwd=ROOT,
        check=True,
    )
```

- [ ] **Step 2: Write failing statistics and class tests**

Create `tests/test_match_preview_model.js` with immutable fixtures covering:

```js
const assert = require('node:assert/strict');
const Model = require('../match_preview_model.js');

assert.equal(Model.normalizeLeagueClass('B-Klasse Gruppe 2 2026-2027'), 'B-Klasse');
assert.equal(Model.normalizeLeagueClass('Mix-Klasse Gruppe B'), null);
assert.deepEqual(Model.roundStats({ R1: '6', R2: 'x', R3: '', R4: 4 }), {
    values: [6, 4], points: 10, appearances: 2, mean: 5,
});

const archive = makeTransitionArchive({
    pairCount: 8,
    from: 'A-Klasse', fromMean: 5,
    to: 'B-Klasse', toMean: 6,
});
const calibration = Model.buildClassCalibration(archive);
assert.equal(calibration.transitions['A-Klasse>B-Klasse'].count, 8);
assert.equal(calibration.transitions['A-Klasse>B-Klasse'].offset, 1);
assert.deepEqual(Model.convertClassRating(5.5, 'A-Klasse', 'B-Klasse', calibration), {
    rating: 6.5, calibrated: true, path: ['A-Klasse>B-Klasse'],
});

const insufficient = Model.buildClassCalibration(makeTransitionArchive({ pairCount: 7 }));
assert.equal(Model.convertClassRating(5.5, 'A-Klasse', 'B-Klasse', insufficient).calibrated, false);
```

Add a chained Bezirksliga-to-B case, a direction-reversed transition case, outlier resistance, input non-mutation, duplicate/contradictory identity rejection, and a totals-only record exclusion.

- [ ] **Step 3: Run the model tests to confirm RED**

Run:

```powershell
python -m pytest tests/test_match_preview_model.py -q -p no:cacheprovider
```

Expected: Node fails with `Cannot find module '../match_preview_model.js'`.

- [ ] **Step 4: Create the UMD module and base statistics**

Start `match_preview_model.js` with:

```js
(function (root, factory) {
    const api = Object.freeze(factory());
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BwedlMatchPreviewModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    'use strict';
    const CLASS_ORDER = Object.freeze(['Bezirksliga', 'A-Klasse', 'B-Klasse', 'C-Klasse']);
    const MIN_TRANSITIONS = 8;
    const PRIOR_APPEARANCES = 4;

    function normalizeLeagueClass(value) {
        const text = String(value || '').normalize('NFKC').toLocaleLowerCase('de-DE');
        if (/\bmix\b/u.test(text)) return null;
        if (/\bbezirksliga\b/u.test(text)) return 'Bezirksliga';
        const match = /\b([abc])\s*[- ]?klasse\b/u.exec(text);
        return match ? `${match[1].toUpperCase()}-Klasse` : null;
    }

    function roundStats(rounds) {
        const values = Object.entries(rounds && typeof rounds === 'object' ? rounds : {})
            .filter(([key]) => /^R\d{1,2}$/u.test(key))
            .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
            .map(([, value]) => typeof value === 'number' ? value : (/^\d+$/u.test(String(value)) ? Number(value) : null))
            .filter((value) => Number.isFinite(value) && value >= 0);
        const points = values.reduce((sum, value) => sum + value, 0);
        return { values, points, appearances: values.length, mean: values.length ? points / values.length : 0 };
    }
```

Implement `buildArchiveIndex` to validate own data properties, canonicalize seasons, clone records, and expose histories sorted newest-first. Reject duplicate player-season identities and contradictory normalized names.

- [ ] **Step 5: Implement deterministic class calibration**

Implement class-season appearance-weighted means, four-appearance stabilization, and adjacent transition aggregation. Use a weighted median with weight `Math.min(previous.appearances, current.appearances)` and normalize reverse movements onto the same high-to-low edge. Publish an edge only with at least eight qualifying player pairs having at least four appearances in both seasons.

`convertClassRating` must walk `CLASS_ORDER` one adjacent edge at a time, add the edge offset in the forward direction or subtract it in reverse, and return the original finite value with `calibrated: false` if any edge is unavailable.

- [ ] **Step 6: Run focused GREEN verification**

Run:

```powershell
node tests/test_match_preview_model.js
node --check match_preview_model.js
python -m pytest tests/test_match_preview_model.py -q -p no:cacheprovider
```

Expected: the Node marker prints `historical match preview model: ok`; syntax and pytest wrapper pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- match_preview_model.js tests/test_match_preview_model.js tests/test_match_preview_model.py
git commit -m "feat: calibrate historical player strength"
```

---

### Task 4: Resolve historical rosters, blend current form, and forecast four slots

**Files:**
- Modify: `match_preview_model.js`
- Modify: `tests/test_match_preview_model.js`
- Create: `tests/test_match_preview_backtest.js`
- Create: `tests/test_match_preview_backtest.py`

- [ ] **Step 1: Write failing historical-prior and roster tests**

Add exact cases to `tests/test_match_preview_model.js`:

```js
const prior = Model.buildHistoricalPrior({
    playerId: '7',
    targetClass: 'B-Klasse',
    archiveIndex,
    calibration,
});
assert.equal(prior.seasons[0].weight, 0.7);
assert.equal(prior.seasons[1].weight, 0.3);

const roster = Model.buildTeamRoster({
    teamId: '035',
    targetLeague: 'B-Klasse Gruppe 2 2026-2027',
    currentPlayers,
    archiveData,
    calibration,
});
assert.equal(roster.players.find((player) => player.id === 'moved'), undefined);
assert.equal(roster.players.find((player) => player.id === 'current').evidence, 'current+history');
assert.equal(roster.players.find((player) => player.id === 'historic').rosterUnconfirmed, true);

const blended = roster.players.find((player) => player.id === 'eight-current');
assert.equal(blended.currentAppearances, 8);
assert.equal(blended.currentWeight, 8 / 12);

const lineup = Model.completeLineup(roster.players.slice(0, 2), {
    targetClass: 'B-Klasse', classMean: 5.25, size: 4,
});
assert.equal(lineup.length, 4);
assert.equal(lineup.filter((slot) => slot.evidence === 'neutral').length, 2);
assert.equal(lineup.every((slot) => slot.rating > 0), true);
```

Cover one historical season (100%), no history (class prior), latest-season roster precedence, second-season fallback only up to four candidates, current transfer precedence, fewer than four manual selections, immutable input, and `high`/`medium`/`provisional`/`very-low` confidence.

- [ ] **Step 2: Write failing forecast-calibration tests**

Use synthetic chronological training examples:

```js
const examples = makeOutcomeExamples({ wins: 20, draws: 10, losses: 20 });
const outcomeModel = Model.calibrateOutcomeModel(examples);
assert.equal(outcomeModel.calibrated, true);
const forecast = Model.forecastMatch(homeLineup, awayLineup, { outcomeModel, home: true });
assert.equal(forecast.mode, 'probability');
assert.ok(Math.abs(forecast.home + forecast.draw + forecast.away - 1) < 1e-12);
assert.ok(forecast.low.home <= forecast.home && forecast.home <= forecast.high.home);

const fallback = Model.forecastMatch(homeLineup, awayLineup, {
    outcomeModel: Model.calibrateOutcomeModel(examples.slice(0, 12)), home: true,
});
assert.equal(fallback.mode, 'relative');
assert.equal('home' in fallback, false);
```

Require at least 40 examples and at least five examples of each outcome. Assert deterministic parameter selection, home/away symmetry when home advantage is zero, wider ranges with placeholders, and no double-counted head-to-head input.

- [ ] **Step 3: Run the expanded tests to confirm RED**

Run:

```powershell
node tests/test_match_preview_model.js
```

Expected: failure because the prior, roster, lineup, training, and forecast functions are not exported yet.

- [ ] **Step 4: Implement the two-season and current-season blend**

Implement `buildHistoricalPrior` with latest/previous weights `[0.7, 0.3]`, renormalized to `[1]` when only one record is usable. Stabilize each historical season with four class-mean appearances before conversion to the target class.

For current evidence, use the approved equation exactly:

```js
const rating = currentStats.appearances
    ? (currentStats.points + PRIOR_APPEARANCES * historicalPrior.rating) /
      (currentStats.appearances + PRIOR_APPEARANCES)
    : historicalPrior.rating;
const currentWeight = currentStats.appearances /
    (currentStats.appearances + PRIOR_APPEARANCES);
```

`buildTeamRoster` must create a global current-ID affiliation map before adding historical candidates, so a currently moved player is never shown for the old club. Current players come first, latest historical club entries come next, and previous-season-only entries are added only until four identifiable candidates exist.

- [ ] **Step 5: Implement neutral lineup completion and confidence**

`completeLineup` must clone the selected known players, sort only the automatic default selection by adjusted rating, and append explicit slots shaped as:

```js
{
    id: 'neutral-1',
    name: 'Unbekannter Spieler (Klassenwert)',
    rating: classMean,
    evidence: 'neutral',
    confidence: 'very-low',
    currentAppearances: 0,
    sourceSeasons: [],
    rosterUnconfirmed: true,
}
```

Team confidence is the weakest material slot confidence; two or more neutral slots always produce `very-low`.

- [ ] **Step 6: Implement chronological outcome training and forecast fallback**

`buildOutcomeTrainingExamples` must accept archive tables, archive data, and clubs; recognize rows with round/home/away/result fields; map both team names to exactly one club number; identify exactly four players with a numeric value in that season and round; calculate each player's prior from seasons strictly before the target season; and exclude ambiguous club/team/class cases.

`calibrateOutcomeModel` performs a deterministic bounded grid search over scale, home advantage, draw peak, and draw decay, minimizing three-outcome Brier score. Ties use lexicographic parameter order. `forecastMatch` returns three normalized probabilities only for a calibrated model; otherwise it returns `mode: 'relative'`, both lineup scores, relative shares, and uncertainty text without probability labels.

- [ ] **Step 7: Add the chronological real-data backtest contract**

Create `tests/test_match_preview_backtest.js` to load `archive_data.js` in a VM, hold out each eligible player's newest season, build the forecast only from earlier seasons, and compare mean absolute error against:

1. the previous-season raw average;
2. the unadjusted two-season 70/30 average.

The test must assert nonzero samples overall and for class changers, no target-season leakage, finite metrics, and hybrid MAE no worse than both baselines within `1e-9`. Print sample counts and MAE values for review. Create the standard subprocess wrapper in `tests/test_match_preview_backtest.py`.

- [ ] **Step 8: Run model and backtest GREEN verification**

Run:

```powershell
python -m pytest tests/test_match_preview_model.py tests/test_match_preview_backtest.py -q -p no:cacheprovider
node --check match_preview_model.js
```

Expected: model contracts and the chronological backtest pass. If the real artifact is not enriched yet, the backtest must skip with the exact reason `archive_data.js has no round-derived historical evidence`; it must become a mandatory pass in Task 7 after artifact generation.

- [ ] **Step 9: Commit Task 4**

```powershell
git add -- match_preview_model.js tests/test_match_preview_model.js tests/test_match_preview_backtest.js tests/test_match_preview_backtest.py
git commit -m "feat: forecast matches from historical rosters"
```

---

### Task 5: Integrate the historical model into Match Preview UI

**Files:**
- Modify: `bundle_v31.js`
- Modify: `style.css`
- Create: `tests/test_historical_match_preview_ui.js`
- Create: `tests/test_historical_match_preview_ui.py`
- Modify: `tests/test_reported_ui_regressions.js`
- Modify: `tests/test_season_context.js`
- Modify: `tests/test_browser_security.py`

- [ ] **Step 1: Add the UI Node wrapper and failing rendering contracts**

Create the standard pytest subprocess wrapper for `tests/test_historical_match_preview_ui.js`. In the Node test, load the bundle renderer with the existing strict fake DOM and inject `BwedlMatchPreviewModel` as a dependency. Assert:

```js
assert.equal(findText(root, 'Vorjahreskader'), true);
assert.equal(findText(root, 'Klassenwechsel: A → B'), true);
assert.equal(findText(root, 'Kaderzugehörigkeit unbestätigt'), true);
assert.equal(findText(root, 'Unbekannter Spieler (Klassenwert)'), true);
assert.equal(findText(root, 'Datenqualität: vorläufig'), true);
assert.equal(root.querySelectorAll('input[type="checkbox"]:checked').length, 4);
assert.equal(document.usedUnsafePlayerHtml, false);
```

Add a calibrated result case with three percentages and a plausible range, an uncalibrated case that contains `Relative Aufstellungsstärke` and no `% Siegchance`, manual deselection that fills a visible neutral slot, historical-form labeling, rerender deduplication, and a `390x844` no-horizontal-document-overflow contract.

Extend the existing opt-in Playwright flow in `tests/test_browser_security.py` with a fixture matchup that has no current ranking rows but valid history. At `390x844`, select it and assert four slots, at least one historical or neutral badge, a changed forecast after manual lineup input, no horizontal document overflow, no application console error, and no `/api/` request.

- [ ] **Step 2: Run UI tests to confirm RED**

Run:

```powershell
python -m pytest tests/test_historical_match_preview_ui.py -q -p no:cacheprovider
```

Expected: the old renderer shows `Keine Spieler gefunden` and has no historical evidence labels.

- [ ] **Step 3: Replace preview-local raw player extraction**

In `renderMatchPreview`, build the calibration once per renderer invocation:

```js
const previewModel = window.BwedlMatchPreviewModel;
const classCalibration = previewModel.buildClassCalibration(archiveData);
const outcomeTraining = previewModel.buildOutcomeTrainingExamples({
    archiveTables: window.ARCHIVE_TABLES || [],
    archiveData,
    clubs: clubData.clubs || [],
});
const outcomeModel = previewModel.calibrateOutcomeModel(outcomeTraining);
```

Replace `fetchPlayers` with `buildTeamRoster`, passing the selected team ID, selected league, current ranking players, archive data, and class calibration. Keep the exact existing team selector and exclusion contracts.

- [ ] **Step 4: Render player rows with safe DOM nodes**

Replace string-concatenated player rows with a `renderMatchPreviewPlayerList` helper that creates the checkbox, player name, adjusted value, appearance count, evidence badge, class transition, roster warning, and confidence label through `createElement` and `textContent`. Set data attributes only from fixed internal enum values.

Use these exact German labels:

```js
const EVIDENCE_LABELS = Object.freeze({
    current: 'Aktuell',
    'current+history': 'Aktuell + Historie',
    historical: 'Vorjahreskader',
    'historical-fallback': 'Historischer Ersatzkader',
    neutral: 'Neutraler Klassenwert',
});
```

The source detail must list seasons and former class. Historical round sparklines are titled `Historische Form`; only current round data may be titled `Aktuelle Form`.

- [ ] **Step 5: Make every calculation a four-slot forecast**

On automatic selection, select the four highest-rated known candidates and let `completeLineup` fill any shortage. On manual selection, pass the chosen known candidates through `completeLineup` before calculating. Show neutral rows in the calculated lineup summary without creating fake selectable checkboxes.

Replace the old two-way ratio with `forecastMatch`. For `mode: 'probability'`, render home, draw, and away values that sum to 100% after display rounding; for `mode: 'relative'`, render only team scores and relative strength. Always render evidence quality and fallback explanation.

- [ ] **Step 6: Add responsive component styles**

Add scoped classes rather than new inline layout rules:

```css
.match-preview-player__badges { display: flex; flex-wrap: wrap; gap: .35rem; }
.match-preview-evidence { border: 1px solid var(--match-preview-evidence-border); border-radius: 999px; padding: .2rem .5rem; }
.match-preview-forecast__probabilities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
.match-preview-confidence { overflow-wrap: anywhere; }
@media (max-width: 640px) {
    .match-preview-forecast__probabilities { grid-template-columns: 1fr; }
    .match-preview-player { align-items: flex-start; }
}
```

Use existing Slate/Gold/Blue tokens, visible `:focus-visible`, 44px controls, reduced-motion handling, and no fixed minimum width that can overflow a 320px viewport.

- [ ] **Step 7: Restore existing renderer harnesses**

Update `tests/test_season_context.js` to inject a deterministic model stub that returns empty-but-valid rosters and a relative forecast. Extend `tests/test_reported_ui_regressions.js` to prove exact team matching, distinct teams, safe option creation, manual selection, and next-match auto-fill still pass after the integration.

- [ ] **Step 8: Run focused UI GREEN verification**

Run:

```powershell
node tests/test_historical_match_preview_ui.js
node tests/test_reported_ui_regressions.js
node tests/test_season_context.js
node --check bundle_v31.js
python -m pytest tests/test_historical_match_preview_ui.py tests/test_reported_ui_regressions.py -q -p no:cacheprovider
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q -p no:cacheprovider; Remove-Item Env:BWEDL_BROWSER_TESTS
```

Expected: all focused UI, legacy regression, season-context, and syntax contracts pass.

- [ ] **Step 9: Commit Task 5**

```powershell
git add -- bundle_v31.js style.css tests/test_historical_match_preview_ui.js tests/test_historical_match_preview_ui.py tests/test_reported_ui_regressions.js tests/test_season_context.js tests/test_browser_security.py
git commit -m "feat: show historical match forecasts"
```

---

### Task 6: Publish a schema-compatible static runtime and document it

**Files:**
- Modify: `index.html`
- Modify: `sw_v31.js`
- Modify: `tests/test_accessibility_contract.js`
- Modify: `tests/test_service_worker_status.js`
- Modify: `tests/test_user_value_utils.js`
- Modify: `tests/test_reported_ui_regressions.js`
- Modify: `tests/test_public_status.py`
- Modify: `tests/test_github_pages_runtime.py`
- Modify: `README.md`
- Modify: `USER_GUIDE.md`

- [ ] **Step 1: Write failing script-order and cache contracts**

Update tests to require this exact order and version family:

```html
<script src="archive_data.js?v=9"></script>
<script src="app_utils.js?v=4"></script>
<script src="match_preview_model.js?v=1"></script>
<script src="bundle_v31.js?v=3.9"></script>
```

Require `bwedl-dashboard-v42`, `style.css?v=8`, `archive_data.js?v=9`, `match_preview_model.js?v=1`, and `bundle_v31.js?v=3.9` in both `index.html` and `urlsToCache`. Assert `archive_data.js` remains network-first through the existing `_data.js` classification and the product still contains no `/api/` call.

- [ ] **Step 2: Run runtime tests to confirm RED**

Run:

```powershell
python -m pytest tests/test_public_status.py tests/test_github_pages_runtime.py -q -p no:cacheprovider
node tests/test_service_worker_status.js
node tests/test_accessibility_contract.js
node tests/test_user_value_utils.js
node tests/test_reported_ui_regressions.js
```

Expected: failures report v41/old asset keys and the missing model script.

- [ ] **Step 3: Update the static asset contract**

Load `match_preview_model.js` after `app_utils.js` and before the bundle. Bump only changed keys: style to v8, archive data to v9, bundle to v3.9, and service-worker cache to v42. Add the model to precache. Preserve network-first archive data, network-only calendars/state, GitHub Pages relative URLs, and cache cleanup.

- [ ] **Step 4: Document the user-facing behavior**

In `README.md`, replace the one-line Match Preview claim with a concise statement that it is available before the first matchday through labeled historical and neutral evidence.

In `USER_GUIDE.md`, add one section containing:

- what `Aktuell`, `Aktuell + Historie`, `Vorjahreskader`, and `Neutraler Klassenwert` mean;
- why points are divided by actual appearances;
- how the two seasons are weighted;
- why earlier A-/Bezirksliga performance is adjusted differently from B-/C-Klasse performance;
- how to manually correct the assumed lineup;
- why historical roster membership and probability ranges are explicitly uncertain;
- that data updates come only from the published GitHub Pages artifacts.

- [ ] **Step 5: Run runtime GREEN verification**

Run:

```powershell
python -m pytest tests/test_public_status.py tests/test_github_pages_runtime.py -q -p no:cacheprovider
node tests/test_service_worker_status.js
node tests/test_accessibility_contract.js
node tests/test_user_value_utils.js
node tests/test_reported_ui_regressions.js
node --check match_preview_model.js
node --check bundle_v31.js
node --check sw_v31.js
```

Expected: all asset, static-runtime, accessibility, and syntax contracts pass.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- index.html sw_v31.js README.md USER_GUIDE.md tests/test_accessibility_contract.js tests/test_service_worker_status.js tests/test_user_value_utils.js tests/test_reported_ui_regressions.js tests/test_public_status.py tests/test_github_pages_runtime.py
git commit -m "docs: explain historical match forecasts"
```

---

### Task 7: Generate and audit the real enriched archive artifact

> **Superseded after real-source diagnosis.** The live archive contains legitimate multi-class and transfer segments for the same player and season, plus bounded administrative round markers. Execute `2026-08-20-historical-match-preview-segments.md` Tasks A-F instead. Resume this plan at Task 8 only after the segment plan publishes and validates the real all-season artifact.

**Files:**
- Modify: `archive_data.js`
- Modify: `tests/test_match_preview_backtest.js` only if the real schema exposes a previously unrepresented valid layout; do not weaken statistical assertions.

- [ ] **Step 1: Generate a candidate outside the published root**

Create an explicit task staging directory inside the isolated worktree and run only the archive player scraper:

```powershell
New-Item -ItemType Directory -Path '.match-preview-staging' -Force | Out-Null
python archive_scraper.py --output-dir '.match-preview-staging' --artifacts-dir '.match-preview-artifacts'
```

Expected: exit 0 and `.match-preview-staging/archive_data.js` exists. If Playwright cannot create its process or temp directory under the sandbox, rerun the identical command with the required approval rather than changing code.

- [ ] **Step 2: Validate candidate against the committed baseline**

Use the production parser and validator, not ad-hoc JSON assumptions:

```powershell
python -c "from pathlib import Path; from pipeline.validation import parse_javascript_assignment,validate_archive_payloads; p=lambda x,n:parse_javascript_assignment(Path(x).read_text(encoding='utf-8'),n); r=validate_archive_payloads(p('.match-preview-staging/archive_data.js','ARCHIVE_DATA'),p('archive_data.js','ARCHIVE_DATA'),p('archive_tables.js','ARCHIVE_TABLES'),p('archive_tables.js','ARCHIVE_TABLES')); print(r.to_dict()); raise SystemExit(0 if r.decision.value=='publish' else 1)"
```

Expected: decision `publish`, no lost player-season records, and nonzero enriched records in each of the latest two completed seasons.

- [ ] **Step 3: Publish only the validated generated artifact into the worktree**

Copy only the validated candidate and then verify:

```powershell
Copy-Item -LiteralPath '.match-preview-staging/archive_data.js' -Destination 'archive_data.js' -Force
git status --short
git diff --stat -- archive_data.js
```

Expected: only `archive_data.js` changes for this task; no league, ranking, club, calendar, or archive-table artifact changes.

- [ ] **Step 4: Run the mandatory real-data audit and backtest**

Run:

```powershell
node tests/test_match_preview_backtest.js
python -m pytest tests/test_archive_players.py tests/test_validation.py tests/test_match_preview_model.py tests/test_match_preview_backtest.py -q -p no:cacheprovider
```

Expected: the backtest runs rather than skips, reports nonzero overall and class-change samples, detects no target-season leakage, and the hybrid MAE is no worse than both declared baselines.

- [ ] **Step 5: Re-run generation for determinism**

Generate into a second fresh staging directory and compare SHA-256 hashes:

```powershell
New-Item -ItemType Directory -Path '.match-preview-staging-2' -Force | Out-Null
python archive_scraper.py --output-dir '.match-preview-staging-2' --artifacts-dir '.match-preview-artifacts-2'
Get-FileHash '.match-preview-staging/archive_data.js' -Algorithm SHA256
Get-FileHash '.match-preview-staging-2/archive_data.js' -Algorithm SHA256
```

Expected: identical hashes.

- [ ] **Step 6: Remove only the verified task staging directories**

Resolve and print the absolute paths first. Confirm each path is a direct child of the isolated worktree, then remove only the four task directories. Do not touch the pre-existing inaccessible pytest/reviewer directories.

```powershell
$matchPreviewRoot = (Get-Location).Path
$matchPreviewTargets = @('.match-preview-staging', '.match-preview-staging-2', '.match-preview-artifacts', '.match-preview-artifacts-2') | ForEach-Object { Join-Path $matchPreviewRoot $_ }
$matchPreviewTargets | ForEach-Object {
    $parent = Split-Path -Parent $_
    if ($parent -ne $matchPreviewRoot) { throw "Unsafe task cleanup target: $_" }
    Write-Host $_
}
$matchPreviewTargets | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Remove-Item -LiteralPath $_ -Recurse -Force }
```

- [ ] **Step 7: Commit Task 7**

```powershell
git add -- archive_data.js
git commit -m "chore(data): enrich historical player evidence"
```

---

### Task 8: Full verification, browser evidence, and branch handoff

**Files:**
- Modify only a focused test or documentation file if a genuine in-scope regression is found; every correction gets its own RED/GREEN commit.

- [ ] **Step 1: Run all direct JavaScript contracts and syntax checks**

Run the known standalone Node entrypoints, excluding `test_archive_table_extractor.js` because it requires stdin and is exercised by its pytest wrapper:

```powershell
node tests/test_match_preview_model.js
node tests/test_historical_match_preview_ui.js
node tests/test_match_preview_backtest.js
node tests/test_reported_ui_regressions.js
node tests/test_season_context.js
node tests/test_service_worker_status.js
node tests/test_accessibility_contract.js
node --check match_preview_model.js
node --check bundle_v31.js
node --check sw_v31.js
```

Expected: every direct contract prints its success marker and all syntax checks exit 0.

- [ ] **Step 2: Run the full offline suite**

```powershell
python -m pytest tests -q -p no:cacheprovider
```

Expected: all tests pass; only documented environment-dependent skips remain. If Windows sandbox temp creation returns `WinError 5`, rerun the identical command with the required filesystem approval before diagnosing product code.

- [ ] **Step 3: Run real mobile browser smoke**

```powershell
$env:BWEDL_BROWSER_TESTS='1'
python -m pytest tests/test_browser_security.py -q -p no:cacheprovider
Remove-Item Env:BWEDL_BROWSER_TESTS
```

The browser flow added in Task 5 selects a matchup with no current players and asserts at `390x844`:

- four visible forecast slots;
- historical and/or neutral evidence labels;
- manually changing one player updates the result;
- probability or relative-strength wording matches calibration state;
- no horizontal document overflow;
- no application console errors or `/api/` requests.

Expected: browser smoke passes against the GitHub Pages subpath fixture.

- [ ] **Step 4: Run deterministic and repository hygiene checks**

```powershell
git diff --check
git status --short
git log --oneline --decorate -10
```

Expected: `git diff --check` exits 0; tracked status is clean in the isolated worktree; commits are scoped by task. Inventory untracked files without deleting pre-existing inaccessible directories.

- [ ] **Step 5: Review against the approved design**

Check each requirement in `docs/superpowers/specs/2026-08-20-historical-match-preview-design.md` against code and tests. Explicitly confirm:

- actual appearances, never total-only performance;
- two completed seasons at 70/30;
- four-appearance stabilization and current blend;
- empirical cross-class conversion threshold;
- current transfer precedence;
- four visible slots with neutral fallback;
- probability only after calibration;
- source/confidence explanation;
- GitHub Pages-only operation and compatible service-worker cache.

- [ ] **Step 6: Use the branch-finishing workflow**

Invoke `superpowers:finishing-a-development-branch`. Report commits, focused/full/browser evidence, generated artifact audit, remaining environment-only gaps, and the untouched main-worktree file `.agent/rules/git-workflow.md`. Do not push, merge, or deploy until the user explicitly selects and authorizes that action.

---

## Plan self-review checklist

- Every approved design requirement maps to Tasks 1-8.
- The only runtime data schema change is a backward-compatible enrichment of `archive_data.js`.
- Player-history use is exactly two completed seasons; older seasons are calibration/backtest evidence only.
- Current affiliation always supersedes historical roster assignment.
- A missing player fills a visible neutral slot instead of contributing zero.
- Class conversion never falls back to an invented coefficient.
- Outcome percentages are withheld when calibration evidence is insufficient.
- Direct Node, pytest, deterministic generation, mobile browser, static runtime, service worker, and repository hygiene gates are explicit.
- No task authorizes a push, merge, deployment, unrelated cleanup, or modification of the user-owned dirty file.
