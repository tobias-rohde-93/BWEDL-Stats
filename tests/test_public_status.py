import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_status_script_loads_synchronously_before_application_bundle() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    status_script = '<script src="data_status.js?v=1"></script>'
    bundle_script = '<script src="bundle_v31.js?v=3.8"></script>'
    assert status_script in html
    assert html.index(status_script) < html.index(bundle_script)
    assert "async" not in status_script
    assert "defer" not in status_script


def test_status_panel_is_accessible_and_names_every_public_domain() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    javascript = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")

    assert 'id="data-status-list"' in html
    assert 'aria-live="polite"' in html
    assert '<ul' in html
    for label in ("Liga", "Rangliste", "Vereine", "Archiv"):
        assert label in javascript
    assert "Vorjahresstand" in javascript


def test_bundle_uses_safe_status_fallback_without_status_inner_html() -> None:
    javascript = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")

    assert "window.DATA_STATUS || { domains: {} }" in javascript
    assert "statusList.innerHTML" not in javascript
    assert "statusItem.innerHTML" not in javascript
    assert ".textContent" in javascript
    assert "Status unbekannt" in javascript


def test_service_worker_treats_both_status_files_as_network_first_data() -> None:
    worker = (ROOT / "sw_v31.js").read_text(encoding="utf-8")

    assert re.search(r"^const CACHE_NAME = 'bwedl-dashboard-v41';$", worker, re.MULTILINE)
    assert "bwedl-dashboard-v40" not in worker
    assert "'./data_status.json'" in worker
    assert "'./data_status.js?v=1'" in worker
    assert "data_status.json" in worker[worker.index("const isDataFile") :]
    assert "data_status.js" in worker[worker.index("const isDataFile") :]
    network_first = worker.index("if (isDataFile)")
    assert worker.index("fetch(event.request)", network_first) < worker.index(
        "caches.match(event.request)", network_first
    )


def test_published_status_json_and_javascript_match_retained_source_data() -> None:
    payload = json.loads((ROOT / "data_status.json").read_text(encoding="utf-8"))
    javascript = (ROOT / "data_status.js").read_text(encoding="utf-8").strip()
    prefix = "window.DATA_STATUS = "

    assert javascript.startswith(prefix)
    assert javascript.endswith(";")
    assert json.loads(javascript[len(prefix) : -1]) == payload
    assert payload["domains"]["rankings"] == {
        "season": "2025/26",
        "state": "retained",
        "updated_at": "2026-06-10T03:04:09Z",
    }


def test_status_formatter_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_public_status.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_status_service_worker_query_fallback_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_service_worker_status.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
