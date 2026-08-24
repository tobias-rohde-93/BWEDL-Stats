import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

import pipeline.calendar_feeds as calendar_feeds
from pipeline.calendar_feeds import (
    CalendarSourceError,
    CalendarPublication,
    build_club_catalog,
    build_calendar_publication,
    classify_regular_league_source_lines,
    _fold_ical_lines,
    main,
    normalize_team_name,
    parse_regular_league_games,
    write_calendar_publication,
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

UPDATED_AT = datetime(2026, 8, 19, 10, 15, tzinfo=timezone.utc)


def _publication(
    leagues: dict[str, object] = LEAGUES,
    clubs: dict[str, object] = CLUBS,
    *,
    previous_state: dict[str, object] | None = None,
    updated_at: datetime = UPDATED_AT,
) -> CalendarPublication:
    return build_calendar_publication(
        leagues,
        clubs,
        previous_state=previous_state,
        updated_at=updated_at,
    )


def _state(publication: CalendarPublication) -> dict[str, object]:
    return json.loads(publication.calendar_state_json)


def _feed(publication: CalendarPublication, team_id: str) -> str:
    return publication.calendars[team_id].decode("utf-8")


def _one_fixture(
    fixture: str = "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n",
    *,
    season: str = "2026-2027",
    round_name: str = "2. Spieltag",
) -> dict[str, object]:
    return {
        "leagues": {
            f"A-Klasse {season}": {"match_days": {round_name: fixture}}
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


def test_publication_has_immutable_artifacts_and_perspective_specific_events() -> None:
    publication = _publication(_one_fixture())

    assert publication.season == "2026-2027"
    assert publication.updated_at == UPDATED_AT
    assert isinstance(publication, CalendarPublication)
    with pytest.raises(FrozenInstanceError):
        publication.season = "changed"  # type: ignore[misc]

    home = _feed(publication, "club-101-team-1")
    away = _feed(publication, "club-202-team-1")
    assert "SUMMARY:Heimspiel gegen DC Gast" in home
    assert "SUMMARY:Ausw\u00e4rtsspiel bei DC Heim" in away
    assert "DTSTART:20261030T190000Z" in home
    assert "DTEND:20261030T220000Z" in home
    assert "LOCATION:Heimspielst\u00e4tte\\, Dartweg 7\\, 75172 Pforzheim" in home
    assert "DESCRIPTION:" in home
    assert "Austragungsort: Heimspielst\u00e4tte\\, Dartweg 7\\, 75172 Pforzheim" in home.replace("\r\n ", "")


def test_publication_keeps_partial_location_and_warns_when_home_is_unresolved() -> None:
    partial = {"clubs": [{**CLUBS["clubs"][0], "city": ""}, CLUBS["clubs"][1]]}
    partial_feed = _feed(_publication(_one_fixture(), partial), "club-101-team-1")
    assert "LOCATION:Heimspielst\u00e4tte\\, Dartweg 7" in partial_feed
    assert "Adresse unvollst\u00e4ndig" in partial_feed

    unresolved = _one_fixture("Fr. 30. 10.2026 20:00 Fremdes Team - DC Gast ---\n")
    guest_feed = _feed(_publication(unresolved), "club-202-team-1")
    assert "LOCATION:" not in guest_feed
    assert "Austragungsort nicht aufl\u00f6sbar" in guest_feed.replace("\r\n ", "")
    assert "Ausw\u00e4rtsweg" not in guest_feed


def test_ics_text_escaping_folding_and_crlf_are_rfc_safe() -> None:
    dangerous_name = "DC Heim,;\\\r\n" + ("Ä" * 40)
    clubs = {
        "clubs": [
            {**CLUBS["clubs"][0], "venue": dangerous_name},
            CLUBS["clubs"][1],
        ]
    }
    leagues = _one_fixture()

    feed = _feed(_publication(leagues, clubs), "club-101-team-1")
    raw = feed.encode("utf-8")
    assert b"\\\\" in raw and b"\\," in raw and b"\\;" in raw and b"\\n" in raw
    assert b"\n" not in raw.replace(b"\r\n", b"")
    assert feed.endswith("\r\n")
    for physical_line in feed.split("\r\n"):
        assert len(physical_line.encode("utf-8")) <= 75
        physical_line.encode("utf-8").decode("utf-8")
    assert "\r\n BEGIN" not in feed


def test_folding_moves_boundary_whitespace_to_the_continuation_losslessly() -> None:
    clubs = {"clubs": [{**CLUBS["clubs"][0], "venue": ("A" * 65) + "  B"}, CLUBS["clubs"][1]]}
    feed = _feed(_publication(_one_fixture(), clubs), "club-101-team-1")
    physical = feed.split("\r\n")
    location_start = next(index for index, line in enumerate(physical) if line.startswith("LOCATION:"))
    location_lines = [physical[location_start]]
    for line in physical[location_start + 1 :]:
        if not line.startswith(" "):
            break
        location_lines.append(line)

    assert all(len(line.encode("utf-8")) <= 75 for line in location_lines)
    assert all(not line.endswith((" ", "\t")) for line in location_lines)
    assert "".join([location_lines[0], *[line[1:] for line in location_lines[1:]]]) == (
        "LOCATION:" + ("A" * 65) + "  B\\, Dartweg 7\\, 75172 Pforzheim"
    )


def test_folding_preserves_unicode_and_rejects_unrenderable_trailing_whitespace() -> None:
    logical = "LOCATION:" + ("Ä" * 32) + "  B"
    folded = _fold_ical_lines([logical])
    physical = folded.rstrip("\r\n").split("\r\n")
    assert all(len(line.encode("utf-8")) <= 75 for line in physical)
    assert all(not line.endswith((" ", "\t")) for line in physical)
    assert "".join([physical[0], *[line[1:] for line in physical[1:]]]) == logical

    with pytest.raises(CalendarSourceError):
        _fold_ical_lines(["X:A "])
    with pytest.raises(CalendarSourceError):
        _fold_ical_lines(["X:A\t"])
    with pytest.raises(CalendarSourceError):
        _fold_ical_lines(["X:" + ("A" * 73) + (" " * 74) + "B"])


def test_uid_is_stable_and_only_the_changed_event_gets_a_sequence_bump() -> None:
    original_leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "2. Spieltag": "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n",
                    "3. Spieltag": "Sa. 31. 10.2026 20:00 DC Gast - DC Heim ---\n",
                }
            }
        }
    }
    original = _publication(
        original_leagues
    )
    old_state = _state(original)
    changed_leagues = json.loads(json.dumps(original_leagues))
    changed_leagues["leagues"]["A-Klasse 2026-2027"]["match_days"]["2. Spieltag"] = (
        "Fr. 30. 10.2026 21:00 DC Heim - DC Gast ---\n"
    )
    changed = _publication(
        changed_leagues,
        previous_state=old_state,
        updated_at=datetime(2026, 8, 20, 10, 15, tzinfo=timezone.utc),
    )
    before = {event["uid"]: event for event in old_state["events"]}
    after = {event["uid"]: event for event in _state(changed)["events"]}
    assert set(before) == set(after)
    changed_uids = [uid for uid in before if before[uid]["fingerprint"] != after[uid]["fingerprint"]]
    assert len(changed_uids) == 2  # One fixture has one event for each participating team.
    for uid in before:
        assert after[uid]["uid"] == uid
        if uid in changed_uids:
            assert after[uid]["sequence"] == before[uid]["sequence"] + 1
        else:
            assert after[uid]["sequence"] == before[uid]["sequence"]
            assert after[uid]["last_modified"] == before[uid]["last_modified"]


