"""Pure parsing helpers for historical player ranking tables."""

from __future__ import annotations

from copy import deepcopy
import re
import unicodedata
from typing import Any, Iterable


class ArchivePlayerParseError(ValueError):
    """Raised when historical player evidence is incomplete or inconsistent."""


ROUND_HEADER = re.compile(r"^(?:r(?:unde)?\s*)?(\d{1,2})$", re.I)
_ROUND_LIKE_HEADER = re.compile(r"^r(?:unde)?(?=$|[\s:._-]|\d)", re.I)


def _text(value: Any) -> str:
    source = "" if value is None else str(value)
    return unicodedata.normalize("NFKC", source).strip()


def _header_key(value: Any) -> str:
    return re.sub(r"\s+", " ", _text(value)).casefold()


def _cell(row: list[Any], index: int | None) -> str:
    if index is None or index >= len(row):
        return ""
    return _text(row[index])


def _nonnegative_integer(value: Any, label: str) -> int:
    text = _text(value)
    if label == "rank":
        text = text.rstrip(".")
    if not re.fullmatch(r"\d+", text):
        raise ArchivePlayerParseError(f"invalid {label}")
    return int(text)


def _normalize_name(value: Any) -> str:
    name = " ".join(_text(value).split())
    if name.count(",") == 1:
        last, first = (part.strip() for part in name.split(",", 1))
        if first and last:
            name = f"{first} {last}"
    return unicodedata.normalize("NFC", name)


def _canonical_season_start(value: Any) -> int:
    season = _text(value)
    match = re.match(r"^(\d{4})\s*[/\-]", season)
    if match:
        return int(match.group(1))
    match = re.match(r"^(\d{2})\s*[/\-]", season)
    if match:
        return 2000 + int(match.group(1))
    return -1


def parse_round_value(value: Any) -> int | str:
    """Return a non-negative round result, ``x``, or an empty marker."""

    text = _text(value)
    if re.fullmatch(r"\d+", text):
        return int(text)
    return "x" if text.casefold() == "x" else ""


def _is_suspicious_round_header(value: Any) -> bool:
    key = _header_key(value)
    return ROUND_HEADER.fullmatch(key) is None and bool(_ROUND_LIKE_HEADER.match(key))


def locate_archive_columns(headers: list[str]) -> dict[str, Any]:
    """Locate supported archive columns and canonicalize round positions."""

    columns: dict[str, Any] = {
        "rank": None,
        "v_nr": None,
        "id": None,
        "first_name": None,
        "last_name": None,
        "name": None,
        "points": None,
        "rounds": [],
    }
    round_numbers: set[int] = set()
    for index, source in enumerate(headers):
        key = _header_key(source)
        plain_key = key.rstrip(".")
        if plain_key in {"pl", "platz", "rang"}:
            columns["rank"] = index
        elif plain_key in {"v-nr", "vnr"}:
            columns["v_nr"] = index
        elif plain_key in {"id", "nr"}:
            columns["id"] = index
        elif plain_key == "vorname":
            columns["first_name"] = index
        elif plain_key == "nachname":
            columns["last_name"] = index
        elif plain_key == "name":
            columns["name"] = index
        elif plain_key == "gesamt":
            columns["points"] = index
        else:
            match = ROUND_HEADER.fullmatch(key)
            if match:
                number = int(match.group(1))
                if number in round_numbers:
                    raise ArchivePlayerParseError("duplicate round column")
                round_numbers.add(number)
                columns["rounds"].append((number, index))
            elif _is_suspicious_round_header(key):
                raise ArchivePlayerParseError(f"invalid round header: {source!r}")

    if (
        columns["first_name"] is not None
        and columns["last_name"] is None
        and columns["name"] is not None
    ):
        columns["last_name"] = columns["name"]
        columns["name"] = None

    required = ("rank", "id", "points")
    if any(columns[name] is None for name in required):
        raise ArchivePlayerParseError("missing required archive column")
    has_combined_name = columns["name"] is not None
    has_separate_name = (
        columns["first_name"] is not None and columns["last_name"] is not None
    )
    if not has_combined_name and not has_separate_name:
        raise ArchivePlayerParseError("missing archive player name columns")

    columns["rounds"].sort()
    if round_numbers and round_numbers != set(range(1, max(round_numbers) + 1)):
        raise ArchivePlayerParseError("incomplete round columns")
    return columns


