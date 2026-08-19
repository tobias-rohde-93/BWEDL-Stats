import json
import subprocess
from collections import Counter
from pathlib import Path


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


def test_committed_calendar_artifacts_are_complete_and_consistent() -> None:
    index = json.loads((ROOT / "calendar_index.json").read_text(encoding="utf-8"))
    state = json.loads((ROOT / "calendar_state.json").read_text(encoding="utf-8"))
    calendar_directory = ROOT / "calendars"

    indexed_paths = {entry["path"] for entry in index["teams"].values()}
    assert all(path.startswith("calendars/") and path.endswith(".ics") for path in indexed_paths)
    assert all((ROOT / path).is_file() for path in indexed_paths)
    assert all(path.is_file() and path.suffix == ".ics" for path in calendar_directory.iterdir())
    actual_paths = {path.relative_to(ROOT).as_posix() for path in calendar_directory.iterdir()}
    assert actual_paths == indexed_paths

    published_uids: set[str] = set()
    published_event_count = 0
    for relative_path in sorted(indexed_paths):
        payload = (ROOT / relative_path).read_bytes()
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
        published_event_count += event_count

    events = state["events"]
    assert state["season"] == index["season"]
    assert published_event_count == len(events) == 1116 * 2
    assert published_uids == {event["uid"] for event in events}
    assert all(event["season"] == index["season"] for event in events)
    assert all("Ligapokal" not in event["league"] for event in events)

    fixture_perspectives = Counter(
        (
            event["league"],
            event["round_name"],
            event["home_team"],
            event["away_team"],
            event["starts_at"],
        )
        for event in events
    )
    assert len(fixture_perspectives) == 1116
    assert set(fixture_perspectives.values()) == {2}
