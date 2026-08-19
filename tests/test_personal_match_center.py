from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "bundle_v31.js").read_text(encoding="utf-8")
STYLES = (ROOT / "style.css").read_text(encoding="utf-8")


def test_dashboard_and_club_use_reviewed_upcoming_selector() -> None:
    assert "BwedlAppUtils.selectUpcomingGames(mySchedule" in SOURCE
    assert "BwedlAppUtils.selectUpcomingGames(upcomingLeagueMatches" in SOURCE
    assert "BwedlAppUtils.selectUpcomingGames(upcomingLigapokalMatches" in SOURCE
    assert "mySchedule.filter(g => g.isPending" not in SOURCE


def test_match_actions_keep_independent_capabilities() -> None:
    match_actions = SOURCE.split("function buildGameActions(game)", 1)[1].split(
        "function renderGameActions", 1
    )[0]
    assert "function buildGameActions(game)" in SOURCE
    assert "function calendarGame(game)" not in SOURCE
    assert "function calendarFilename(game)" not in SOURCE
    assert "function downloadGameCalendar(game)" not in SOURCE
    assert "URL.createObjectURL" not in match_actions
    assert ".download" not in match_actions
    assert "key: 'calendar'" not in SOURCE
    assert "shareCurrentView(gameShareText(game), bestShareRoute(game))" in SOURCE
    assert "target: '_blank'" in SOURCE
    assert "rel: 'noopener noreferrer'" in SOURCE


def test_match_preview_handoff_and_accessible_responsive_actions() -> None:
    assert "sessionStorage.setItem(MATCH_PREVIEW_SESSION_KEY" in SOURCE
    assert "readMatchPreviewGame()" in SOURCE
    assert "action.ariaLabel" in SOURCE
    assert ".game-actions" in STYLES
    assert ".game-actions__button" in STYLES
    assert "@media (max-width: 640px)" in STYLES


def test_game_cards_keep_native_actions_without_nested_interactive_semantics() -> None:
    assert "function configureGameCardNavigation(card, game)" not in SOURCE
    assert "nextCard.setAttribute('role', 'button')" not in SOURCE
    assert "nextCard.setAttribute('tabindex', '0')" not in SOURCE
    assert "key: 'league'" in SOURCE
    assert "label: 'Liga öffnen'" in SOURCE
    assert "nextCard.onclick =" not in SOURCE
