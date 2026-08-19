import json
from datetime import timezone
from pathlib import Path

import pytest

from pipeline.calendar_feeds import (
    CalendarSourceError,
    build_club_catalog,
    classify_regular_league_source_lines,
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
    assert normalize_team_name("ẞtraße") == "sstrasse"
    assert normalize_team_name("AB️CD") == "abcd"
    assert normalize_team_name("AŁBøC") == "a b c"


def test_build_catalog_resolves_explicit_legal_form_alias_and_team_slot() -> None:
    catalog = build_club_catalog(CLUBS)

    team = catalog.resolve_team("DC Heim 2")

    assert team is not None
    assert team.team_id == "club-101-team-2"
    assert team.club_name == "DC Heim e.V."
    assert catalog.resolve_team("DC Heimer 2") is None


def test_catalog_rejects_duplicate_club_numbers_before_building_indexes() -> None:
    clubs = {"clubs": [CLUBS["clubs"][0], {**CLUBS["clubs"][1], "number": "101"}]}

    with pytest.raises(CalendarSourceError, match=r"101.*DC Heim.*DC Gast"):
        build_club_catalog(clubs)


@pytest.mark.parametrize("number", ["../7", "١٠١", 7])
def test_catalog_rejects_non_ascii_club_numbers(number: object) -> None:
    clubs = {"clubs": [{**CLUBS["clubs"][0], "number": number}]}

    with pytest.raises(CalendarSourceError, match="Vereinsnummer"):
        build_club_catalog(clubs)


def test_catalog_indexes_are_immutable() -> None:
    catalog = build_club_catalog(CLUBS)

    with pytest.raises(TypeError):
        catalog.clubs_by_number["999"] = catalog.clubs_by_number["101"]


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


def test_regular_game_without_time_is_skipped_independently_of_bye_filter() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": "Fr. 30. 10.2026 DC Heim - DC Gast ---\n"
                }
            }
        }
    }

    assert parse_regular_league_games(leagues, CLUBS) == []


def test_nonexistent_berlin_spring_dst_time_is_skipped() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": "So. 29. 3.2026 02:30 DC Heim - DC Gast ---\n"
                }
            }
        }
    }

    assert parse_regular_league_games(leagues, CLUBS) == []


def test_ambiguous_berlin_autumn_dst_time_is_skipped() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": "So. 25. 10.2026 02:30 DC Heim - DC Gast ---\n"
                }
            }
        }
    }

    assert parse_regular_league_games(leagues, CLUBS) == []


def test_parse_regular_games_keeps_partial_home_address_and_marks_it_incomplete() -> None:
    clubs = {"clubs": [{**CLUBS["clubs"][0], "street": "", "city": ""}, CLUBS["clubs"][1]]}

    game = parse_regular_league_games(LEAGUES, clubs)[0]

    assert game.location is not None
    assert game.location.address == "Heimspielstätte"
    assert game.location.incomplete is True


def test_null_address_parts_are_not_stringified_or_treated_as_complete() -> None:
    clubs = {
        "clubs": [
            {**CLUBS["clubs"][0], "venue": None, "street": "Dartweg 7", "city": None},
            CLUBS["clubs"][1],
        ]
    }

    game = parse_regular_league_games(LEAGUES, clubs)[0]

    assert game.location is not None
    assert game.location.venue == ""
    assert game.location.street == "Dartweg 7"
    assert game.location.city == ""
    assert game.location.address == "Dartweg 7"
    assert game.location.incomplete is True


def test_address_placeholder_is_omitted_and_marks_location_incomplete() -> None:
    clubs = {
        "clubs": [
            {**CLUBS["clubs"][0], "street": "-"},
            CLUBS["clubs"][1],
        ]
    }

    game = parse_regular_league_games(LEAGUES, clubs)[0]

    assert game.location is not None
    assert game.location.address == "Heimspielstätte, 75172 Pforzheim"
    assert game.location.incomplete is True
    assert game.location_status == "Austragungsort unvollständig"


