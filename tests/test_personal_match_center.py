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
    assert "function buildGameActions(game)" in SOURCE
    assert "function calendarGame(game)" in SOURCE
    assert "buildIcsContent(calendarGame(game))" in SOURCE
    assert "new Blob([content], { type: 'text/calendar;charset=utf-8' })" in SOURCE
    assert "setTimeout(cleanup" in SOURCE
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


def test_game_cards_expose_keyboard_navigation_without_nested_activation() -> None:
    assert "function configureGameCardNavigation(card, game)" in SOURCE
    assert "card.setAttribute('role', 'button')" in SOURCE
    assert "event.target !== event.currentTarget" in SOURCE
    assert "nextCard.onclick =" not in SOURCE
