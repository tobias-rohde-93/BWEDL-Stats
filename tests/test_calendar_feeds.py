import json
from datetime import timezone
from pathlib import Path

import pytest

from pipeline.calendar_feeds import (
    CalendarSourceError,
    build_club_catalog,
    normalize_team_name,
    parse_regular_league_games,
)


ROOT = Path(__file__).resolve().parents[1]

CLUBS = {
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

LEAGUES = {
    "leagues": {
        "Bezirksliga 2026-2027": {
            "match_days": {
                "1. Spieltag": (
                    "So. 29. 3.2026 19:30 DC Heim 2                 - DC Gast                    ---\n"
                    "So. 29. 3.2026       DC Heim                   - Spielfrei                  ---\n"
                )
            }
        },
        "Ligapokal 2026-2027": {
            "match_days": {
                "Runde 1": "So. 29. 3.2026 19:30 DC Heim - DC Gast ---\n"
            }
        },
    }
}


def test_normalization_matches_the_cross_runtime_contract() -> None:
    assert normalize_team_name("  DĆ  Straße!  ") == "dc strasse"


def test_build_catalog_resolves_explicit_legal_form_alias_and_team_slot() -> None:
    catalog = build_club_catalog(CLUBS)

    team = catalog.resolve_team("DC Heim 2")

    assert team is not None
    assert team.team_id == "club-101-team-2"
    assert team.club_name == "DC Heim e.V."
    assert catalog.resolve_team("DC Heimer 2") is None


def test_parse_regular_games_excludes_cup_byes_and_missing_times() -> None:
    games = parse_regular_league_games(LEAGUES, CLUBS)

    assert len(games) == 1
    game = games[0]
    assert game.season == "2026-2027"
    assert game.league == "Bezirksliga 2026-2027"
    assert game.round_name == "1. Spieltag"
    assert game.home.team_id == "club-101-team-2"
    assert game.away.team_id == "club-202-team-1"
    assert game.starts_at_utc.isoformat() == "2026-03-29T17:30:00+00:00"
    assert game.starts_at_utc.tzinfo == timezone.utc
    assert game.location is not None
    assert game.location.address == "Heimspielstätte, Dartweg 7, 75172 Pforzheim"
    assert game.location.incomplete is False


def test_parse_regular_games_keeps_partial_home_address_and_marks_it_incomplete() -> None:
    clubs = {"clubs": [{**CLUBS["clubs"][0], "street": "", "city": ""}, CLUBS["clubs"][1]]}

    game = parse_regular_league_games(LEAGUES, clubs)[0]

    assert game.location is not None
    assert game.location.address == "Heimspielstätte"
    assert game.location.incomplete is True


def test_unresolved_home_never_uses_guest_address_and_has_deterministic_fallback() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": "Fr. 30. 10.2026 20:00 Unbekanntes Team - DC Gast ---\n"
                }
            }
        }
    }

    game = parse_regular_league_games(leagues, CLUBS)[0]

    assert game.home.team_id == "team-fdce66b80ba5e109"
    assert game.location is None
    assert game.location_status == "Austragungsort nicht auflösbar"


def test_duplicate_target_team_in_league_round_is_rejected_diagnostically() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": (
                        "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n"
                        "Sa. 31. 10.2026 20:00 DC Heim - Fremdes Team ---\n"
                    )
                }
            }
        }
    }

    with pytest.raises(CalendarSourceError) as error:
        parse_regular_league_games(leagues, CLUBS)
    assert "A-Klasse 2026-2027" in str(error.value)
    assert "2. Spieltag" in str(error.value)
    assert "DC Heim" in str(error.value)


def test_exact_duplicate_fixture_is_rejected_diagnostically() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": (
                        "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n"
                        "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n"
                    )
                }
            }
        }
    }

    with pytest.raises(CalendarSourceError, match=r"A-Klasse.*2\. Spieltag.*DC Heim.*DC Gast"):
        parse_regular_league_games(leagues, CLUBS)


def test_repository_calendar_data_is_a_complete_resolved_regular_fixture_set() -> None:
    leagues = json.loads((ROOT / "league_data.json").read_text(encoding="utf-8"))
    clubs = json.loads((ROOT / "club_data.json").read_text(encoding="utf-8"))

    games = parse_regular_league_games(leagues, clubs)

    assert len(games) > 900
    assert all("ligapokal" not in game.league.casefold() for game in games)
    assert all(game.home.team_id.startswith("club-") for game in games)
    assert all(game.away.team_id.startswith("club-") for game in games)
    assert all(game.starts_at_utc.tzinfo == timezone.utc for game in games)
