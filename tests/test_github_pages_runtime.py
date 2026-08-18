import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_obsolete_local_product_runtime_is_removed() -> None:
    assert not (ROOT / "server.py").exists()
    assert not (ROOT / "start.bat").exists()
    assert not (ROOT / "setup.bat").exists()


def test_product_bundle_only_refreshes_published_static_data() -> None:
    javascript = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")

    assert "BwedlAppUtils.probePublishedData" in javascript
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


def test_service_worker_has_no_local_api_runtime_contract() -> None:
    worker = (ROOT / "sw_v31.js").read_text(encoding="utf-8")

    assert "/api/" not in worker
    assert "localhost" not in worker
    assert "127.0.0.1" not in worker
    assert "'./data_status.json'" in worker


def test_public_refresh_contract_in_node() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_public_refresh.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
