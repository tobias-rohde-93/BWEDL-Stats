from pathlib import Path

from bs4 import BeautifulSoup


FIXTURES = Path(__file__).parent / "fixtures"


def test_representative_html_fixtures() -> None:
    league = BeautifulSoup(
        (FIXTURES / "league_regular.html").read_text(encoding="utf-8"),
        "html.parser",
    )
    matchdays = league.select('select[name="wtWahl"] option')

    rankings = BeautifulSoup(
        (FIXTURES / "rankings_complete.html").read_text(encoding="utf-8"),
        "html.parser",
    )
    ranking_text = rankings.get_text(" ", strip=True)

    assert len(matchdays) == 18
    assert all(
        option.get_text(strip=True) == f"{number}. Spieltag"
        for number, option in enumerate(matchdays, 1)
    )
    assert "DC Strikers" in league.get_text(" ", strip=True)
    assert all(
        league_name in ranking_text
        for league_name in ("Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse")
    )