def parse_archive_player_row(
    season: str,
    league: str,
    columns: dict[str, Any],
    row: list[str],
) -> dict[str, Any] | None:
    """Parse one historical ranking row without changing the source row."""

    if not any(_text(value) for value in row):
        return None

    player_id = _cell(row, columns["id"])
    normalized_season = _text(season)
    normalized_league = _text(league)
    if not player_id or not normalized_season:
        raise ArchivePlayerParseError("blank player-season identity")
    if re.fullmatch(r"[0-9]+", player_id) is None:
        raise ArchivePlayerParseError("invalid archive player id")
    if not normalized_league:
        raise ArchivePlayerParseError("blank archive league")

    if columns["name"] is not None:
        name = _normalize_name(_cell(row, columns["name"]))
    else:
        name = _normalize_name(
            " ".join(
                part for part in (
                    _cell(row, columns["first_name"]),
                    _cell(row, columns["last_name"]),
                ) if part
            )
        )
    if not name:
        raise ArchivePlayerParseError("blank archive player name")
    if not any(unicodedata.category(character).startswith("L") for character in name):
        raise ArchivePlayerParseError("invalid archive player name")

    points = _nonnegative_integer(_cell(row, columns["points"]), "points")
    record: dict[str, Any] = {
        "id": player_id,
        "season": normalized_season,
        "rank": _nonnegative_integer(_cell(row, columns["rank"]), "rank"),
        "points": points,
        "league": normalized_league,
        "name": name,
    }

    round_columns: list[tuple[int, int]] = columns["rounds"]
    v_nr = _cell(row, columns["v_nr"])
    if v_nr and re.fullmatch(r"[0-9]+", v_nr) is None:
        raise ArchivePlayerParseError("invalid archive club number")
    if v_nr:
        record["v_nr"] = v_nr
    if not round_columns:
        return record
    if not v_nr:
        raise ArchivePlayerParseError("blank archive club number")

    rounds: dict[str, int | str] = {}
    numeric_values: list[int] = []
    for number, index in round_columns:
        source = _cell(row, index)
        value = parse_round_value(source)
        if value == "" and source:
            raise ArchivePlayerParseError("invalid round value")
        rounds[f"R{number}"] = value
        if isinstance(value, int):
            numeric_values.append(value)

    round_total = sum(numeric_values)
    if round_total != points:
        raise ArchivePlayerParseError(
            f"round total {round_total} does not match Gesamt {points}"
        )
    appearances = len(numeric_values)
    record.update({
        "rounds": rounds,
        "appearances": appearances,
        "points_per_appearance": points / appearances if appearances else 0.0,
    })
    return record


def parse_archive_ranking_table(
    *, season: str, league: str, headers: list[str], rows: list[list[str]]
) -> list[dict[str, Any]]:
    """Parse all player rows from one archive ranking table."""

    columns = locate_archive_columns(headers)
    records = []
    for row in rows:
        record = parse_archive_player_row(season, league, columns, row)
        if record is not None:
            records.append(record)
    return records


def merge_archive_entries(
    entries: Iterable[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Key entries by player and deterministically order their histories."""

    result: dict[str, list[dict[str, Any]]] = {}
    seen: set[tuple[str, str]] = set()
    for source in entries:
        record = deepcopy(source)
        player_id = _text(record.pop("id", ""))
        season = _text(record.get("season", ""))
        if not player_id or not season:
            raise ArchivePlayerParseError("blank player-season identity")
        key = (player_id, season)
        if key in seen:
            raise ArchivePlayerParseError("duplicate player-season identity")
        seen.add(key)
        record["season"] = season
        result.setdefault(player_id, []).append(record)

    for history in result.values():
        history.sort(
            key=lambda item: (_canonical_season_start(item["season"]), item["season"]),
            reverse=True,
        )
    return dict(sorted(result.items()))
