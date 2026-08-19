import json
import subprocess
from collections import Counter
from copy import deepcopy
from pathlib import Path

import pytest

from pipeline.calendar_feeds import (
    classify_regular_league_source_lines,
    parse_regular_league_games,
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
        "HTTPS-Link kopieren",
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


def test_calendar_index_shell_order_and_pages_subpath_contract() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    data_status = '<script src="data_status.js?v=1"></script>'
    calendar_index = '<script src="calendar_index.js?v=1"></script>'
    app_utils = '<script src="app_utils.js?v=3"></script>'

    assert html.count(calendar_index) == 1
    assert html.index(data_status) < html.index(calendar_index) < html.index(app_utils)


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


def _assert_calendar_artifacts(
    index: dict[str, object],
    state: dict[str, object],
    feed_payloads: dict[str, bytes],
    league_data: dict[str, object],
    club_data: dict[str, object],
) -> None:
    path_team_ids: dict[str, set[str]] = {}
    for entry in index["teams"].values():
        path = entry["path"]
        team_id = entry["team_id"]
        assert isinstance(path, str)
        assert isinstance(team_id, str)
        assert path == f"calendars/{team_id}.ics"
        path_team_ids.setdefault(path, set()).add(team_id)
    assert all(len(team_ids) == 1 for team_ids in path_team_ids.values())

    indexed_paths = set(path_team_ids)
    assert all(path.startswith("calendars/") and path.endswith(".ics") for path in indexed_paths)
    assert set(feed_payloads) == indexed_paths

    published_uids: set[str] = set()
    feed_uids: dict[str, set[str]] = {}
    published_event_count = 0
    for relative_path in sorted(indexed_paths):
        payload = feed_payloads[relative_path]
        logical_lines = _unfold_ics(payload)
        text = "\n".join(logical_lines)
        uids = [line.removeprefix("UID:") for line in logical_lines if line.startswith("UID:")]
        event_count = logical_lines.count("BEGIN:VEVENT")
        assert event_count == logical_lines.count("END:VEVENT")
        assert event_count > 0 or "X-BWEDL-EMPTY-FEED:TRUE" in logical_lines
        assert len(uids) == event_count
        assert len(uids) == len(set(uids))
        assert not published_uids.intersection(uids)
        assert "Ligapokal" not in text
        if event_count:
            assert index["season"] in text
        published_uids.update(uids)
        feed_uids[relative_path] = set(uids)
        published_event_count += event_count

    events = state["events"]
    source_lines = classify_regular_league_source_lines(league_data)
    scheduled_source_count = sum(
        source_line.classification == "game" for source_line in source_lines
    )
    parsed_games = parse_regular_league_games(league_data, club_data)
    assert len(parsed_games) == scheduled_source_count

    expected_fixtures: dict[tuple[str, str, str, str, str], Counter[tuple[str, bool, str]]] = {}
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
                (game.home.name, True, game.away.name),
                (game.away.name, False, game.home.name),
            )
        )

    assert state["season"] == index["season"]
    assert {game.season for game in parsed_games} == {index["season"]}
    assert published_event_count == len(events) == len(parsed_games) * 2
    assert published_uids == {event["uid"] for event in events}
    assert all(event["season"] == index["season"] for event in events)
    assert all("Ligapokal" not in event["league"] for event in events)

    state_uids_by_team: dict[str, set[str]] = {}
    actual_fixtures: dict[
        tuple[str, str, str, str, str], Counter[tuple[str, bool, str]]
    ] = {}
    for event in events:
        team_id = event["team_id"]
        assert isinstance(team_id, str)
        state_uids_by_team.setdefault(team_id, set()).add(event["uid"])
        assert isinstance(event["is_home"], bool)
        fixture_key = (
            event["league"],
            event["round_name"],
            event["home_team"],
            event["away_team"],
            event["starts_at"],
        )
        perspective = (event["team_name"], event["is_home"], event["opponent"])
        actual_fixtures.setdefault(fixture_key, Counter())[perspective] += 1

    indexed_team_ids = {next(iter(team_ids)) for team_ids in path_team_ids.values()}
    assert set(state_uids_by_team) == indexed_team_ids
    for path, team_ids in path_team_ids.items():
        team_id = next(iter(team_ids))
        assert feed_uids[path] == state_uids_by_team[team_id]

    assert set(actual_fixtures) == set(expected_fixtures)
    for fixture_key, expected_perspectives in expected_fixtures.items():
        assert actual_fixtures[fixture_key] == expected_perspectives


def _committed_calendar_artifacts() -> tuple[
    dict[str, object],
    dict[str, object],
    dict[str, bytes],
    dict[str, object],
    dict[str, object],
]:
    index = json.loads((ROOT / "calendar_index.json").read_text(encoding="utf-8"))
    state = json.loads((ROOT / "calendar_state.json").read_text(encoding="utf-8"))
    league_data = json.loads((ROOT / "league_data.json").read_text(encoding="utf-8"))
    club_data = json.loads((ROOT / "club_data.json").read_text(encoding="utf-8"))
    calendar_directory = ROOT / "calendars"
    assert all(path.is_file() and path.suffix == ".ics" for path in calendar_directory.iterdir())
    feed_payloads = {
        path.relative_to(ROOT).as_posix(): path.read_bytes()
        for path in calendar_directory.iterdir()
    }
    return index, state, feed_payloads, league_data, club_data


def test_committed_calendar_artifacts_are_complete_and_consistent() -> None:
    _assert_calendar_artifacts(*_committed_calendar_artifacts())


def test_calendar_audit_rejects_duplicate_fixture_perspective() -> None:
    index, state, feed_payloads, league_data, club_data = _committed_calendar_artifacts()
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
        )
