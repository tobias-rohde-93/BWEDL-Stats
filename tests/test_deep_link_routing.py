import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_deep_link_routing_contract_in_node() -> None:
    subprocess.run(
        ["node", str(ROOT / "tests" / "test_deep_link_routing.js")],
        cwd=ROOT,
        check=True,
    )
