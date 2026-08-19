"""Pure parsing helpers for regular BWEDL league fixtures.

The calendar generator consumes these value objects later; this module deliberately
does not read files or perform network I/O.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import re
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