def test_noop_is_byte_identical_despite_a_later_authoritative_timestamp() -> None:
    original = _publication(_one_fixture())
    repeated = _publication(
        _one_fixture(),
        previous_state=_state(original),
        updated_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
    )

    assert repeated.calendar_index_json == original.calendar_index_json
    assert repeated.calendar_index_js == original.calendar_index_js
    assert repeated.calendar_state_json == original.calendar_state_json
    assert repeated.calendars == original.calendars


def test_removed_or_detimed_event_is_cancelled_and_restores_with_same_uid() -> None:
    original = _publication(_one_fixture())
    original_event = _state(original)["events"][0]
    removed = _publication(
        {"leagues": {"A-Klasse 2026-2027": {"match_days": {}}}},
        previous_state=_state(original),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    removed_events = _state(removed)["events"]
    assert len(removed_events) == 2
    assert all(event["status"] == "CANCELLED" for event in removed_events)
    assert all(event["sequence"] == 1 for event in removed_events)
    assert "STATUS:CANCELLED" in _feed(removed, "club-101-team-1")

    detimed = _publication(
        _one_fixture("Fr. 30. 10.2026 DC Heim - DC Gast ---\n"),
        previous_state=_state(original),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    assert all(event["status"] == "CANCELLED" for event in _state(detimed)["events"])

    restored = _publication(
        _one_fixture(),
        previous_state=_state(removed),
        updated_at=datetime(2026, 8, 21, tzinfo=timezone.utc),
    )
    restored_event = _state(restored)["events"][0]
    assert restored_event["uid"] == original_event["uid"]
    assert restored_event["sequence"] == 2
    assert restored_event["status"] == "CONFIRMED"
    assert "STATUS:CANCELLED" not in _feed(restored, "club-101-team-1")


def test_season_change_drops_old_state_and_multiple_seasons_are_diagnostic() -> None:
    original = _publication(_one_fixture())
    next_season = _publication(
        _one_fixture(season="2027-2028"), previous_state=_state(original)
    )
    state = _state(next_season)
    assert state["season"] == "2027-2028"
    assert all(event["season"] == "2027-2028" for event in state["events"])

    multiple = _one_fixture()
    multiple["leagues"]["A-Klasse 2027-2028"] = {"match_days": {"1. Spieltag": "Fr. 1. 1.2027 20:00 DC Heim - DC Gast ---\n"}}
    with pytest.raises(CalendarSourceError, match="Mehrere.*Saison"):
        _publication(multiple)


def test_missing_time_roster_keeps_team_feeds_stable_across_season_change() -> None:
    original = _publication(_one_fixture())
    assert set(original.calendars) == {"club-101-team-1", "club-202-team-1"}

    next_season_source = _one_fixture(
        "Fr. 29. 10.2027 DC Heim - DC Gast ---\n",
        season="2027-2028",
    )
    next_season = _publication(
        next_season_source,
        previous_state=_state(original),
        updated_at=datetime(2027, 8, 19, 10, 15, tzinfo=timezone.utc),
    )
    fresh_publication = _publication(
        next_season_source,
        updated_at=datetime(2027, 8, 19, 10, 15, tzinfo=timezone.utc),
    )

    assert next_season.season == "2027-2028"
    assert _state(next_season)["events"] == []
    assert set(next_season.calendars) == set(original.calendars)
    assert next_season.calendar_index_json == fresh_publication.calendar_index_json
    assert next_season.calendar_state_json == fresh_publication.calendar_state_json
    assert next_season.calendars == fresh_publication.calendars
    for feed in next_season.calendars.values():
        text = feed.decode("utf-8").replace("\r\n ", "")
        assert "BEGIN:VEVENT" not in text
        assert "2026-2027" not in text
        assert "X-BWEDL-EMPTY-FEED:TRUE" in text
        assert "X-WR-CALDESC:Spieltermine für die Saison 2027-2028 sind noch nicht bestätigt." in text

    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        write_calendar_publication(next_season, output)
        assert {path.name for path in (output / "calendars").iterdir()} == {
            "club-101-team-1.ics",
            "club-202-team-1.ics",
        }


def test_state_schema_and_feed_paths_are_strictly_validated() -> None:
    with pytest.raises(CalendarSourceError, match="State"):
        _publication(_one_fixture(), previous_state={"schema_version": 999})

    with pytest.raises(CalendarSourceError, match="Team-ID"):
        write_calendar_publication(
            replace(
                _publication(_one_fixture()),
                calendars={"../outside": b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"},
            ),
            Path.cwd(),
        )


def test_writer_rejects_a_calendar_directory_symlink_without_writing_outside() -> None:
    publication = _publication(_one_fixture())
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        output = root / "output"
        outside = root / "outside"
        output.mkdir()
        outside.mkdir()
        try:
            os.symlink(outside, output / "calendars", target_is_directory=True)
        except OSError as error:
            pytest.skip(f"Symlinks are unavailable for this test user: {error}")

        with pytest.raises(CalendarSourceError, match="Symlink"):
            write_calendar_publication(publication, output)
        assert list(outside.iterdir()) == []


def test_writer_identifies_a_calendar_directory_reparse_point_as_a_symlink(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    publication = _publication(_one_fixture())
    output = tmp_path / "output"
    calendars = output / "calendars"
    calendars.mkdir(parents=True)
    is_reparse_point = calendar_feeds._is_reparse_point

    monkeypatch.setattr(
        calendar_feeds,
        "_is_reparse_point",
        lambda path: path == calendars or is_reparse_point(path),
    )

    with pytest.raises(CalendarSourceError, match="Symlink"):
        write_calendar_publication(publication, output)


def test_writer_removes_a_stale_unresolved_hash_feed_without_touching_expected_feeds() -> None:
    publication = _publication(_one_fixture())
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        calendars = output / "calendars"
        calendars.mkdir(parents=True)
        stale_feed = calendars / "team-fdce66b80ba5e109.ics"
        stale_feed.write_bytes(b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")

        write_calendar_publication(publication, output)

        assert not stale_feed.exists()
        for team_id, expected_bytes in publication.calendars.items():
            assert (calendars / f"{team_id}.ics").read_bytes() == expected_bytes


def test_writer_preflights_all_targets_before_overwriting_any_artifact() -> None:
    publication = _publication(_one_fixture())
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        output.mkdir()
        sentinel = output / "calendar_index.json"
        sentinel.write_bytes(b"OLD")
        (output / "calendar_index.js").mkdir()

        with pytest.raises(CalendarSourceError):
            write_calendar_publication(publication, output)

        assert sentinel.read_bytes() == b"OLD"
        assert not (output / "calendars").exists()


def test_index_maps_canonical_observed_and_known_alias_names_through_cancellation() -> None:
    clubs = {
        "clubs": [
            {**CLUBS["clubs"][0], "name": "DC Striker´s"},
            CLUBS["clubs"][1],
        ]
    }
    leagues = _one_fixture("Fr. 30. 10.2026 20:00 DC Strikers - DC Gast ---\n")
    active = _publication(leagues, clubs)
    active_index = json.loads(active.calendar_index_json)
    teams = active_index["teams"]
    assert isinstance(teams, dict)
    assert teams[normalize_team_name("DC Strikers")]["path"] == "calendars/club-101-team-1.ics"
    assert teams[normalize_team_name("DC Striker´s")]["path"] == "calendars/club-101-team-1.ics"

    cancelled = _publication(
        {"leagues": {"A-Klasse 2026-2027": {"match_days": {}}}},
        clubs,
        previous_state=_state(active),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    cancelled_index = json.loads(cancelled.calendar_index_json)
    assert cancelled_index["teams"][normalize_team_name("DC Strikers")]["path"] == (
        "calendars/club-101-team-1.ics"
    )

    slot_two = _publication(
        _one_fixture("Fr. 30. 10.2026 20:00 DC Strikers 2 - DC Gast ---\n"), clubs
    )
    slot_two_index = json.loads(slot_two.calendar_index_json)
    assert slot_two_index["teams"][normalize_team_name("DC Strikers 2")]["path"] == (
        "calendars/club-101-team-2.ics"
    )
    assert list(active_index["teams"]) == sorted(active_index["teams"])


def test_event_content_uses_design_summary_description_and_explicit_status() -> None:
    publication = _publication(_one_fixture())
    home = _feed(publication, "club-101-team-1").replace("\r\n ", "")
    away = _feed(publication, "club-202-team-1").replace("\r\n ", "")

    assert "SUMMARY:Heimspiel gegen DC Gast" in home
    assert "SUMMARY:Auswärtsspiel bei DC Heim" in away
    assert "DESCRIPTION:Begegnung: DC Heim - DC Gast\\nHeimspiel\\nLiga: A-Klasse 2026-2027\\nSpieltag: 2. Spieltag\\nTermin:" in home
    assert "STATUS:CONFIRMED" in home

    cancelled = _publication(
        {"leagues": {"A-Klasse 2026-2027": {"match_days": {}}}},
        previous_state=_state(publication),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    restored = _publication(
        _one_fixture(), previous_state=_state(cancelled), updated_at=datetime(2026, 8, 21, tzinfo=timezone.utc)
    )
    assert "STATUS:CONFIRMED" in _feed(restored, "club-101-team-1")


def test_ics_text_filters_non_rfc_control_characters() -> None:
    clubs = {"clubs": [{**CLUBS["clubs"][0], "venue": "Halle\x00\x07\x7f"}, CLUBS["clubs"][1]]}
    feed = _feed(_publication(_one_fixture(), clubs), "club-101-team-1").encode("utf-8")
    assert b"\x00" not in feed
    assert b"\x07" not in feed
    assert b"\x7f" not in feed


@pytest.mark.parametrize(
    "mutation",
    [
        lambda publication: replace(publication, calendar_index_json=b"not json\n"),
        lambda publication: replace(publication, calendar_state_json=b"not json\n"),
        lambda publication: replace(publication, calendars={"club-101-team-1": b"bad\r\n"}),
        lambda publication: replace(publication, calendars={"club-101-team-1": b"BEGIN:VCALENDAR\nEND:VCALENDAR\n"}),
        lambda publication: replace(publication, calendars={"club-101-team-1": b"BEGIN:VCALENDAR\r\nUID:a\r\nUID:a\r\nEND:VCALENDAR\r\n"}),
        lambda publication: replace(publication, calendars={"club-101-team-1": b"BEGIN:VCALENDAR\r\n" + (b"A" * 76) + b"\r\nEND:VCALENDAR\r\n"}),
        lambda publication: replace(publication, calendars={"club-101-team-1": b"\xff"}),
        lambda publication: replace(publication, calendars={"club-101-team-1": "not bytes"}),
    ],
)
def test_writer_rejects_invalid_publication_before_creating_output(mutation: object) -> None:
    publication = mutation(_publication(_one_fixture()))
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(publication, output)
        assert not output.exists()


def test_writer_rejects_a_missing_output_child_below_a_symlink_ancestor() -> None:
    publication = _publication(_one_fixture())
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        outside = root / "outside"
        outside.mkdir()
        link = root / "linked"
        try:
            os.symlink(outside, link, target_is_directory=True)
        except OSError as error:
            pytest.skip(f"Symlinks are unavailable for this test user: {error}")
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(publication, link / "new-output")
        assert list(outside.iterdir()) == []


def test_index_rejects_alias_collisions_between_different_prior_team_feeds() -> None:
    initial_clubs = {
        "clubs": [
            {**CLUBS["clubs"][0], "name": "DC Striker´s"},
            {**CLUBS["clubs"][1], "name": "DC Andere"},
        ]
    }
    initial_leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": "Fr. 30. 10.2026 20:00 DC Strikers - DC Andere ---\n",
                }
            }
        }
    }
    original = _publication(initial_leagues, initial_clubs)
    colliding_clubs = {"clubs": [{**initial_clubs["clubs"][0]}, {**initial_clubs["clubs"][1], "name": "DC Strikers"}]}

    with pytest.raises(CalendarSourceError, match="Mehrdeutiger Kalenderindex"):
        _publication(
            {"leagues": {"A-Klasse 2026-2027": {"match_days": {}}}},
            colliding_clubs,
            previous_state=_state(original),
            updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
        )


def test_writer_wraps_replace_errors_as_calendar_source_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    publication = _publication(_one_fixture())
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"

        def fail_replace(_: object, __: object) -> None:
            raise OSError("disk blocked")

        monkeypatch.setattr("pipeline.calendar_feeds.os.replace", fail_replace)
        with pytest.raises(CalendarSourceError, match="kann nicht geschrieben"):
            write_calendar_publication(publication, output)


def test_cli_reports_source_errors_without_a_traceback() -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        league_path = root / "invalid.json"
        club_path = root / "clubs.json"
        league_path.write_text("{", encoding="utf-8")
        club_path.write_text(json.dumps(CLUBS), encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                "pipeline/calendar_feeds.py",
                "--league-json",
                str(league_path),
                "--club-json",
                str(club_path),
                "--output-dir",
                str(root / "output"),
                "--updated-at",
                "2026-08-19T10:15:00Z",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode != 0
        assert "Traceback" not in result.stderr
        assert "JSON-Datei nicht lesbar" in result.stderr


def test_index_keeps_all_observed_slot_one_fixture_name_variants() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": "Fr. 30. 10.2026 20:00 DC Heim - DC Gast ---\n",
                    "3. Spieltag": "Sa. 31. 10.2026 20:00 DC Heim 1 - DC Gast ---\n",
                }
            }
        }
    }
    index = json.loads(_publication(leagues).calendar_index_json)["teams"]
    assert index[normalize_team_name("DC Heim")]["team_id"] == "club-101-team-1"
    assert index[normalize_team_name("DC Heim 1")]["team_id"] == "club-101-team-1"


