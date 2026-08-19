"""Parse regular BWEDL fixtures and publish validated stateful team calendars.

The parser remains pure; the explicit writer and CLI own the only file I/O.
"""

from __future__ import annotations

from collections.abc import Mapping
import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from types import MappingProxyType
import unicodedata
from typing import Any
from zoneinfo import ZoneInfo


BERLIN = ZoneInfo("Europe/Berlin")
_LEGAL_FORM_SUFFIX = " e v"
_BYE_NAMES = {"spielfrei", "bye", "freilos", "freilose"}
_SEASON_RE = re.compile(r"(?P<season>\d{4}-\d{4})")
_ASCII_CLUB_NUMBER_RE = re.compile(r"[0-9]+")
_DATE_PREFIX_RE = re.compile(
    r"^(?:\S+\.\s+)?(?P<day>\d{1,2})\.\s*(?P<month>\d{1,2})\."
    r"(?P<year>\d{2,4})(?:\s+(?P<hour>\d{1,2}):(?P<minute>\d{2}))?\s+"
    r"(?P<teams>.+?)\s*$"
)
_SCORE_SUFFIX_RE = re.compile(r"\s+(?:---|\d+\s*:\s*\d+|:)\s*$")
_TEAM_SEPARATOR_RE = re.compile(r"^(?P<home>.+?)\s+-\s+(?P<away>.+?)\s*$")
_SAFE_TEAM_ID_RE = re.compile(r"club-([0-9]+)-team-([0-9]+)\Z")
_STATE_SCHEMA_VERSION = 2
_INDEX_SCHEMA_VERSION = 1
_UID_DOMAIN = "calendar.bwedl.invalid"

# These are source spelling variants observed in BWEDL's own club and fixture
# exports. They are a closed, explicit alias list; matching never guesses.
_KNOWN_CLUB_ALIASES = {
    "dc mephisto s": "DC Mephistos",
    "dc strikers": "DC Striker´s",
    "dc underground fools": "DC Underground Fool´s e.V.",
    "dc lightning arrows": "DC Lightning Arrows",
    "dc ligthning arrows": "DC Lightning Arrows",
    "heavy weights brotzingen": "Heavy Weigths Brötzingen",
    "alla haeeehr": "Alla Häeeeehr",
}


class CalendarSourceError(ValueError):
    """Raised when a source fixture cannot describe one unambiguous schedule."""


@dataclass(frozen=True)
class CalendarPublication:
    """All deterministic, public artifacts for one calendar publication run."""

    season: str | None
    updated_at: datetime
    calendar_index_json: bytes
    calendar_index_js: bytes
    calendar_state_json: bytes
    calendars: Mapping[str, bytes]


