import json
import subprocess
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import pytest

from pipeline.calendar_feeds import (
    CalendarSourceError,
    build_calendar_publication,
    classify_regular_league_source_lines,
    parse_regular_league_games,
    _fold_ical_lines,
)


ROOT = Path(__file__).resolve().parents[1]
USER_DOCUMENTS = ("README.md", "USER_GUIDE.md", "WIKI.md")


def test_obsolete_local_product_runtime_is_removed() -> None:
    assert not (ROOT / "server.py").exists()
    assert not (ROOT / "start.bat").exists()
    assert not (ROOT / "setup.bat").exists()


def test_product_bundle_only_refreshes_published_static_data() -> None:
    javascript = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")

    assert "BwedlAppUtils.probePublishedData" in javascript
    assert "direkt auf dem PC ausgeführt" not in javascript
    assert "nicht aus der App" in javascript
    for obsolete_contract in (
        "/api/update",
        "update_status.json",
        "isLocalhost",
        "window.location.hostname",
        "current_script",
    ):
        assert obsolete_contract not in javascript


def test_documentation_names_github_pages_as_the_only_product_runtime() -> None:
    documentation = "\n".join(
        (ROOT / name).read_text(encoding="utf-8")
        for name in ("README.md", "USER_GUIDE.md")
    )

    assert "GitHub Pages" in documentation
    assert "einzige" in documentation
    assert "python server.py" not in documentation
    assert "python -m http.server 8000 --bind 127.0.0.1" in documentation
    assert "Entwicklung" in documentation


def test_user_documentation_explains_the_complete_calendar_and_favorites_contract() -> None:
    required_contracts = (
        "Profilteam",
        "vergangenen und zukünftigen regulären Ligaspiele",
        "Ligapokal",
        "Einzelspiel-Download",
        "Gegner",
        "Heim/Auswärts",
        "Uhrzeit",
        "bestverfügbare Adresse des Heimvereins",
        "unvollständige Adresse",
        "nicht aufgelöster Spielort",
        "Dashboard",
        "Mein Profil",
        "In Kalender-App öffnen",
        "Abo-Link kopieren",
        "Automatisch aktuell bleiben",
        "Termine einmalig übernehmen",
        "ICS-Datei herunterladen",
        "bestehenden oder gemeinsamen Kalender",
        "Keine automatische Aktualisierung",
        "doppelten Terminen",
        "Anleitung für iPhone",
        "Anleitung für Android / Google Kalender",
        "am Computer",
        "webcal",
        "Kalenderanbieter",
        "später",
        "sechs Stunden",
        "prüft und validiert die Daten alle sechs Stunden",
        "Nur ein erfolgreicher Lauf mit geänderten Daten veröffentlicht",
        "Internetverbindung",
        "GitHub Pages",
        "ohne API oder Server",
        "FAVORITEN",
        "VEREINE → Favoriten",
    )

    for name in USER_DOCUMENTS:
        documentation = (ROOT / name).read_text(encoding="utf-8")
        missing = [contract for contract in required_contracts if contract not in documentation]
        assert not missing, f"{name} fehlt: {', '.join(missing)}"


def test_service_worker_has_no_local_api_runtime_contract() -> None:
    worker = (ROOT / "sw_v31.js").read_text(encoding="utf-8")

    assert "/api/" not in worker
    assert "localhost" not in worker
    assert "127.0.0.1" not in worker
    assert "'./data_status.json'" in worker
    assert "'./calendar_index.js?v=1'" in worker
    assert "calendar_state.json" not in worker.split("const urlsToCache = [", 1)[1].split("];", 1)[0]
    assert "calendars/" not in worker.split("const urlsToCache = [", 1)[1].split("];", 1)[0]


