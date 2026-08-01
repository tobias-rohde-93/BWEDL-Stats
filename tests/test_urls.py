import importlib

import pytest

import archive_scraper
import archive_tables_scraper
import club_scraper
import league_scraper
import ranking_scraper


def _normalize(href: str, path_prefix: str):
    urls = importlib.import_module("pipeline.urls")
    return urls.normalize_bwedl_url(href, path_prefix)


@pytest.mark.parametrize(
    ("case", "href", "path_prefix", "expected"),
    [
        (
            "league",
            "/tabellen/bezirksliga/?token=secret#round",
            "/tabellen/",
            "https://www.bwedl.de/tabellen/bezirksliga/",
        ),
        (
            "ranking",
            "https://www.bwedl.de:443/ranglisten/a-klasse/",
            "/ranglisten/",
            "https://www.bwedl.de/ranglisten/a-klasse/",
        ),
        (
            "club",
            "vereine/example/",
            "/vereine/",
            "https://www.bwedl.de/vereine/example/",
        ),
        (
            "archive-season",
            "/archiv/2025-2026/",
            "/archiv/",
            "https://www.bwedl.de/archiv/2025-2026/",
        ),
        (
            "archive-sub-link",
            "https://www.bwedl.de/archiv/2025-2026/ranglisten/",
            "/archiv/",
            "https://www.bwedl.de/archiv/2025-2026/ranglisten/",
        ),
    ],
    ids=lambda value: value if isinstance(value, str) and value in {
        "league", "ranking", "club", "archive-season", "archive-sub-link"
    } else None,
)
def test_normalize_bwedl_url_accepts_each_scraper_path(
    case: str, href: str, path_prefix: str, expected: str
) -> None:
    assert _normalize(href, path_prefix) == expected


@pytest.mark.parametrize(
    "href",
    [
        "http://www.bwedl.de/tabellen/a/",
        "https://external.example/tabellen/a/",
        "https://stats.www.bwedl.de/tabellen/a/",
        "https://www.bwedl.de:444/tabellen/a/",
        "https://user@www.bwedl.de/tabellen/a/",
        "//external.example/tabellen/a/",
        "/tabellen\\external.example/a/",
        "/tabellen/a/\nhttps://external.example/",
        "/ranglisten/a/",
    ],
)
def test_normalize_bwedl_url_rejects_unsafe_navigation(href: str) -> None:
    assert _normalize(href, "/tabellen/") is None


@pytest.mark.parametrize(
    ("module", "path_prefix"),
    [
        (league_scraper, "/tabellen/"),
        (ranking_scraper, "/ranglisten/"),
        (club_scraper, "/vereine/"),
        (archive_scraper, "/archiv/"),
        (archive_tables_scraper, "/archiv/"),
    ],
)
def test_every_scraper_uses_shared_navigation_helper(module, path_prefix: str) -> None:
    urls = importlib.import_module("pipeline.urls")

    assert module.normalize_bwedl_url is urls.normalize_bwedl_url
    assert module.normalize_bwedl_url(
        f"https://external.example{path_prefix}item/", path_prefix
    ) is None