def normalize_team_name(value: str) -> str:
    """Return the JavaScript-compatible key used for exact team resolution."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(
        character
        for character in decomposed
        if not unicodedata.category(character).startswith("M")
    )
    lowered = without_marks.lower().replace("ß", "ss")
    words = "".join(
        character if "a" <= character <= "z" or "0" <= character <= "9" else " "
        for character in lowered
    )
    return " ".join(words.split())


@dataclass(frozen=True)
class Club:
    number: str
    name: str
    venue: str
    street: str
    city: str


@dataclass(frozen=True)
class TeamIdentity:
    name: str
    normalized_name: str
    team_id: str
    club_number: str | None = None
    club_name: str | None = None


@dataclass(frozen=True)
class HomeLocation:
    venue: str
    street: str
    city: str
    address: str
    incomplete: bool


@dataclass(frozen=True)
class LeagueGame:
    season: str
    league: str
    round_name: str
    home: TeamIdentity
    away: TeamIdentity
    starts_at_utc: datetime
    location: HomeLocation | None
    location_status: str


@dataclass(frozen=True)
class FixtureSourceLine:
    """One non-empty regular source line and its explicit parser outcome."""

    season: str
    league: str
    round_name: str
    text: str
    classification: str
    starts_at_utc: datetime | None = None
    home_name: str | None = None
    away_name: str | None = None


@dataclass(frozen=True)
class ClubCatalog:
    """An immutable, exact-match club index derived from raw club records."""

    clubs_by_number: Mapping[str, Club]
    clubs_by_alias: Mapping[str, tuple[Club, ...]]

    def resolve_team(self, team_name: str) -> TeamIdentity | None:
        normalized = normalize_team_name(team_name)
        candidates: list[tuple[Club, int]] = []
        for alias, clubs in self.clubs_by_alias.items():
            if normalized == alias:
                candidates.extend((club, 1) for club in clubs)
                continue
            prefix = f"{alias} "
            suffix = normalized.removeprefix(prefix)
            if normalized.startswith(prefix) and suffix.isdigit() and int(suffix) > 0:
                candidates.extend((club, int(suffix)) for club in clubs)

        distinct = {(club.number, slot): club for club, slot in candidates}
        if len(distinct) != 1:
            return None
        (number, slot), club = next(iter(distinct.items()))
        return TeamIdentity(
            name=team_name,
            normalized_name=normalized,
            team_id=f"club-{number}-team-{slot}",
            club_number=number,
            club_name=club.name,
        )

    def club_for(self, team: TeamIdentity) -> Club | None:
        return self.clubs_by_number.get(team.club_number or "")


def build_club_catalog(club_data: Mapping[str, Any]) -> ClubCatalog:
    """Build the strict club/alias index from a decoded ``club_data.json`` object."""
    raw_clubs = club_data.get("clubs", [])
    if not isinstance(raw_clubs, list):
        raise CalendarSourceError("Vereinsdaten: clubs muss eine Liste sein")

    clubs: list[Club] = []
    club_names_by_number: dict[str, str] = {}
    for record in raw_clubs:
        if not isinstance(record, Mapping):
            raise CalendarSourceError("Vereinsdaten: Club-Eintrag muss ein Objekt sein")
        raw_number = record.get("number")
        number = _source_text(raw_number)
        name = _source_text(record.get("name"))
        if not isinstance(raw_number, str) or _ASCII_CLUB_NUMBER_RE.fullmatch(number) is None:
            raise CalendarSourceError(
                f"Ungültige Vereinsnummer für {name or 'unbekannten Verein'}: {raw_number!r}"
            )
        if not name:
            continue
        previous_name = club_names_by_number.get(number)
        if previous_name is not None:
            raise CalendarSourceError(
                f"Doppelte Vereinsnummer {number}: {previous_name} und {name}"
            )
        club_names_by_number[number] = name
        clubs.append(
            Club(
                number=number,
                name=name,
                venue=_source_text(record.get("venue")),
                street=_source_text(record.get("street")),
                city=_source_text(record.get("city")),
            )
        )

    clubs_by_number: dict[str, Club] = {}
    aliases: dict[str, list[Club]] = {}
    for club in clubs:
        clubs_by_number[club.number] = club
        for alias in _club_aliases(club):
            aliases.setdefault(alias, []).append(club)

    return ClubCatalog(
        clubs_by_number=MappingProxyType(clubs_by_number),
        clubs_by_alias=MappingProxyType(
            {alias: tuple(alias_clubs) for alias, alias_clubs in aliases.items()}
        ),
    )


def parse_regular_league_games(
    league_data: Mapping[str, Any], club_data: Mapping[str, Any]
) -> list[LeagueGame]:
    """Parse all regular league games, rejecting source duplicates deterministically."""
    catalog = build_club_catalog(club_data)
    games: list[LeagueGame] = []
    fixture_keys: set[tuple[str, str, str, str]] = set()
    team_rounds: set[tuple[str, str, str]] = set()

    for source_line in classify_regular_league_source_lines(league_data):
        if source_line.classification != "game":
            continue
        assert source_line.starts_at_utc is not None
        assert source_line.home_name is not None
        assert source_line.away_name is not None
        home = _resolve_or_fallback(catalog, source_line.home_name)
        away = _resolve_or_fallback(catalog, source_line.away_name)
        fixture_key = (
            source_line.league,
            source_line.round_name,
            home.normalized_name,
            away.normalized_name,
        )
        if fixture_key in fixture_keys:
            raise CalendarSourceError(
                f"Doppelter Eintrag in {source_line.league}, {source_line.round_name}: "
                f"{source_line.home_name} - {source_line.away_name}"
            )
        fixture_keys.add(fixture_key)

        for team in (home, away):
            round_key = (source_line.league, source_line.round_name, team.team_id)
            if round_key in team_rounds:
                raise CalendarSourceError(
                    f"Mehrere Begegnungen für {team.name} in "
                    f"{source_line.league}, {source_line.round_name}"
                )
            team_rounds.add(round_key)

        location, location_status = _home_location(catalog, home)
        games.append(
            LeagueGame(
                season=source_line.season,
                league=source_line.league,
                round_name=source_line.round_name,
                home=home,
                away=away,
                starts_at_utc=source_line.starts_at_utc,
                location=location,
                location_status=location_status,
            )
        )
    return games


def _club_aliases(club: Club) -> set[str]:
    canonical = normalize_team_name(club.name)
    aliases = {canonical}
    if canonical.endswith(_LEGAL_FORM_SUFFIX):
        aliases.add(canonical[: -len(_LEGAL_FORM_SUFFIX)])
    for known_alias, canonical_name in _KNOWN_CLUB_ALIASES.items():
        if normalize_team_name(canonical_name) == canonical:
            aliases.add(known_alias)
    return aliases


def _season_for(league: str) -> str:
    match = _SEASON_RE.search(league)
    if match is None:
        raise CalendarSourceError(f"Saison nicht aus Liga ableitbar: {league}")
    return match.group("season")


def classify_regular_league_source_lines(
    league_data: Mapping[str, Any],
) -> list[FixtureSourceLine]:
    """Classify every non-empty regular source line or raise a source error."""
    if not isinstance(league_data, Mapping):
        raise CalendarSourceError("Ligadaten müssen ein Objekt sein")
    leagues = league_data.get("leagues")
    if not isinstance(leagues, Mapping):
        raise CalendarSourceError("Ligadaten: leagues muss ein Objekt sein")

    classified: list[FixtureSourceLine] = []
    for league, league_record in leagues.items():
        if not isinstance(league, str) or not league.strip():
            raise CalendarSourceError("Ligadaten: Liganame muss ein nichtleerer Text sein")
        if "ligapokal" in league.casefold():
            continue
        season = _season_for(league)
        if not isinstance(league_record, Mapping):
            raise CalendarSourceError(f"Liga {league}: Eintrag muss ein Objekt sein")
        if "match_days" not in league_record:
            raise CalendarSourceError(f"Liga {league}: match_days fehlt")
        match_days = league_record["match_days"]
        if not isinstance(match_days, Mapping):
            raise CalendarSourceError(f"Liga {league}: match_days muss ein Objekt sein")
        for round_name, fixture_text in match_days.items():
            if not isinstance(round_name, str) or not round_name.strip():
                raise CalendarSourceError(f"Liga {league}: ungültige Runde {round_name!r}")
            if not isinstance(fixture_text, str):
                raise CalendarSourceError(
                    f"Liga {league}, {round_name}: Spielplantext muss Text sein"
                )
            if not fixture_text.strip():
                raise CalendarSourceError(
                    f"Liga {league}, {round_name}: Spielplantext darf nicht leer sein"
                )
            for line in fixture_text.splitlines():
                if not line.strip():
                    continue
                classified.append(_classify_fixture_line(league, season, round_name, line))
    return classified


def _classify_fixture_line(
    league: str, season: str, round_name: str, line: str
) -> FixtureSourceLine:
    match = _DATE_PREFIX_RE.match(line.strip())
    if not match:
        raise CalendarSourceError(
            f"Liga {league}, {round_name}: nicht klassifizierbare Spielplanzeile {line!r}"
        )
    teams = _SCORE_SUFFIX_RE.sub("", match.group("teams"))
    team_match = _TEAM_SEPARATOR_RE.match(teams)
    if not team_match:
        raise CalendarSourceError(
            f"Liga {league}, {round_name}: nicht klassifizierbare Spielplanzeile {line!r}"
        )
    home_name = team_match.group("home").strip()
    away_name = team_match.group("away").strip()
    if not home_name or not away_name:
        raise CalendarSourceError(
            f"Liga {league}, {round_name}: nicht klassifizierbare Spielplanzeile {line!r}"
        )
    common = {
        "season": season,
        "league": league,
        "round_name": round_name,
        "text": line,
        "home_name": home_name,
        "away_name": away_name,
    }
    if _is_bye(home_name) or _is_bye(away_name):
        return FixtureSourceLine(classification="bye", **common)
    if match.group("hour") is None:
        return FixtureSourceLine(classification="missing_time", **common)
    year = int(match.group("year"))
    if year < 100:
        year += 2000
    starts_at_utc = _unambiguous_berlin_time_or_none(
        year,
        int(match.group("month")),
        int(match.group("day")),
        int(match.group("hour")),
        int(match.group("minute")),
    )
    if starts_at_utc is None:
        return FixtureSourceLine(classification="invalid_time", **common)
    return FixtureSourceLine(
        classification="game", starts_at_utc=starts_at_utc, **common
    )


def _is_bye(team_name: str) -> bool:
    return normalize_team_name(team_name) in _BYE_NAMES


def _resolve_or_fallback(catalog: ClubCatalog, team_name: str) -> TeamIdentity:
    resolved = catalog.resolve_team(team_name)
    if resolved is not None:
        return resolved
    normalized = normalize_team_name(team_name)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return TeamIdentity(
        name=team_name,
        normalized_name=normalized,
        team_id=f"team-{digest}",
    )


def _home_location(
    catalog: ClubCatalog, home: TeamIdentity
) -> tuple[HomeLocation | None, str]:
    club = catalog.club_for(home)
    if club is None:
        return None, "Austragungsort nicht auflösbar"
    parts = [part for part in (club.venue, club.street, club.city) if part]
    if not parts:
        return None, "Austragungsort unvollständig"
    return (
        HomeLocation(
            venue=club.venue,
            street=club.street,
            city=club.city,
            address=", ".join(parts),
            incomplete=not all((club.venue, club.street, club.city)),
        ),
        "Austragungsort vollständig"
        if all((club.venue, club.street, club.city))
        else "Austragungsort unvollständig",
    )


def _source_text(value: Any) -> str:
    """Keep actual non-placeholder source text; null and blanks stay empty."""
    if not isinstance(value, str):
        return ""
    text = value.strip()
    return "" if text == "-" else text


def _unambiguous_berlin_time_or_none(
    year: int, month: int, day: int, hour: int, minute: int
) -> datetime | None:
    """Return UTC only when both local folds round-trip to one instant."""
    try:
        wall_time = datetime(year, month, day, hour, minute)
    except ValueError:
        return None
    utc_instants = []
    for fold in (0, 1):
        local = wall_time.replace(tzinfo=BERLIN, fold=fold)
        utc_value = local.astimezone(timezone.utc)
        round_trip = utc_value.astimezone(BERLIN).replace(tzinfo=None)
        if round_trip != wall_time:
            return None
        utc_instants.append(utc_value)
    if utc_instants[0] != utc_instants[1]:
        return None
    return utc_instants[0]


def build_calendar_publication(
    league_data: Mapping[str, Any],
    club_data: Mapping[str, Any],
    *,
    previous_state: Mapping[str, Any] | None = None,
    updated_at: datetime,
) -> CalendarPublication:
    """Create deterministic team feeds from parsed regular-league fixtures.

    The source decides which season is current: exactly one season may occur in
    non-cup league names.  An empty source publishes no season; a source with
    several seasons is rejected rather than guessing which one is authoritative.
    """
    authoritative_updated_at = _require_aware_utc(updated_at, "updated_at")
    prior = _validate_previous_state(previous_state) if previous_state is not None else None
    source_lines = classify_regular_league_source_lines(league_data)
    season = _single_current_season(league_data, source_lines)
    catalog = build_club_catalog(club_data)
    games = parse_regular_league_games(league_data, club_data)
    if season is not None and any(game.season != season for game in games):
        raise CalendarSourceError("Spielplandaten enthalten keine eindeutige aktuelle Saison")

    active: dict[str, dict[str, Any]] = {}
    for game in games:
        for team, opponent, is_home in (
            (game.home, game.away, True),
            (game.away, game.home, False),
        ):
            if _SAFE_TEAM_ID_RE.fullmatch(team.team_id) is None:
                continue
            event = _active_event_record(game, team, opponent, is_home)
            uid = event["uid"]
            if uid in active:
                raise CalendarSourceError(
                    f"Mehrere Kalenderereignisse für {team.team_id}, "
                    f"{game.league}, {game.round_name}"
                )
            active[uid] = event

    if prior is not None and prior["season"] != season:
        # A season change is a replacement of the feed, never a bulk cancellation.
        prior = None

    previous_events = {} if prior is None else {event["uid"]: event for event in prior["events"]}
    state_events: list[dict[str, Any]] = []
    for uid in sorted(active):
        candidate = active[uid]
        previous = previous_events.pop(uid, None)
        if previous is not None and previous["fingerprint"] == candidate["fingerprint"]:
            candidate["sequence"] = previous["sequence"]
            candidate["last_modified"] = previous["last_modified"]
        elif previous is None:
            candidate["sequence"] = 0
            candidate["last_modified"] = _canonical_timestamp(authoritative_updated_at)
        else:
            candidate["sequence"] = previous["sequence"] + 1
            candidate["last_modified"] = _canonical_timestamp(authoritative_updated_at)
        state_events.append(candidate)

    if season is not None:
        for previous in previous_events.values():
            if previous["status"] == "CANCELLED":
                state_events.append(dict(previous))
                continue
            cancelled = dict(previous)
            cancelled["status"] = "CANCELLED"
            cancelled["fingerprint"] = _event_fingerprint(cancelled)
            cancelled["sequence"] = previous["sequence"] + 1
            cancelled["last_modified"] = _canonical_timestamp(authoritative_updated_at)
            state_events.append(cancelled)

    state_events.sort(key=lambda event: event["uid"])
    provisional_index = _build_calendar_index(
        season, authoritative_updated_at, state_events, catalog
    )
    index_fingerprint = _index_fingerprint(provisional_index)
    if (
        prior is not None
        and state_events == prior["events"]
        and prior["index_fingerprint"] == index_fingerprint
    ):
        publication_updated_at = _parse_state_timestamp(prior["updated_at"], "State updated_at")
    else:
        publication_updated_at = authoritative_updated_at

    state = {
        "schema_version": _STATE_SCHEMA_VERSION,
        "season": season,
        "updated_at": _canonical_timestamp(publication_updated_at),
        "events": state_events,
        "index_fingerprint": index_fingerprint,
    }
    index = _build_calendar_index(
        season, publication_updated_at, state_events, catalog
    )
    calendars = _render_calendars(state_events)
    index_json = _json_bytes(index)
    return CalendarPublication(
        season=season,
        updated_at=publication_updated_at,
        calendar_index_json=index_json,
        calendar_index_js=b"window.BWEDL_CALENDAR_INDEX = " + index_json.rstrip(b"\n") + b";\n",
        calendar_state_json=_json_bytes(state),
        calendars=MappingProxyType(calendars),
    )


def write_calendar_publication(publication: CalendarPublication, output_dir: str | Path) -> None:
    """Write only validated, publication-owned paths below an explicit directory."""
    _validate_calendar_publication(publication)
    root = _preflight_output_root(Path(output_dir))
    calendars_dir = root / "calendars"
    artifacts = {
        root / "calendar_index.json": publication.calendar_index_json,
        root / "calendar_index.js": publication.calendar_index_js,
        root / "calendar_state.json": publication.calendar_state_json,
    }
    expected_names = {f"{team_id}.ics" for team_id in publication.calendars}
    artifacts.update(
        {calendars_dir / f"{team_id}.ics": contents for team_id, contents in publication.calendars.items()}
    )
    existing_feeds = _preflight_existing_output(root, calendars_dir, artifacts)

    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise CalendarSourceError("Output-Verzeichnis kann nicht angelegt werden") from error
    root = root.resolve(strict=True)
    calendars_dir = root / "calendars"
    try:
        calendars_dir.mkdir(exist_ok=True)
    except OSError as error:
        raise CalendarSourceError("Kalender-Verzeichnis kann nicht angelegt werden") from error
    calendars_dir = calendars_dir.resolve(strict=True)
    _ensure_within(root, calendars_dir)

    for path, contents in artifacts.items():
        _write_bytes_safely(path, contents)

    for existing in existing_feeds:
        if existing.name in expected_names:
            continue
        try:
            existing.unlink()
        except OSError as error:
            raise CalendarSourceError("Veralteter Kalender kann nicht entfernt werden") from error


def _single_current_season(
    league_data: Mapping[str, Any], source_lines: list[FixtureSourceLine]
) -> str | None:
    del source_lines  # Classification above validates the complete source structure.
    leagues = league_data.get("leagues")
    if not isinstance(leagues, Mapping):
        raise CalendarSourceError("Ligadaten: leagues muss ein Objekt sein")
    seasons = {
        _season_for(league)
        for league in leagues
        if isinstance(league, str) and "ligapokal" not in league.casefold()
    }
    if len(seasons) > 1:
        raise CalendarSourceError("Mehrere aktuelle Saisons in den Spielplandaten")
    return next(iter(seasons), None)


def _active_event_record(
    game: LeagueGame, team: TeamIdentity, opponent: TeamIdentity, is_home: bool
) -> dict[str, Any]:
    location = game.location.address if game.location is not None else None
    warning = (
        "Adresse unvollständig"
        if game.location is not None and game.location.incomplete
        else "Austragungsort nicht auflösbar"
        if game.location is None
        else None
    )
    event = {
        "uid": _event_uid(game.season, game.league, game.round_name, team.team_id),
        "season": game.season,
        "league": game.league,
        "round_name": game.round_name,
        "team_id": team.team_id,
        "team_name": team.name,
        "opponent": opponent.name,
        "home_team": game.home.name,
        "away_team": game.away.name,
        "is_home": is_home,
        "starts_at": _canonical_timestamp(game.starts_at_utc),
        "location": location,
        "location_warning": warning,
        "status": "CONFIRMED",
    }
    event["fingerprint"] = _event_fingerprint(event)
    return event


def _event_uid(season: str, league: str, round_name: str, team_id: str) -> str:
    payload = "\x1f".join((season, league, round_name, team_id)).encode("utf-8")
    return f"{hashlib.sha256(payload).hexdigest()}@{_UID_DOMAIN}"


def _event_fingerprint(event: Mapping[str, Any]) -> str:
    contents = {
        key: event[key]
        for key in (
            "uid",
            "season",
            "league",
            "round_name",
            "team_id",
            "team_name",
            "opponent",
            "home_team",
            "away_team",
            "is_home",
            "starts_at",
            "location",
            "location_warning",
            "status",
        )
    }
    return hashlib.sha256(_json_bytes(contents)).hexdigest()


def _build_calendar_index(
    season: str | None,
    updated_at: datetime,
    events: list[dict[str, Any]],
    catalog: ClubCatalog,
) -> dict[str, Any]:
    by_team: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        by_team.setdefault(event["team_id"], []).append(event)
    teams: dict[str, dict[str, Any]] = {}
    for team_id, team_events in sorted(by_team.items()):
        match = _SAFE_TEAM_ID_RE.fullmatch(team_id)
        if match is None:
            raise CalendarSourceError(f"Ungültige Team-ID im Kalender: {team_id!r}")
        preferred = next(
            (event for event in team_events if event["status"] == "CONFIRMED"),
            team_events[0],
        )
        entry = {
            "name": preferred["team_name"],
            "path": f"calendars/{team_id}.ics",
            "team_id": team_id,
            "club_number": match.group(1),
            "team_slot": int(match.group(2)),
            "warning_count": sum(
                event["location_warning"] is not None for event in team_events
            ),
        }
        for key in _team_index_keys_for_events(tuple(team_events), catalog):
            existing = teams.get(key)
            if existing is not None and existing["team_id"] != team_id:
                raise CalendarSourceError(
                    f"Mehrdeutiger Kalenderindex für {key}: "
                    f"{existing['team_id']} und {team_id}"
                )
            teams[key] = entry
    return {
        "schema_version": _INDEX_SCHEMA_VERSION,
        "season": season,
        "updated_at": _canonical_timestamp(updated_at),
        "teams": {key: teams[key] for key in sorted(teams)},
    }


def _team_index_keys(event: Mapping[str, Any], catalog: ClubCatalog) -> set[str]:
    return _team_index_keys_for_events((event,), catalog)


def _team_index_keys_for_events(
    events: tuple[Mapping[str, Any], ...], catalog: ClubCatalog
) -> set[str]:
    keys = {normalize_team_name(event["team_name"]) for event in events}
    event = events[0]
    match = _SAFE_TEAM_ID_RE.fullmatch(event["team_id"])
    assert match is not None
    club = catalog.clubs_by_number.get(match.group(1))
    if club is None:
        return keys
    slot = int(match.group(2))
    for alias in _club_aliases(club):
        keys.add(f"{alias} {slot}")
        if slot == 1:
            keys.add(alias)
    return keys


def _index_fingerprint(index: Mapping[str, Any]) -> str:
    identity = {key: value for key, value in index.items() if key != "updated_at"}
    return hashlib.sha256(_json_bytes(identity)).hexdigest()


def _render_calendars(events: list[dict[str, Any]]) -> dict[str, bytes]:
    by_team: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        _validate_team_id(event["team_id"])
        by_team.setdefault(event["team_id"], []).append(event)
    return {
        team_id: _render_calendar(team_events[0]["team_name"], sorted(team_events, key=lambda item: item["uid"]))
        for team_id, team_events in sorted(by_team.items())
    }


def _render_calendar(team_name: str, events: list[dict[str, Any]]) -> bytes:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//BWEDL//Team Calendar//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        _content_line("X-WR-CALNAME", f"BWEDL – {team_name}", text=True),
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
        "X-PUBLISHED-TTL:PT6H",
    ]
    for event in events:
        lines.extend(_render_event(event))
    lines.append("END:VCALENDAR")
    return _fold_ical_lines(lines).encode("utf-8")


def _render_event(event: Mapping[str, Any]) -> list[str]:
    starts_at = _parse_state_timestamp(event["starts_at"], "Event starts_at")
    ends_at = starts_at + timedelta(hours=3)
    last_modified = _parse_state_timestamp(event["last_modified"], "Event last_modified")
    home_or_away = "Heimspiel" if event["is_home"] else "Auswärtsspiel"
    summary = (
        f"Heimspiel gegen {event['opponent']}"
        if event["is_home"]
        else f"Auswärtsspiel bei {event['opponent']}"
    )
    description = [
        f"Begegnung: {event['home_team']} - {event['away_team']}",
        home_or_away,
        f"Liga: {event['league']}",
        f"Spieltag: {event['round_name']}",
        f"Termin: {starts_at.strftime('%d.%m.%Y %H:%M UTC')}",
    ]
    if event["location"] is not None:
        description.append(f"Austragungsort: {event['location']}")
    if event["location_warning"] is not None:
        description.append(event["location_warning"])
    lines = [
        "BEGIN:VEVENT",
        _content_line("UID", event["uid"], text=True),
        _content_line("DTSTAMP", _ical_timestamp(last_modified)),
        _content_line("DTSTART", _ical_timestamp(starts_at)),
        _content_line("DTEND", _ical_timestamp(ends_at)),
        _content_line("SUMMARY", summary, text=True),
        _content_line("DESCRIPTION", "\n".join(description), text=True),
    ]
    if event["location"] is not None:
        lines.append(_content_line("LOCATION", event["location"], text=True))
    lines.extend(
        (
            _content_line("SEQUENCE", str(event["sequence"])),
            _content_line("LAST-MODIFIED", _ical_timestamp(last_modified)),
        )
    )
    lines.append(f"STATUS:{event['status']}")
    lines.append("END:VEVENT")
    return lines


def _content_line(name: str, value: str, *, text: bool = False) -> str:
    return f"{name}:{_escape_text(value) if text else value}"


def _escape_text(value: str) -> str:
    value = "".join(
        character
        for character in value
        if character in "\r\n" or not (ord(character) < 32 or 127 <= ord(character) <= 159)
    )
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold_ical_lines(lines: list[str]) -> str:
    physical_lines: list[str] = []
    for line in lines:
        remaining = line
        first = True
        while remaining:
            limit = 75 if first else 74
            current: list[str] = []
            used = 0
            index = 0
            for index, character in enumerate(remaining):
                size = len(character.encode("utf-8"))
                if used + size > limit:
                    break
                current.append(character)
                used += size
            else:
                index = len(remaining)
            if not current:
                raise CalendarSourceError("ICS-Zeile enthält ein nicht faltbares Zeichen")
            physical_lines.append(("" if first else " ") + "".join(current))
            remaining = remaining[index:]
            first = False
    return "\r\n".join(physical_lines) + "\r\n"


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _canonical_timestamp(value: datetime) -> str:
    return _require_aware_utc(value, "Zeitstempel").isoformat(timespec="seconds").replace("+00:00", "Z")


def _ical_timestamp(value: datetime) -> str:
    return _require_aware_utc(value, "ICS-Zeitstempel").strftime("%Y%m%dT%H%M%SZ")


def _require_aware_utc(value: datetime, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise CalendarSourceError(f"{label} muss timezone-aware sein")
    return value.astimezone(timezone.utc)


def _parse_state_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        raise CalendarSourceError(f"{label} muss ein UTC-Zeitstempel sein")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CalendarSourceError(f"{label} ist ungültig") from error
    parsed = _require_aware_utc(parsed, label)
    if _canonical_timestamp(parsed) != value:
        raise CalendarSourceError(f"{label} muss kanonisches UTC-Format verwenden")
    return parsed


def _parse_authoritative_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        raise CalendarSourceError(f"{label} muss ein UTC-Zeitstempel sein")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CalendarSourceError(f"{label} ist ungültig") from error
    return _require_aware_utc(parsed, label)


def _validate_previous_state(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise CalendarSourceError("State muss ein Objekt sein")
    version = value.get("schema_version")
    expected = {"schema_version", "season", "updated_at", "events", "index_fingerprint"}
    legacy_expected = expected - {"index_fingerprint"}
    if version not in {1, _STATE_SCHEMA_VERSION} or (
        set(value) != expected and set(value) != legacy_expected
    ):
        raise CalendarSourceError("State-Schema ist inkompatibel")
    index_fingerprint = value.get("index_fingerprint")
    if version == _STATE_SCHEMA_VERSION:
        if set(value) != expected or not isinstance(index_fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", index_fingerprint):
            raise CalendarSourceError("State Indexidentität ist ungültig")
    elif set(value) != legacy_expected:
        raise CalendarSourceError("Legacy-State-Schema ist inkompatibel")
    season = value["season"]
    if season is not None and not isinstance(season, str):
        raise CalendarSourceError("State season ist ungültig")
    _parse_state_timestamp(value["updated_at"], "State updated_at")
    events = value["events"]
    if not isinstance(events, list):
        raise CalendarSourceError("State events muss eine Liste sein")
    normalized: list[dict[str, Any]] = []
    event_keys = {
        "uid", "season", "league", "round_name", "team_id", "team_name", "opponent", "is_home",
        "home_team", "away_team",
        "starts_at", "location", "location_warning", "status", "fingerprint", "sequence", "last_modified",
    }
    seen: set[str] = set()
    for event in events:
        if not isinstance(event, Mapping) or set(event) != event_keys:
            raise CalendarSourceError("State Event-Schema ist inkompatibel")
        item = dict(event)
        string_keys = ("uid", "season", "league", "round_name", "team_id", "team_name", "opponent", "home_team", "away_team", "fingerprint", "last_modified", "starts_at")
        if any(not isinstance(item[key], str) or not item[key] for key in string_keys):
            raise CalendarSourceError("State Event enthält ungültigen Text")
        if _SAFE_TEAM_ID_RE.fullmatch(item["team_id"]) is None:
            raise CalendarSourceError("State Event enthält ungültige Team-ID")
        expected_uid = _event_uid(
            item["season"], item["league"], item["round_name"], item["team_id"]
        )
        if item["uid"] != expected_uid:
            raise CalendarSourceError("State Event enthält ungültige UID")
        if item["status"] not in {"CONFIRMED", "CANCELLED"} or not isinstance(item["is_home"], bool):
            raise CalendarSourceError("State Event enthält ungültigen Status")
        if item["location"] is not None and not isinstance(item["location"], str):
            raise CalendarSourceError("State Event enthält ungültigen Ort")
        if item["location_warning"] is not None and not isinstance(item["location_warning"], str):
            raise CalendarSourceError("State Event enthält ungültige Ortswarnung")
        if item["location_warning"] not in {
            None,
            "Adresse unvollständig",
            "Austragungsort nicht auflösbar",
        }:
            raise CalendarSourceError("State Event enthält unbekannte Ortswarnung")
        if not isinstance(item["sequence"], int) or isinstance(item["sequence"], bool) or item["sequence"] < 0:
            raise CalendarSourceError("State Event enthält ungültige Sequence")
        _parse_state_timestamp(item["starts_at"], "State Event starts_at")
        _parse_state_timestamp(item["last_modified"], "State Event last_modified")
        if item["fingerprint"] != _event_fingerprint(item):
            raise CalendarSourceError("State Event Fingerprint stimmt nicht")
        if item["uid"] in seen:
            raise CalendarSourceError("State enthält doppelte UID")
        seen.add(item["uid"])
        normalized.append(item)
    if [event["uid"] for event in normalized] != sorted(event["uid"] for event in normalized):
        raise CalendarSourceError("State Events müssen nach UID sortiert sein")
    if season is None and normalized:
        raise CalendarSourceError("State ohne Saison darf keine Events enthalten")
    if season is not None and any(event["season"] != season for event in normalized):
        raise CalendarSourceError("State Event-Saison stimmt nicht")
    return {
        "schema_version": _STATE_SCHEMA_VERSION,
        "season": season,
        "updated_at": value["updated_at"],
        "events": normalized,
        "index_fingerprint": index_fingerprint if version == _STATE_SCHEMA_VERSION else None,
    }


def _validate_team_id(team_id: Any) -> None:
    if not isinstance(team_id, str) or _SAFE_TEAM_ID_RE.fullmatch(team_id) is None:
        raise CalendarSourceError(f"Ungültige Team-ID für Feedpfad: {team_id!r}")


def _validate_calendar_publication(publication: CalendarPublication) -> None:
    if not isinstance(publication, CalendarPublication):
        raise CalendarSourceError("Kalenderpublikation ist ungültig")
    index = _decode_json_object(publication.calendar_index_json, "Kalenderindex")
    state = _decode_json_object(publication.calendar_state_json, "Kalenderstate")
    _validate_previous_state(state)
    if not isinstance(index.get("teams"), Mapping) or index.get("schema_version") != _INDEX_SCHEMA_VERSION:
        raise CalendarSourceError("Kalenderindex ist inkompatibel")
    for key, entry in index["teams"].items():
        if not isinstance(key, str) or normalize_team_name(key) != key or not isinstance(entry, Mapping):
            raise CalendarSourceError("Kalenderindex enthält einen ungültigen Team-Schlüssel")
        if not isinstance(entry.get("name"), str) or not isinstance(entry.get("path"), str):
            raise CalendarSourceError("Kalenderindex enthält ungültige Teamdaten")
        expected_path = f"calendars/{entry.get('team_id')}.ics"
        if entry.get("path") != expected_path:
            raise CalendarSourceError("Kalenderindex enthält einen unsicheren Feedpfad")
        _validate_team_id(entry.get("team_id"))
    expected_js = b"window.BWEDL_CALENDAR_INDEX = " + publication.calendar_index_json.rstrip(b"\n") + b";\n"
    if publication.calendar_index_js != expected_js:
        raise CalendarSourceError("Kalenderindex-JavaScript ist nicht inert oder inkonsistent")
    if not isinstance(publication.calendars, Mapping):
        raise CalendarSourceError("Kalenderfeeds müssen ein Mapping sein")
    for team_id, contents in publication.calendars.items():
        _validate_team_id(team_id)
        _validate_ics_feed(contents)


def _decode_json_object(contents: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(contents, bytes):
        raise CalendarSourceError(f"{label} muss UTF-8-Bytes sein")
    try:
        value = json.loads(contents.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CalendarSourceError(f"{label} ist kein gültiges JSON") from error
    if not isinstance(value, Mapping):
        raise CalendarSourceError(f"{label} muss ein Objekt sein")
    return value


def _validate_ics_feed(contents: Any) -> None:
    if not isinstance(contents, bytes):
        raise CalendarSourceError("Kalenderfeed muss UTF-8-Bytes sein")
    try:
        decoded = contents.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CalendarSourceError("Kalenderfeed ist nicht UTF-8") from error
    remaining_linebreaks = decoded.replace("\r\n", "")
    if "\n" in remaining_linebreaks or "\r" in remaining_linebreaks or not decoded.endswith("\r\n"):
        raise CalendarSourceError("Kalenderfeed muss ausschließlich CRLF verwenden")
    physical_lines = decoded.split("\r\n")
    if physical_lines[-1] != "" or any(len(line.encode("utf-8")) > 75 for line in physical_lines[:-1]):
        raise CalendarSourceError("Kalenderfeed enthält ungültige Faltung")
    if any(
        ord(character) < 32 and character not in "\r\n"
        or 127 <= ord(character) <= 159
        for character in decoded
    ):
        raise CalendarSourceError("Kalenderfeed enthält unzulässige Steuerzeichen")
    logical_lines: list[str] = []
    for line in physical_lines[:-1]:
        if line.startswith(" "):
            if not logical_lines:
                raise CalendarSourceError("Kalenderfeed beginnt mit einer Faltungszeile")
            logical_lines[-1] += line[1:]
        else:
            logical_lines.append(line)
    if not logical_lines or logical_lines[0] != "BEGIN:VCALENDAR" or logical_lines[-1] != "END:VCALENDAR":
        raise CalendarSourceError("Kalenderfeed hat keine gültigen VCALENDAR-Grenzen")
    uids = []
    for line in logical_lines:
        if ":" not in line:
            continue
        name_and_params, value = line.split(":", 1)
        if name_and_params.split(";", 1)[0].casefold() == "uid":
            uids.append(value)
    if len(uids) != len(set(uids)):
        raise CalendarSourceError("Kalenderfeed enthält doppelte UID")


def _ensure_within(root: Path, path: Path) -> None:
    try:
        path.resolve(strict=False).relative_to(root)
    except ValueError as error:
        raise CalendarSourceError("Kalenderpfad verlässt das Output-Verzeichnis") from error


def _write_bytes_safely(path: Path, contents: bytes) -> None:
    if path.exists() and _is_reparse_point(path):
        raise CalendarSourceError("Kalenderdatei darf kein Symlink sein")
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
            temporary.write(contents)
            temporary_path = Path(temporary.name)
    except (OSError, TypeError) as error:
        raise CalendarSourceError("Kalenderdatei kann nicht vorbereitet werden") from error
    try:
        os.replace(temporary_path, path)
    except OSError as error:
        try:
            if temporary_path.exists():
                temporary_path.unlink()
        except OSError:
            pass
        raise CalendarSourceError("Kalenderdatei kann nicht geschrieben werden") from error


def _preflight_calendar_file(calendars_dir: Path, path: Path) -> None:
    _ensure_within(calendars_dir, path)
    if _is_reparse_point(path) or not path.is_file():
        raise CalendarSourceError("Bestehender Kalender darf kein Symlink oder Reparse-Point sein")
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise CalendarSourceError("Bestehender Kalender ist nicht sicher lesbar") from error
    _ensure_within(calendars_dir, resolved)


def _preflight_artifact_target(root: Path, path: Path) -> None:
    _ensure_within(root, path)
    parent = path.parent
    if not parent.is_dir() or _is_reparse_point(parent):
        raise CalendarSourceError("Kalenderziel hat ein unsicheres Elternverzeichnis")
    try:
        resolved_parent = parent.resolve(strict=True)
    except OSError as error:
        raise CalendarSourceError("Kalenderziel hat kein sicheres Elternverzeichnis") from error
    _ensure_within(root, resolved_parent)
    if not os.path.lexists(path):
        return
    if _is_reparse_point(path) or not path.is_file():
        raise CalendarSourceError("Kalenderziel muss eine reguläre Datei sein")
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise CalendarSourceError("Kalenderziel ist nicht sicher prüfbar") from error
    _ensure_within(root, resolved)


def _preflight_output_root(output_dir: Path) -> Path:
    root = output_dir.absolute()
    chain = [root, *root.parents]
    for node in reversed(chain):
        if not os.path.lexists(node):
            continue
        if _is_reparse_point(node) or not node.is_dir():
            raise CalendarSourceError("Output-Pfad enthält kein sicheres Verzeichnis")
    return root


def _preflight_existing_output(
    root: Path, calendars_dir: Path, artifacts: Mapping[Path, bytes]
) -> list[Path]:
    if not root.exists():
        return []
    _ensure_within(root, root)
    if calendars_dir.exists():
        if _is_reparse_point(calendars_dir) or not calendars_dir.is_dir():
            raise CalendarSourceError("Kalender-Verzeichnis muss ein sicheres Verzeichnis sein")
        _ensure_within(root, calendars_dir.resolve(strict=True))
        existing_feeds = list(calendars_dir.glob("*.ics"))
        for existing in existing_feeds:
            _preflight_calendar_file(calendars_dir, existing)
    else:
        existing_feeds = []
    for path in artifacts:
        if path.parent.exists():
            _preflight_artifact_target(root, path)
    return existing_feeds


def _is_reparse_point(path: Path) -> bool:
    try:
        status = os.lstat(path)
    except OSError as error:
        raise CalendarSourceError("Kalenderpfad ist nicht sicher prüfbar") from error
    attributes = getattr(status, "st_file_attributes", 0)
    return path.is_symlink() or bool(
        attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


def _load_json_file(path: str) -> Mapping[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CalendarSourceError(f"JSON-Datei nicht lesbar: {path}") from error
    if not isinstance(value, Mapping):
        raise CalendarSourceError(f"JSON-Datei muss ein Objekt enthalten: {path}")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Erzeugt zustandsbehaftete BWEDL-Teamkalender.")
    parser.add_argument("--league-json", required=True)
    parser.add_argument("--club-json", required=True)
    parser.add_argument("--previous-state")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--updated-at", required=True)
    arguments = parser.parse_args(argv)
    try:
        updated_at = _parse_authoritative_timestamp(arguments.updated_at, "updated_at")
        publication = build_calendar_publication(
            _load_json_file(arguments.league_json),
            _load_json_file(arguments.club_json),
            previous_state=_load_json_file(arguments.previous_state) if arguments.previous_state else None,
            updated_at=updated_at,
        )
        write_calendar_publication(publication, arguments.output_dir)
    except CalendarSourceError as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