def test_calendar_artifacts_keep_canonical_git_line_endings() -> None:
    result = subprocess.run(
        [
            "git",
            "check-attr",
            "text",
            "eol",
            "diff",
            "--",
            "calendar_index.js",
            "calendar_index.json",
            "calendar_state.json",
            "calendars/club-009-team-1.ics",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    attributes = result.stdout.splitlines()
    assert "calendar_index.js: text: set" in attributes
    assert "calendar_index.js: eol: lf" in attributes
    assert "calendar_index.json: text: set" in attributes
    assert "calendar_index.json: eol: lf" in attributes
    assert "calendar_state.json: text: set" in attributes
    assert "calendar_state.json: eol: lf" in attributes
    assert "calendars/club-009-team-1.ics: text: unset" in attributes
    assert "calendars/club-009-team-1.ics: eol: unspecified" in attributes
    assert "calendars/club-009-team-1.ics: diff: unset" in attributes


def test_calendar_index_shell_order_and_pages_subpath_contract() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    data_status = '<script src="data_status.js?v=1"></script>'
    calendar_index = '<script src="calendar_index.js?v=1"></script>'
    archive_data = '<script src="archive_data.js?v=9"></script>'
    app_utils = '<script src="app_utils.js?v=4"></script>'
    match_model = '<script src="match_preview_model.js?v=2"></script>'
    bundle = '<script src="bundle_v31.js?v=4.4"></script>'

    assert html.count(calendar_index) == 1
    assert html.index(data_status) < html.index(calendar_index) < html.index(app_utils)
    for script in (archive_data, app_utils, match_model, bundle):
        assert html.count(script) == 1
    assert html.index(archive_data) < html.index(app_utils) < html.index(match_model) < html.index(bundle)
    assert all('src="./' not in script and 'src="/' not in script for script in (
        archive_data, app_utils, match_model, bundle,
    ))


def test_user_documentation_explains_historical_match_preview_evidence() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    guide = (ROOT / "USER_GUIDE.md").read_text(encoding="utf-8")

    for phrase in ("vor dem ersten Spieltag", "historische", "neutrale"):
        assert phrase in readme
    for phrase in (
        "Aktuell",
        "Aktuell + Historie",
        "Vorjahreskader",
        "Neutraler Klassenwert",
        "tatsächlichen Einsätzen",
        "70 %",
        "30 %",
        "Bezirksliga",
        "A-Klasse",
        "B-Klasse",
        "C-Klasse",
        "manuell",
        "Kaderzugehörigkeit unbestätigt",
        "Plausibler Bereich",
        "GitHub Pages",
        "statischen Artefakten",
        "horizontalen Karussell",
        "Stärkevergleich",
        "keine einzelne Sieg-Wahrscheinlichkeit",
        "unsichere Datenbasis",
    ):
        assert phrase in guide


def test_public_refresh_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_public_refresh.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def _unfold_ics(payload: bytes) -> list[str]:
    assert payload.endswith(b"\r\n")
    assert b"\n" not in payload.replace(b"\r\n", b"")
    assert b"\r" not in payload.replace(b"\r\n", b"")
    physical_lines = payload[:-2].split(b"\r\n")
    assert all(len(line) <= 75 for line in physical_lines)
    assert all(not line.endswith((b" ", b"\t")) for line in physical_lines)

    logical_lines: list[bytes] = []
    for line in physical_lines:
        if line.startswith(b" "):
            assert logical_lines
            logical_lines[-1] += line[1:]
        else:
            logical_lines.append(line)
    return [line.decode("utf-8") for line in logical_lines]


def _ics_event_statuses(logical_lines: list[str]) -> dict[str, str]:
    events: dict[str, str] = {}
    current: dict[str, str] | None = None
    for line in logical_lines:
        if line == "BEGIN:VEVENT":
            assert current is None
            current = {}
            continue
        if line == "END:VEVENT":
            assert current is not None
            assert set(current) == {"UID", "STATUS"}
            uid = current["UID"]
            assert uid not in events
            events[uid] = current["STATUS"]
            current = None
            continue
        if current is None or ":" not in line:
            continue
        property_name, value = line.split(":", 1)
        property_name = property_name.split(";", 1)[0]
        if property_name in {"UID", "STATUS"}:
            assert property_name not in current
            current[property_name] = value
    assert current is None
    return events


def _assert_calendar_artifacts(
    index: dict[str, object],
    state: dict[str, object],
    feed_payloads: dict[str, bytes],
    league_data: dict[str, object],
    club_data: dict[str, object],
    index_js: bytes,
) -> None:
    assert isinstance(state.get("updated_at"), str)
    try:
        authoritative_updated_at = datetime.fromisoformat(
            state["updated_at"].replace("Z", "+00:00")
        )
        canonical = build_calendar_publication(
            league_data,
            club_data,
            previous_state=state,
            updated_at=authoritative_updated_at,
        )
    except (AttributeError, CalendarSourceError, TypeError, ValueError) as error:
        raise AssertionError("Kalenderartefakte sind nicht kanonisch reproduzierbar") from error

    canonical_feed_payloads = {
        f"calendars/{team_id}.ics": payload
        for team_id, payload in canonical.calendars.items()
    }
    assert index == json.loads(canonical.calendar_index_json)
    assert index_js == canonical.calendar_index_js
    assert state == json.loads(canonical.calendar_state_json)
    assert feed_payloads == canonical_feed_payloads

    path_team_ids: dict[str, set[str]] = {}
    for entry in index["teams"].values():
        path = entry["path"]
        team_id = entry["team_id"]
        team_name = entry["name"]
        assert isinstance(path, str)
        assert isinstance(team_id, str)
        assert isinstance(team_name, str)
        assert path == f"calendars/{team_id}.ics"
        path_team_ids.setdefault(path, set()).add(team_id)
    assert all(len(team_ids) == 1 for team_ids in path_team_ids.values())

    indexed_paths = set(path_team_ids)
    assert all(path.startswith("calendars/") and path.endswith(".ics") for path in indexed_paths)
    assert set(feed_payloads) == indexed_paths

    published_uids: set[str] = set()
    feed_events: dict[str, dict[str, str]] = {}
    published_event_count = 0
    for relative_path in sorted(indexed_paths):
        payload = feed_payloads[relative_path]
        logical_lines = _unfold_ics(payload)
        text = "\n".join(logical_lines)
        ics_events = _ics_event_statuses(logical_lines)
        uids = set(ics_events)
        event_count = logical_lines.count("BEGIN:VEVENT")
        assert event_count == logical_lines.count("END:VEVENT")
        assert event_count > 0 or "X-BWEDL-EMPTY-FEED:TRUE" in logical_lines
        assert len(ics_events) == event_count
        assert not published_uids.intersection(uids)
        assert "Ligapokal" not in text
        if event_count:
            assert index["season"] in text
        published_uids.update(uids)
        feed_events[relative_path] = ics_events
        published_event_count += event_count

    events = state["events"]
    source_lines = classify_regular_league_source_lines(league_data)
    scheduled_source_count = sum(
        source_line.classification == "game" for source_line in source_lines
    )
    parsed_games = parse_regular_league_games(league_data, club_data)
    assert len(parsed_games) == scheduled_source_count

    expected_fixtures: dict[
        tuple[str, str, str, str, str],
        Counter[tuple[str, str, bool, str]],
    ] = {}
    for game in parsed_games:
        starts_at = game.starts_at_utc.isoformat().replace("+00:00", "Z")
        fixture_key = (
            game.league,
            game.round_name,
            game.home.name,
            game.away.name,
            starts_at,
        )
        assert fixture_key not in expected_fixtures
        expected_fixtures[fixture_key] = Counter(
            (
                (game.home.team_id, game.home.name, True, game.away.name),
                (game.away.team_id, game.away.name, False, game.home.name),
            )
        )

    assert state["season"] == index["season"]
    assert all(game.season == index["season"] for game in parsed_games)
    assert published_event_count == len(events)
    assert all(event["season"] == index["season"] for event in events)
    assert all("Ligapokal" not in event["league"] for event in events)

    state_events_by_uid: dict[str, str] = {}
    state_events_by_team: dict[str, dict[str, str]] = {}
    confirmed_fixtures: dict[
        tuple[str, str, str, str, str], Counter[tuple[str, str, bool, str]]
    ] = {}
    for event in events:
        team_id = event["team_id"]
        team_name = event["team_name"]
        uid = event["uid"]
        status = event["status"]
        assert isinstance(team_id, str)
        assert isinstance(team_name, str)
        assert isinstance(uid, str)
        assert status in {"CONFIRMED", "CANCELLED"}
        assert uid not in state_events_by_uid
        state_events_by_uid[uid] = status
        state_events_by_team.setdefault(team_id, {})[uid] = status
        assert isinstance(event["is_home"], bool)
        fixture_key = (
            event["league"],
            event["round_name"],
            event["home_team"],
            event["away_team"],
            event["starts_at"],
        )
        if status == "CONFIRMED":
            perspective = (team_id, team_name, event["is_home"], event["opponent"])
            confirmed_fixtures.setdefault(fixture_key, Counter())[perspective] += 1

    assert published_uids == set(state_events_by_uid)

    indexed_team_ids = {next(iter(team_ids)) for team_ids in path_team_ids.values()}
    assert set(state_events_by_team) <= indexed_team_ids
    for path, team_ids in path_team_ids.items():
        team_id = next(iter(team_ids))
        assert feed_events[path] == state_events_by_team.get(team_id, {})

    assert set(confirmed_fixtures) == set(expected_fixtures)
    for fixture_key, expected_perspectives in expected_fixtures.items():
        assert confirmed_fixtures[fixture_key] == expected_perspectives


def _committed_calendar_artifacts() -> tuple[
    dict[str, object],
    dict[str, object],
    dict[str, bytes],
    dict[str, object],
    dict[str, object],
    bytes,
]:
    index = json.loads((ROOT / "calendar_index.json").read_text(encoding="utf-8"))
    state = json.loads((ROOT / "calendar_state.json").read_text(encoding="utf-8"))
    league_data = json.loads((ROOT / "league_data.json").read_text(encoding="utf-8"))
    club_data = json.loads((ROOT / "club_data.json").read_text(encoding="utf-8"))
    index_js = (ROOT / "calendar_index.js").read_bytes()
    calendar_directory = ROOT / "calendars"
    assert all(path.is_file() and path.suffix == ".ics" for path in calendar_directory.iterdir())
    feed_payloads = {
        path.relative_to(ROOT).as_posix(): path.read_bytes()
        for path in calendar_directory.iterdir()
    }
    return index, state, feed_payloads, league_data, club_data, index_js


def test_committed_calendar_artifacts_are_complete_and_consistent() -> None:
    _assert_calendar_artifacts(*_committed_calendar_artifacts())


def test_calendar_audit_rejects_duplicate_fixture_perspective() -> None:
    index, state, feed_payloads, league_data, club_data, index_js = (
        _committed_calendar_artifacts()
    )
    mutated_state = deepcopy(state)
    first = mutated_state["events"][0]
    fixture_key = (
        first["league"], first["round_name"], first["home_team"],
        first["away_team"], first["starts_at"],
    )
    second = next(
        event
        for event in mutated_state["events"][1:]
        if (
            event["league"], event["round_name"], event["home_team"],
            event["away_team"], event["starts_at"],
        ) == fixture_key
    )
    for field in ("team_id", "team_name", "is_home", "opponent"):
        second[field] = first[field]

    with pytest.raises(AssertionError):
        _assert_calendar_artifacts(
            index,
            mutated_state,
            feed_payloads,
            league_data,
            club_data,
            index_js,
        )


def test_calendar_audit_accepts_complete_cancelled_fixture_tombstones() -> None:
    club_data = {
        "clubs": [
            {
                "name": "DC Heim e.V.",
                "number": "101",
                "venue": "Heimspielstätte",
                "street": "Dartweg 7",
                "city": "75172 Pforzheim",
            },
            {
                "name": "DC Gast",
                "number": "202",
                "venue": "Gastheim",
                "street": "Auswärtsweg 3",
                "city": "75300 Musterstadt",
            },
        ]
    }
    initial_league_data = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": "Fr. 23. 10.2026 20:00 DC Heim - DC Gast ---\n",
                    "2. Spieltag": "Fr. 30. 10.2026 20:00 DC Gast - DC Heim ---\n",
                }
            }
        }
    }
    initial = build_calendar_publication(
        initial_league_data,
        club_data,
        updated_at=datetime(2026, 8, 19, tzinfo=timezone.utc),
    )
    current_league_data = deepcopy(initial_league_data)
    del current_league_data["leagues"]["A-Klasse 2026-2027"]["match_days"][
        "2. Spieltag"
    ]
    current = build_calendar_publication(
        current_league_data,
        club_data,
        previous_state=json.loads(initial.calendar_state_json),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    index = json.loads(current.calendar_index_json)
    state = json.loads(current.calendar_state_json)
    feed_payloads = {
        f"calendars/{team_id}.ics": payload
        for team_id, payload in current.calendars.items()
    }

    assert Counter(event["status"] for event in state["events"]) == {
        "CONFIRMED": 2,
        "CANCELLED": 2,
    }
    _assert_calendar_artifacts(
        index,
        state,
        feed_payloads,
        current_league_data,
        club_data,
        current.calendar_index_js,
    )


def test_calendar_audit_accepts_opponent_change_with_one_cancelled_perspective() -> None:
    club_data = {
        "clubs": [
            {
                "name": "DC A",
                "number": "101",
                "venue": "A",
                "street": "A 1",
                "city": "A-Stadt",
            },
            {
                "name": "DC B",
                "number": "202",
                "venue": "B",
                "street": "B 2",
                "city": "B-Stadt",
            },
            {
                "name": "DC C",
                "number": "303",
                "venue": "C",
                "street": "C 3",
                "city": "C-Stadt",
            },
        ]
    }
    initial_league_data = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": "Fr. 23. 10.2026 20:00 DC A - DC B ---\n"
                }
            }
        }
    }
    initial = build_calendar_publication(
        initial_league_data,
        club_data,
        updated_at=datetime(2026, 8, 19, tzinfo=timezone.utc),
    )
    current_league_data = deepcopy(initial_league_data)
    current_league_data["leagues"]["A-Klasse 2026-2027"]["match_days"][
        "1. Spieltag"
    ] = "Fr. 23. 10.2026 20:00 DC A - DC C ---\n"
    current = build_calendar_publication(
        current_league_data,
        club_data,
        previous_state=json.loads(initial.calendar_state_json),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    index = json.loads(current.calendar_index_json)
    state = json.loads(current.calendar_state_json)
    feed_payloads = {
        f"calendars/{team_id}.ics": payload
        for team_id, payload in current.calendars.items()
    }

    assert Counter(event["status"] for event in state["events"]) == {
        "CONFIRMED": 2,
        "CANCELLED": 1,
    }
    _assert_calendar_artifacts(
        index,
        state,
        feed_payloads,
        current_league_data,
        club_data,
        current.calendar_index_js,
    )


def test_calendar_audit_rejects_joint_state_and_feed_uid_tampering() -> None:
    index, state, feed_payloads, league_data, club_data, index_js = (
        _committed_calendar_artifacts()
    )
    mutated_state = deepcopy(state)
    event = mutated_state["events"][0]
    original_uid = event["uid"]
    bogus_uid = "bogus-uid@calendar.bwedl.de"
    event["uid"] = bogus_uid
    path = f"calendars/{event['team_id']}.ics"
    logical_lines = _unfold_ics(feed_payloads[path])
    assert logical_lines.count(f"UID:{original_uid}") == 1
    mutated_lines = [
        f"UID:{bogus_uid}" if line == f"UID:{original_uid}" else line
        for line in logical_lines
    ]
    mutated_feeds = dict(feed_payloads)
    mutated_feeds[path] = _fold_ical_lines(mutated_lines).encode("utf-8")

    with pytest.raises(AssertionError):
        _assert_calendar_artifacts(
            index,
            mutated_state,
            mutated_feeds,
            league_data,
            club_data,
            index_js,
        )


def test_calendar_audit_rejects_ghost_index_team_and_empty_feed() -> None:
    index, state, feed_payloads, league_data, club_data, index_js = (
        _committed_calendar_artifacts()
    )
    mutated_index = deepcopy(index)
    mutated_index["teams"]["ghost team"] = {
        "name": "Ghost Team",
        "path": "calendars/club-999-team-1.ics",
        "team_id": "club-999-team-1",
        "club_number": "999",
        "team_slot": 1,
        "warning_count": 0,
    }
    mutated_feeds = dict(feed_payloads)
    mutated_feeds["calendars/club-999-team-1.ics"] = (
        b"BEGIN:VCALENDAR\r\n"
        b"VERSION:2.0\r\n"
        b"X-BWEDL-EMPTY-FEED:TRUE\r\n"
        b"END:VCALENDAR\r\n"
    )

    with pytest.raises(AssertionError):
        _assert_calendar_artifacts(
            mutated_index,
            state,
            mutated_feeds,
            league_data,
            club_data,
            index_js,
        )
