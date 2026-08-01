# BWEDL Stats: Reliable Data Pipeline Design

## Status

Approved on 2026-08-01.

## Objective

Make the six-hour BWEDL data update safe during normal operation, source-site layout changes, temporary outages, and season transitions. A scraper run must never replace valid public data with empty, malformed, or implausibly incomplete data.

The existing public JSON and JavaScript data files remain the frontend contract. This limits frontend changes and allows the reliability work to be delivered without rebuilding the application.

## Current Context

The public application is hosted through GitHub Pages. A scheduled GitHub Actions workflow runs the Python and Playwright scrapers every six hours and commits changed data files to `main`.

At the start of the 2026/27 season, the BWEDL league pages contain all 13 regular leagues and 18 matchdays per regular league. The official rankings overview is still legitimately empty because no matchday has been played. The current ranking scraper treats this as a successful empty result and publishes zero ranking tables and zero players. This removes current-player features from the public application even though the scraper did not technically fail.

The pipeline must therefore distinguish these states:

- valid new data;
- valid source data that is not ready for publication yet;
- incomplete or structurally suspicious data;
- a technical scraping failure.

## Selected Approach

Use a transactional candidate pipeline. Scrapers write candidate outputs into a temporary staging area. A central validator decides whether each data domain is publishable. Only validated outputs are promoted to the public files.

This approach is preferred over adding isolated checks to each scraper because it provides one publication decision and consistent diagnostics. A complete scraper rewrite is explicitly out of scope.

## Architecture

The update flow is:

```text
bwedl.de
   |
   v
Scrapers create candidate data
   |
   v
Temporary staging directory
   |
   v
Central validation
   |----------------------|
   v                      v
Valid candidate       Blocked or failed
   |                      |
   v                      v
Atomic publication    Preserve last valid data
   |                      |
   v                      v
Explicit git commit   Diagnostics and notification
```

### Components

#### Scrapers

The league, ranking, club, archive, and archive-table scrapers collect and normalize source data. They write only to a run-specific staging directory and return structured result metadata. They do not overwrite public data files.

Each scraper result records:

- source URLs;
- detected season;
- record counts;
- warnings;
- duration;
- technical errors;
- paths to diagnostic artifacts.

#### Staging area

Each update run receives a clean temporary directory. Candidate JSON and JavaScript files are written there. The directory is never loaded by the public application and is never committed.

#### Central validator

`validate_data.py` validates each candidate against structural rules and the last published data. It emits one machine-readable `update_report.json` with a decision for every data domain.

Possible decisions are:

- `publish`: candidate is valid and may replace the public data;
- `retain`: source is legitimately not ready, so the previous public data remains;
- `blocked`: candidate is suspicious or incomplete;
- `failed`: scraping or parsing failed technically.

#### Publisher

`publish_data.py` promotes only approved candidate files. JSON and matching JavaScript wrappers are published together so they cannot drift apart. Publication uses temporary files and atomic replacement where supported.

A failed publication must leave all previous public files intact.

#### Update report

`update_report.json` records:

- run timestamp and duration;
- source and target seasons;
- previous and candidate record counts;
- validation results;
- retained domains and reasons;
- published files;
- warnings and failures.

The GitHub Actions job summary presents the same information in a readable table.

## Season Transition Policy

League and ranking data may transition independently.

### League data

Validated 2026/27 league data may be published as soon as the league structure is complete. Open fixtures, zero-value tables, `Spielfrei`, and missing results before a match is played are valid states.

Previous seasons may remain available as historical league data, but current-season selection must be explicit. The validator must prevent accidental duplication of one league-season key and must not silently combine records from different seasons within one entry.

### Ranking data

The complete 2025/26 ranking dataset remains published until 2026/27 is ready.

The 2026/27 ranking dataset becomes publishable only when all four required categories contain at least one structurally valid player:

- Bezirksliga;
- A-Klasse;
- B-Klasse;
- C-Klasse.

Partial 2026/27 ranking data stays in staging and must not be mixed with 2025/26 data. Once the activation condition is satisfied, all four categories switch to 2026/27 in the same publication.

While retained data is shown, the frontend displays `Vorjahresstand 2025/26`. After activation it displays the active season and the concrete publication timestamp, for example `2026/27 - aktualisiert am 01.09.2026 08:00`.

## Validation Rules

### League validation

A candidate current season must satisfy all of the following:

- the detected season matches the intended current season;
- at least 13 regular leagues are present;
- every regular league has a non-empty standings table;
- every regular league exposes 18 matchdays;
- standings rows follow the expected column structure;
- team names are non-empty and unique within a league;
- dates use supported formats;
- open results, zero-value standings, and `Spielfrei` are accepted;
- record-count drops beyond configured tolerances are blocked.

Cup competitions are validated separately because their structure and round count differ from regular leagues.

### Ranking validation

- each player has a name, category, and stable identifier;
- player identifiers are unique within the appropriate category and context;
- rank, points, and round values may be empty or zero at season start;
- the new-season activation condition requires at least one valid player in every required category;
- an empty or partial candidate causes `retain`, not publication and not a destructive overwrite;
- an unexpected large drop after the season has activated causes `blocked`.

### Club validation

- club numbers are unique;
- club names are non-empty;
- required contact and venue fields retain valid types even when values are absent;
- count changes outside a configured tolerance are blocked;
- a completely empty candidate can never replace the public club data.

### Archive validation

- existing historical seasons cannot disappear silently;
- existing player histories and tables cannot be replaced by empty candidates;
- duplicate season and league keys are rejected;
- a newly discovered season may extend the archive but cannot mutate unrelated seasons without an explicit reported difference.