def test_all_missing_or_placeholder_address_values_create_no_location() -> None:
    clubs = {
        "clubs": [
            {**CLUBS["clubs"][0], "venue": "-", "street": "   ", "city": None},
            CLUBS["clubs"][1],
        ]
    }

    game = parse_regular_league_games(LEAGUES, clubs)[0]

    assert game.location is None
    assert game.location_status == "Austragungsort unvollständig"


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


def test_ambiguous_catalog_alias_uses_fallback_without_home_location() -> None:
    clubs = {
        "clubs": [
            {"name": "DC Kollidiert", "number": "303", "venue": "Eins", "street": "A", "city": "B"},
            {"name": "DC Kollidiert", "number": "404", "venue": "Zwei", "street": "C", "city": "D"},
            CLUBS["clubs"][1],
        ]
    }
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": "Fr. 30. 10.2026 20:00 DC Kollidiert - DC Gast ---\n"
                }
            }
        }
    }

    game = parse_regular_league_games(leagues, clubs)[0]

    assert game.home.team_id == "team-07c185a543a08082"
    assert game.home.club_number is None
    assert game.location is None
    assert game.location_status == "Austragungsort nicht auflösbar"


def test_missing_league_season_is_rejected_diagnostically() -> None:
    leagues = {
        "leagues": {
            "A-Klasse ohne Saison": {
                "match_days": {
                    "2. Spieltag": "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n"
                }
            }
        }
    }

    with pytest.raises(CalendarSourceError, match="A-Klasse ohne Saison"):
        parse_regular_league_games(leagues, CLUBS)


def test_missing_or_non_mapping_match_days_are_rejected_with_league_context() -> None:
    missing = {"leagues": {"A-Klasse 2026-2027": {}}}
    malformed = {"leagues": {"A-Klasse 2026-2027": {"match_days": "ungültig"}}}

    with pytest.raises(CalendarSourceError, match="A-Klasse 2026-2027"):
        parse_regular_league_games(missing, CLUBS)
    with pytest.raises(CalendarSourceError, match="A-Klasse 2026-2027"):
        parse_regular_league_games(malformed, CLUBS)


def test_non_mapping_league_and_non_string_fixture_text_are_rejected() -> None:
    non_mapping_league = {"leagues": {"A-Klasse 2026-2027": []}}
    non_string_fixture = {
        "leagues": {"A-Klasse 2026-2027": {"match_days": {"2. Spieltag": ["kein Text"]}}}
    }

    with pytest.raises(CalendarSourceError, match="A-Klasse 2026-2027"):
        parse_regular_league_games(non_mapping_league, CLUBS)
    with pytest.raises(CalendarSourceError, match=r"A-Klasse.*2\. Spieltag"):
        parse_regular_league_games(non_string_fixture, CLUBS)


def test_empty_fixture_text_is_rejected_with_league_and_round() -> None:
    leagues = {
        "leagues": {"A-Klasse 2026-2027": {"match_days": {"2. Spieltag": "   \n"}}}
    }

    with pytest.raises(CalendarSourceError, match=r"A-Klasse.*2\. Spieltag"):
        parse_regular_league_games(leagues, CLUBS)


def test_unparseable_regular_fixture_line_is_rejected_with_league_and_round() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {"match_days": {"2. Spieltag": "kein Spielplantext\n"}}
        }
    }

    with pytest.raises(CalendarSourceError, match=r"A-Klasse.*2\. Spieltag"):
        parse_regular_league_games(leagues, CLUBS)


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

    classifications = classify_regular_league_source_lines(leagues)
    source_line_count = sum(
        1
        for league_name, league in leagues["leagues"].items()
        if "ligapokal" not in league_name.casefold()
        for fixture_text in league["match_days"].values()
        for line in fixture_text.splitlines()
        if line.strip()
    )
    assert len(classifications) == source_line_count
    assert {item.classification for item in classifications} <= {
        "game",
        "bye",
        "missing_time",
        "invalid_time",
    }
