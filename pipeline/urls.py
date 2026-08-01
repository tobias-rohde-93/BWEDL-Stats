from __future__ import annotations

from urllib.parse import unquote, urljoin, urlsplit, urlunsplit


BWEDL_ORIGIN = "https://www.bwedl.de"
ALLOWED_PATH_PREFIXES = frozenset(
    {"/tabellen/", "/ranglisten/", "/vereine/", "/archiv/"}
)


def _has_unsafe_characters(value: str) -> bool:
    return "\\" in value or any(
        ord(character) < 32 or ord(character) == 127 for character in value
    )


def normalize_bwedl_url(href: str, path_prefix: str) -> str | None:
    if (
        not isinstance(href, str)
        or not href
        or path_prefix not in ALLOWED_PATH_PREFIXES
        or _has_unsafe_characters(href)
        or href.startswith("//")
    ):
        return None

    try:
        candidate = urlsplit(urljoin(f"{BWEDL_ORIGIN}/", href))
        port = candidate.port
    except ValueError:
        return None

    decoded_path = unquote(candidate.path)
    if (
        candidate.scheme != "https"
        or candidate.hostname != "www.bwedl.de"
        or port not in (None, 443)
        or candidate.username is not None
        or candidate.password is not None
        or _has_unsafe_characters(decoded_path)
        or any(segment in {".", ".."} for segment in decoded_path.split("/"))
        or not candidate.path.startswith(path_prefix)
    ):
        return None

    return urlunsplit(("https", "www.bwedl.de", candidate.path, "", ""))