### Cross-file validation

- every public JSON file parses successfully;
- every matching JavaScript wrapper contains the same data as its JSON source;
- current league names and ranking categories use normalized season labels;
- referenced club identifiers resolve where required;
- all output files use UTF-8 and preserve German characters.

## Error Classification

### Warning

A plausible non-destructive difference, such as a small club-count change or a newly added fixture. Publication may continue and the warning appears in the report.

### Retained

The source is reachable and structurally understood, but the new domain is not ready for publication. The ranking transition before all four categories contain a player is the primary example. The previous data remains public.

### Blocked

The scraper returned data, but validation found an implausible or unsafe candidate. No affected public file is replaced and the Action fails visibly.

### Failed

A technical error prevented reliable collection or validation, such as a timeout, navigation failure, invalid JSON, or missing expected page structure. No affected public file is replaced and the Action fails visibly.

## Diagnostics

For `blocked` and `failed` results, the workflow uploads:

- `update_report.json`;
- the relevant source HTML;
- a page screenshot;
- a Playwright trace;
- a count and schema comparison against the last published data;
- scraper logs.

Artifacts are retained for a limited period and are not committed to the repository.

## Notification Policy

The first consecutive blocked or failed run marks the Action red and stores diagnostics, but does not create an issue.

After two consecutive blocked or failed scheduled runs, automation creates one GitHub issue for the affected scraper or updates the existing open issue. The issue includes the failure classification, affected domain, first and latest failure timestamps, relevant counts, and links to the workflow runs.

Repeated failures update the same issue instead of creating duplicates. The next successful run adds a recovery comment and closes the issue automatically.

Manual workflow cancellations do not count as failures.

## Testing Strategy

### Offline fixture tests

Store representative, sanitized HTML fixtures for:

- a regular league with completed results;
- a new-season league with zero-value standings;
- `Spielfrei` fixtures;
- open dates and results;
- an empty rankings overview;
- partially populated rankings;
- fully populated rankings;
- club overview and detail pages;
- archive overview, player history, and historical tables;
- cup competition pages.

Parser tests run without network access and assert normalized structured output rather than raw HTML strings.

### Validator tests

Tests cover:

- valid full publication;
- retained prior rankings during season transition;
- activation when all four ranking categories contain a player;
- rejection of partial activation;
- large record-count regression;
- malformed JSON;
- JSON and JavaScript mismatch;
- preservation of public files after failed validation;
- warning, retained, blocked, and failed reports.

### Live smoke tests

Before a full scrape, the workflow verifies that the BWEDL overview pages are reachable and that their central structural anchors exist. Smoke tests do not publish data. Their purpose is to identify a source-site layout change early.

### End-to-end pipeline test

A complete candidate run is followed by validation and a dry-run publication check. Only after this passes may the publisher replace public files.

## GitHub Actions Workflow

The scheduled and manual workflow remains the operational entry point. Its steps become:

```text
Checkout
Set up pinned Python version
Install and cache dependencies
Install Playwright browser and system dependencies
Run live smoke checks
Create staging directory
Run scrapers into staging
Validate candidate data
Run fixture and pipeline tests
Publish approved domains
Write Actions summary
Upload diagnostics when required
Commit explicit approved data files
Update failure notification state
```

Workflow requirements:

- use current maintained major versions of official GitHub Actions;
- use a specific supported Python version instead of `3.x`;
- define job and navigation timeouts;
- retry transient navigation failures a small fixed number of times;
- do not retry structural validation failures;
- use `git add` only for the explicitly approved public data files and report files intended for version control;
- do not create a commit when only volatile timestamps changed;
- never commit staging data, screenshots, traces, or raw diagnostic HTML.

## Frontend Data Status

The frontend gains a small per-domain status display sourced from the update report or equivalent public metadata.

Examples:

- `Liga: 2026/27 - aktualisiert am 01.08.2026 13:14`;
- `Rangliste: Vorjahresstand 2025/26`;
- `Vereine: aktualisiert am 01.08.2026 13:15`.

The status must not imply that retained ranking data belongs to the current season.

## Rollout

1. Add fixtures, validator, staging output, and dry-run reporting without changing publication behavior.
2. Enable publication guards and retained ranking behavior.
3. Add diagnostic artifacts and two-strike GitHub issue automation.
4. Add frontend data-status labels.
5. Observe several scheduled runs before removing compatibility paths.

Each rollout step must be independently reversible.

## Acceptance Criteria

- No scraper writes directly to public data files during collection.
- Invalid or incomplete candidate data cannot replace valid published data.
- Empty 2026/27 rankings retain the complete 2025/26 ranking dataset.
- Ranking activation occurs only when every required category has at least one valid player.
- The frontend clearly labels retained rankings as `Vorjahresstand 2025/26`.
- All 13 regular leagues and their 18 matchdays are validated for the current season.
- A blocked or failed run preserves every previously published file.
- Diagnostics are uploaded for blocked and failed runs.
- Two consecutive scheduled failures create or update one GitHub issue.
- A subsequent successful run closes the corresponding issue with a recovery comment.
- Fixture, validator, and end-to-end pipeline tests pass before publication.
- Git commits include only explicitly approved generated files.

## Out of Scope

- rebuilding the frontend with a JavaScript framework;
- replacing GitHub Pages;
- introducing a database or hosted backend;
- a complete rewrite of all scrapers;
- changing the source data owned by BWEDL;
- redesigning unrelated application features.
