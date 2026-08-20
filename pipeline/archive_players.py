"""Pure parsing helpers for historical player ranking tables."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
import unicodedata
from typing import Any, Iterable, Mapping


class ArchivePlayerParseError(ValueError):
    """Raised when historical player evidence is incomplete or inconsistent."""


ROUND_HEADER = re.compile(r"^(?:r(?:unde)?\s*)?(\d{1,2})$", re.I)
_ROUND_LIKE_HEADER = re.compile(r"^r(?:unde)?(?=$|[\s:._-]|\d)", re.I)
ADMIN_ROUND_MARKERS = frozenset({"x", "vw", "d", "kp", "*"})
MAX_JAVASCRIPT_SAFE_INTEGER = 2**53 - 1
_REGULAR_CLASS_ORDER = {
    "bezirksliga": 0,
    "a-klasse": 1,
    "b-klasse": 2,
    "c-klasse": 3,
}


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
    result = int(text)
    if result > MAX_JAVASCRIPT_SAFE_INTEGER:
        raise ArchivePlayerParseError(f"invalid {label}: exceeds JavaScript safe integer")
    return result


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


def _canonical_season(value: Any) -> str:
    season = _text(value)
    match = re.fullmatch(r"(\d{2}|\d{4})\s*[/\-]\s*(\d{2}|\d{4})", season)
    if match is None:
        return ""
    start = int(match.group(1))
    if len(match.group(1)) == 2:
        start += 1900 if start >= 70 else 2000
    end = int(match.group(2))
    if len(match.group(2)) == 2:
        end += (start // 100) * 100
        if end < start:
            end += 100
    if end - start not in {1, 2}:
        return ""
    return f"{start:04d}/{end:04d}"


def parse_round_value(value: Any) -> int | str:
    """Return a safe non-negative result or a preserved administrative marker."""

    text = _text(value)
    if re.fullmatch(r"\d+", text):
        numeric = int(text)
        if numeric <= MAX_JAVASCRIPT_SAFE_INTEGER:
            return numeric
    if not text:
        return ""
    if text.casefold() in ADMIN_ROUND_MARKERS:
        return text
    raise ArchivePlayerParseError(f"invalid round value: {text!r}")


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
        try:
            value = parse_round_value(source)
        except ArchivePlayerParseError as error:
            raise ArchivePlayerParseError(f"round R{number}: {error}") from error
        rounds[f"R{number}"] = value
        if isinstance(value, int) and not isinstance(value, bool):
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
    """Group lossless source segments into deterministic player-season containers."""

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for source in entries:
        record = deepcopy(source)
        player_id = _text(record.pop("id", ""))
        season = _canonical_season(record.pop("season", ""))
        if not player_id or not season:
            raise ArchivePlayerParseError("blank player-season identity")
        if re.fullmatch(r"[0-9]+", player_id) is None:
            raise ArchivePlayerParseError("invalid archive player id")
        grouped.setdefault((player_id, season), []).append(record)

    result: dict[str, list[dict[str, Any]]] = {}
    for (player_id, season), source_segments in sorted(grouped.items()):
        segments: list[dict[str, Any]] = []
        segment_ids: set[str] = set()
        for source_segment in source_segments:
            segment = _semantic_segment(source_segment)
            segment_id = archive_segment_id(player_id, season, segment)
            if segment_id in segment_ids:
                raise ArchivePlayerParseError("archive segment identity collision")
            segment_ids.add(segment_id)
            segments.append({"segment_id": segment_id, **segment})

        segments.sort(key=_segment_sort_key)
        points = 0
        for segment in segments:
            points += segment["points"]
            if points > MAX_JAVASCRIPT_SAFE_INTEGER:
                raise ArchivePlayerParseError(
                    "archive season points exceed JavaScript safe integer"
                )
        primary = min(segments, key=_primary_segment_sort_key)
        container: dict[str, Any] = {
            "season": season,
            "rank": min(segment["rank"] for segment in segments),
            "points": points,
            "league": primary["league"],
            "name": primary["name"],
            "primary_segment_id": primary["segment_id"],
            "segments": segments,
        }
        if len(segments) == 1:
            for field in ("v_nr", "rounds", "appearances", "points_per_appearance"):
                if field in primary:
                    container[field] = deepcopy(primary[field])
        if len({_canonical_name(segment["name"]) for segment in segments}) != 1:
            container["identity_ambiguous"] = True
        if _has_conflicting_round_overlap(segments):
            container["round_overlap_ambiguous"] = True
        result.setdefault(player_id, []).append(container)

    for history in result.values():
        history.sort(
            key=lambda item: (_canonical_season_start(item["season"]), item["season"]),
            reverse=True,
        )
    return dict(sorted(result.items()))


def archive_segment_id(
    player_id: str, season: str, segment: Mapping[str, Any]
) -> str:
    """Return the stable identifier for one immutable semantic segment."""

    payload = json.dumps(
        [player_id, season, segment],
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _semantic_segment(source: Mapping[str, Any]) -> dict[str, Any]:
    segment = deepcopy(dict(source))
    if "segment_id" in segment or "segments" in segment:
        raise ArchivePlayerParseError("source segment contains derived identity")
    for field in ("rank", "points"):
        value = segment.get(field)
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 0
            or value > MAX_JAVASCRIPT_SAFE_INTEGER
        ):
            raise ArchivePlayerParseError(
                f"archive segment {field} must be a JavaScript safe integer"
            )
    for field in ("league", "name"):
        value = segment.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ArchivePlayerParseError(f"archive segment {field} must be nonblank")
    if "v_nr" in segment and (
        not isinstance(segment["v_nr"], str)
        or re.fullmatch(r"[0-9]+", segment["v_nr"]) is None
    ):
        raise ArchivePlayerParseError("invalid archive club number")
    return segment


def _normalized_label(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _canonical_name(value: str) -> str:
    return unicodedata.normalize("NFC", _normalized_label(value))


def _segment_sort_key(segment: Mapping[str, Any]) -> tuple[Any, ...]:
    league = _normalized_label(segment["league"])
    club = segment.get("v_nr")
    return (
        _REGULAR_CLASS_ORDER.get(league, len(_REGULAR_CLASS_ORDER)),
        league,
        club is None,
        club or "",
        segment["rank"],
        segment["segment_id"],
    )


def _last_numeric_round(segment: Mapping[str, Any]) -> int:
    result = -1
    rounds = segment.get("rounds")
    if not isinstance(rounds, Mapping):
        return result
    for key, value in rounds.items():
        match = re.fullmatch(r"R([1-9][0-9]*)", key) if isinstance(key, str) else None
        if match and isinstance(value, int) and not isinstance(value, bool):
            result = max(result, int(match.group(1)))
    return result


def _primary_segment_sort_key(segment: Mapping[str, Any]) -> tuple[Any, ...]:
    appearances = segment.get("appearances", 0)
    if not isinstance(appearances, int) or isinstance(appearances, bool):
        appearances = 0
    return (-_last_numeric_round(segment), -appearances, segment["segment_id"])


def _has_conflicting_round_overlap(segments: Iterable[Mapping[str, Any]]) -> bool:
    observations: dict[tuple[str, str, str], set[int]] = {}
    for segment in segments:
        rounds = segment.get("rounds")
        if not isinstance(rounds, Mapping):
            continue
        identity = (_normalized_label(segment["league"]), segment.get("v_nr", ""))
        for round_key, value in rounds.items():
            if isinstance(value, int) and not isinstance(value, bool):
                observations.setdefault((*identity, round_key), set()).add(value)
    return any(len(values) > 1 for values in observations.values())