def test_alias_only_index_change_updates_publication_without_event_sequence_bump() -> None:
    initial_clubs = CLUBS
    leagues = _one_fixture("Fr. 30. 10.2026 20:00 DC Heim e.V. - DC Gast ---\n")
    original = _publication(leagues, initial_clubs)
    renamed_clubs = {"clubs": [{**initial_clubs["clubs"][0], "name": "DC Heim e.V. e.V."}, CLUBS["clubs"][1]]}
    changed = _publication(
        leagues,
        renamed_clubs,
        previous_state=_state(original),
        updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    original_state = _state(original)
    changed_state = _state(changed)
    assert changed.updated_at == datetime(2026, 8, 20, tzinfo=timezone.utc)
    assert changed_state["index_fingerprint"] != original_state["index_fingerprint"]
    assert [event["sequence"] for event in changed_state["events"]] == [
        event["sequence"] for event in original_state["events"]
    ]

    repeated = _publication(
        leagues,
        renamed_clubs,
        previous_state=changed_state,
        updated_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
    )
    assert repeated.calendar_index_json == changed.calendar_index_json
    assert repeated.calendar_state_json == changed.calendar_state_json


@pytest.mark.parametrize(
    "feed",
    [
        b"BEGIN:VCALENDAR\r\nX:A\rB\r\nEND:VCALENDAR\r\n",
        b"BEGIN:VCALENDAR\r\nUID;VALUE=TEXT:a\r\nuid:a\r\nEND:VCALENDAR\r\n",
    ],
)
def test_writer_rejects_bare_cr_and_parameterized_case_variant_duplicate_uids(feed: bytes) -> None:
    publication = replace(_publication(_one_fixture()), calendars={"club-101-team-1": feed})
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(publication, output)
        assert not output.exists()


@pytest.mark.parametrize("invalid_version", [True, 1.0, 2.0, "2"])
def test_previous_state_rejects_non_integer_schema_versions(invalid_version: object) -> None:
    state = _state(_publication(_one_fixture()))
    state["schema_version"] = invalid_version

    with pytest.raises(CalendarSourceError, match="State-Schema"):
        _publication(_one_fixture(), previous_state=state)


def test_v1_state_is_rejected_while_integer_v2_remains_a_noop() -> None:
    publication = _publication(_one_fixture())
    legacy = _state(publication)
    legacy["schema_version"] = 1
    del legacy["index_fingerprint"]

    with pytest.raises(CalendarSourceError, match="State-Schema"):
        _publication(_one_fixture(), previous_state=legacy)

    repeated = _publication(_one_fixture(), previous_state=_state(publication))
    assert repeated.calendar_state_json == publication.calendar_state_json


@pytest.mark.parametrize("mutation", ["missing", "extra", "state_feed_mismatch"])
def test_writer_rejects_cross_artifact_feed_inconsistency_before_output(mutation: str) -> None:
    publication = _publication(_one_fixture())
    feeds = dict(publication.calendars)
    if mutation == "missing":
        feeds.pop("club-202-team-1")
    elif mutation == "extra":
        feeds["club-999-team-1"] = feeds["club-101-team-1"]
    else:
        feeds["club-101-team-1"] = feeds["club-202-team-1"]
    invalid = replace(publication, calendars=feeds)
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(invalid, output)
        assert not output.exists()


@pytest.mark.parametrize(
    "feed",
    [
        b"BEGIN:VCALENDAR\r\nGARBAGE\r\nEND:VCALENDAR\r\n",
        b"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSTATUS:CONFIRMED\r\nEND:VCALENDAR\r\n",
    ],
)
def test_writer_rejects_invalid_ics_logical_component_grammar(feed: bytes) -> None:
    invalid = replace(_publication(_one_fixture()), calendars={"club-101-team-1": feed})
    with tempfile.TemporaryDirectory() as temporary_directory:
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(invalid, Path(temporary_directory) / "output")


@pytest.mark.parametrize(
    "old,new",
    [
        (b"DTSTART:20261030T190000Z", b"DTSTART:20261030T190100Z"),
        (b"SEQUENCE:0", b"SEQUENCE:9"),
        (b"SUMMARY:Heimspiel gegen DC Gast", b"SUMMARY:Manipuliert"),
        (b"LOCATION:Heimspielst", b"LOCATION:Fremdspielst"),
    ],
)
def test_writer_rejects_any_state_feed_content_drift_before_output(old: bytes, new: bytes) -> None:
    publication = _publication(_one_fixture())
    feeds = dict(publication.calendars)
    feeds["club-101-team-1"] = feeds["club-101-team-1"].replace(old, new, 1)
    invalid = replace(publication, calendars=feeds)
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(invalid, output)
        assert not output.exists()


@pytest.mark.parametrize(
    "line",
    [
        b"X;BAD PARAM=value:test",
        b"X;=value:test",
        b"X;P=:test",
        b"X;;P=value:test",
    ],
)
def test_writer_rejects_invalid_content_line_parameter_grammar(line: bytes) -> None:
    feed = b"BEGIN:VCALENDAR\r\n" + line + b"\r\nEND:VCALENDAR\r\n"
    invalid = replace(_publication(_one_fixture()), calendars={"club-101-team-1": feed})
    with tempfile.TemporaryDirectory() as temporary_directory:
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(invalid, Path(temporary_directory) / "output")


def test_writer_wraps_preflight_resolve_oserror(monkeypatch: pytest.MonkeyPatch) -> None:
    publication = _publication(_one_fixture())
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "output"
        (output / "calendars").mkdir(parents=True)
        original_resolve = Path.resolve

        def fail_calendar_resolve(path: Path, *args: object, **kwargs: object) -> Path:
            if path.name == "calendars":
                raise OSError("blocked")
            return original_resolve(path, *args, **kwargs)

        monkeypatch.setattr(Path, "resolve", fail_calendar_resolve)
        with pytest.raises(CalendarSourceError):
            write_calendar_publication(publication, output)


def test_writer_and_cli_wrap_output_path_absolute_oserror(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    publication = _publication(_one_fixture())

    def fail_absolute(_: Path) -> Path:
        raise OSError("absolute blocked")

    monkeypatch.setattr(Path, "absolute", fail_absolute)
    with pytest.raises(CalendarSourceError):
        write_calendar_publication(publication, Path("relative-output"))

    league_path = tmp_path / "league.json"
    club_path = tmp_path / "clubs.json"
    league_path.write_text(json.dumps(_one_fixture()), encoding="utf-8")
    club_path.write_text(json.dumps(CLUBS), encoding="utf-8")
    with pytest.raises(SystemExit) as exit_code:
        main(
            [
                "--league-json", str(league_path), "--club-json", str(club_path),
                "--output-dir", "relative-output", "--updated-at", "2026-08-19T10:15:00Z",
            ]
        )
    assert exit_code.value.code != 0
    assert "Traceback" not in capsys.readouterr().err


def test_index_js_writer_and_cli_are_deterministic_and_explicit() -> None:
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "3. Spieltag": "Fr. 30. 10.2026 20:00 DC Gast - DC Heim ---\n",
                    "4. Spieltag": "Sa. 31. 10.2026 20:00 DC Heim - DC Gast ---\n",
                }
            }
        }
    }
    publication = _publication(
        leagues
    )
    index = json.loads(publication.calendar_index_json)
    assert index["schema_version"] == 1
    assert list(index["teams"]) == sorted(index["teams"])
    assert publication.calendar_index_js.startswith(b"window.BWEDL_CALENDAR_INDEX = ")
    assert b"function" not in publication.calendar_index_js
    assert json.loads(publication.calendar_index_js.split(b"= ", 1)[1].rstrip(b";\n")) == index

    with tempfile.TemporaryDirectory() as temporary_directory:
        tmp_path = Path(temporary_directory)
        output = tmp_path / "output"
        write_calendar_publication(publication, output)
        assert (output / "calendar_index.json").read_bytes() == publication.calendar_index_json
        assert (output / "calendar_index.js").read_bytes() == publication.calendar_index_js
        assert (output / "calendar_state.json").read_bytes() == publication.calendar_state_json
        assert (output / "calendars" / "club-101-team-1.ics").is_file()
        assert not (tmp_path / "calendars").exists()

        league_path = tmp_path / "league.json"
        club_path = tmp_path / "club.json"
        cli_output = tmp_path / "cli-output"
        league_path.write_text(json.dumps(_one_fixture()), encoding="utf-8")
        club_path.write_text(json.dumps(CLUBS), encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                "pipeline/calendar_feeds.py",
                "--league-json",
                str(league_path),
                "--club-json",
                str(club_path),
                "--output-dir",
                str(cli_output),
                "--updated-at",
                "2026-08-19T10:15:00+00:00",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert (cli_output / "calendar_state.json").is_file()
