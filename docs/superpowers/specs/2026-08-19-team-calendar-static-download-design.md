# Team Calendar Subscription and Static ICS Download Design

**Date:** 2026-08-19

**Status:** Approved for implementation

## Context

BWEDL Stats currently publishes one stable, read-only ICS subscription per team. The existing mobile dialog offers a `webcal` action and a copyable HTTPS subscription URL. This is the right option for users who accept a separate team calendar and want later fixture changes to arrive automatically.

Some users instead want the fixtures copied into an existing personal or shared calendar. Google Calendar cannot merge an external ICS subscription into an existing calendar. A Google Calendar API integration would require sign-in, calendar write access, synchronization state, and a non-static synchronization mechanism. That complexity is outside the product's GitHub Pages-only runtime.

The product will therefore retain the automatic subscription and add a clearly distinct, one-time ICS download. The downloaded file can be imported into a writable existing calendar, but later changes remain the user's responsibility.

## Goals

- Keep the current automatic team-calendar subscription unchanged.
- Add one static ICS download containing all confirmed, future fixtures for the profile team in a single file.
- Explain the difference between subscription and import before the user acts.
- Provide concise iPhone and Android/Google Calendar instructions for both choices.
- Make the complete flow mobile-first, accessible, and usable at approximately 390 x 844 CSS pixels.
- Preserve GitHub Pages as the only product runtime; add no API, OAuth flow, backend, or Google credentials.
- Reuse the canonical published team feed so opponent, home/away status, date, time, venue, and address stay consistent with the subscription.

## Non-goals

- Writing events into Google Calendar through the Google Calendar API.
- Automatically updating events after they were imported from the static file.
- Merging an external subscription into a user's existing calendar.
- Reintroducing individual per-match ICS downloads.
- Publishing a second permanent snapshot file for every team.
- Supporting unconfirmed fixtures without a start time, Ligapokal fixtures, byes, cancelled fixtures, or past fixtures in the static download.
- Claiming that Apple Calendar or Google Calendar has completed an import merely because the browser created a valid file.

## User-facing choices

The existing action card remains available on the Dashboard and under My Profile. Its action opens one native dialog titled **Teamkalender hinzufügen**. The introductory copy is:

> Wähle zwischen automatischer Aktualisierung und einer einmaligen Kopie.

Because the dialog now offers more than a subscription, the action-card button changes from **Kalender abonnieren** to **Kalender hinzufügen**.

The dialog contains two vertically ordered option cards.

### Option 1: Automatic subscription

Label: **Empfohlen**

Heading: **Automatisch aktuell bleiben**

Copy:

> Wird als eigener, schreibgeschützter Teamkalender hinzugefügt. Terminänderungen und Absagen werden automatisch übernommen.

Actions:

- **In Kalender-App öffnen** opens the existing validated `webcal` URL.
- **Abo-Link kopieren** copies the existing validated HTTPS URL.

This option retains the current feed URL, feed contents, refresh behavior, safe URL resolution, clipboard lifecycle, and error handling.

### Option 2: Static import

Label: **Für bestehende oder gemeinsame Kalender**

Heading: **Termine einmalig übernehmen**

Copy:

> Lädt alle zukünftigen, bereits terminierten Ligaspiele als eine gemeinsame ICS-Datei herunter.

Warning:

> Keine automatische Aktualisierung: Verschiebungen und Absagen musst du anschließend selbst im Zielkalender ändern. Ein erneuter Import kann zu doppelten Terminen führen.

Action: **ICS-Datei herunterladen**

The action creates exactly one file for the selected profile team. It never creates one file per match.

## Mobile-first layout and accessibility

- At narrow widths the dialog uses almost the full viewport width, has a bounded `100dvh`-based height, and scrolls internally.
- The two option cards always stack vertically; the design never requires horizontal scrolling.
- Interactive targets are at least 44 CSS pixels high, with the primary actions targeting 48 pixels.
- The dialog has a clearly reachable close control, a labelled heading and description, a visible keyboard focus ring, and a single predictable tab order.
- Instructions use native expandable sections. Each option has **Anleitung für iPhone** and **Anleitung für Android / Google Kalender**. Platform detection is not required; every instruction stays discoverable on every device.
- Status and error messages use the existing polite live region. Warnings remain visible text and do not rely on color alone.
- At wider widths the same content remains in one bounded dialog. Desktop does not introduce a different information architecture.
- Closing the dialog returns focus to the trigger and invalidates pending clipboard or download work.

## Device instructions

Instructions are deliberately short and distinguish operations that can be completed on the phone from Google operations that require a computer browser.

### Subscription: iPhone

1. Tap **In Kalender-App öffnen**.
2. Confirm **Abonnieren** in Apple Calendar.
3. Choose a name and color and add the calendar.
4. Fallback: copy the subscription link and use Apple Calendar > Calendars > Add Calendar > Add Subscription Calendar.

### Subscription: Android / Google Calendar

1. Tap **Abo-Link kopieren**.
2. On a computer, open Google Calendar with the same Google account.
3. Choose Other calendars > Add > From URL.
4. Paste the URL and add the calendar.
5. The subscribed calendar then appears in the Google Calendar Android app and can be enabled from its menu.

The instructions explicitly state that Google does not support creating this URL subscription in the Android app.

### Static import: iPhone

1. Tap **ICS-Datei herunterladen**.
2. Open the file, or open it as an attachment in Apple Mail if the downloaded file is only previewed.
3. Use the calendar import action offered by iOS.
4. Before saving, check the writable destination calendar.
5. For a shared Google Calendar, the Google computer import described below is the more reliable route.

The wording must not promise an identical import sheet on every iOS version. Apple documents ICS import from Mail, while the exact UI can vary.

### Static import: Android / Google Calendar

1. Download and keep the ICS file.
2. On a computer, open Google Calendar.
3. Choose Settings > Import & export.
4. Select the downloaded ICS file.
5. Select the desired existing or shared destination calendar.
6. Choose Import.

The instructions explicitly state that Google supports ICS import in the computer version, not in the Android app, and that imports are one-time copies.

## Static download data flow

The static snapshot is generated only after the user activates the download action:

1. Resolve the profile team's subscription using the existing fail-closed calendar index resolver.
2. Fetch the same-origin HTTPS feed with `cache: "no-store"`. Redirects or final URLs outside the expected GitHub Pages origin and safe `calendars/<team-id>.ics` path are rejected.
3. Read the response as bytes, enforce a conservative response-size limit, and decode it with a fatal UTF-8 decoder before parsing. The limit must comfortably exceed current team feeds while preventing an unexpectedly large response from being processed.
4. Parse only a canonical RFC 5545 `VCALENDAR` containing balanced `VEVENT` components. Reject malformed component boundaries, bare line endings, invalid UTF-8, duplicate required properties, unsafe control characters, or unsupported date forms rather than guessing.
5. Include an event only when `STATUS` is `CONFIRMED`, `DTSTART` is an unambiguous UTC date-time, and `DTSTART >=` the browser's current instant at download time.
6. Re-render a new calendar rather than returning source bytes unchanged. The snapshot includes the canonical event UID, DTSTAMP, start, end, summary, description, location, sequence, last-modified value, and confirmed status. It excludes subscription refresh headers and cancelled tombstones.
7. Fold output lines to at most 75 UTF-8 octets, use CRLF line endings, and emit a standards-compliant `text/calendar;charset=utf-8` Blob.
8. Download the Blob through a temporary object URL and revoke that URL immediately after activation.

The generated calendar name identifies the file as a one-time copy. The filename uses a sanitized, bounded team-name slug with a stable team-ID fallback, for example `bwedl-the-metal-darts-zukuenftige-spiele.ics`.

No generated snapshot is written to local storage, Cache Storage, the service-worker cache, GitHub, or a server.

## Failure and lifecycle behavior

- While generation is active, the download button is disabled and reads **ICS-Datei wird erstellt ...**.
- Repeated activation while a generation is active is ignored.
- A network or offline failure produces: **Die Kalenderdatei konnte nicht geladen werden. Prüfe deine Internetverbindung.**
- A valid feed with no qualifying event produces: **Aktuell sind keine zukünftigen Spieltermine verfügbar.**
- A malformed, unsafe, oversized, or inconsistent response produces: **Die Kalenderdatei konnte nicht sicher erstellt werden.**
- No failure path creates an empty or partial download.
- Closing the dialog prevents a later asynchronous completion from changing removed UI or triggering a download.
- Clipboard and download operations have independent in-flight guards so one action cannot overwrite the other's status.
- The subscription remains usable when snapshot generation fails.

## Component boundaries

- `app_utils.js` owns pure, DOM-free parsing, filtering, calendar rendering, filename sanitization, and validation helpers.
- `bundle_v31.js` owns the dialog, fetch lifecycle, Blob download, platform instructions, user-visible status, and focus handling.
- `style.css` owns the responsive option-card, warning, accordion, and dialog layout.
- `index.html` and `sw_v31.js` advance the changed asset query versions and service-worker cache name so existing installed PWAs receive the new JavaScript and CSS. The calendar feed remains network-only and is never written to Cache Storage.
- The existing calendar index and subscription resolver remain the only source of a team feed URL.
- The Python publication pipeline, public calendar state, calendar index schema, and generated subscription files do not change for this feature.
- README, USER_GUIDE, and WIKI describe both options and reproduce the automatic-versus-static warning.

## Testing strategy

### Pure JavaScript tests

- Accept a valid canonical team feed and produce one valid multi-event snapshot.
- Include all confirmed events at or after the boundary instant.
- Exclude past and `CANCELLED` events.
- Preserve opponent, home/away wording, time, venue, address, and stable UIDs.
- Preserve Unicode while rejecting unsafe control characters.
- Produce CRLF output with no bare LF and no physical line above 75 UTF-8 octets.
- Reject malformed components, missing/duplicate required properties, invalid UTF-8/date-time/status values, unsafe URLs, and oversized inputs.
- Produce safe bounded filenames for punctuation, Unicode, empty names, and hostile names.
- Ensure deterministic output for identical feed bytes and an identical clock value.

### Dialog and lifecycle tests

- Render both option cards on Dashboard and My Profile with identical semantics.
- Keep exactly one dialog and one calendar card after rerenders.
- Verify subscription opening and copy behavior remain unchanged.
- Verify download loading, success, empty, offline, malformed, and close-during-request states.
- Verify a repeated tap does not start a second fetch or download.
- Verify object URLs are revoked and disconnected UI is not updated.
- Verify both iPhone and Android/Google instructions are keyboard accessible and correctly associated with their option.

### Browser and responsive tests

- Exercise the live-like GitHub Pages subpath at approximately 390 x 844 CSS pixels.
- Confirm no horizontal overflow, clipped actions, inaccessible close button, or undersized primary touch target.
- Confirm the generated file contains future confirmed fixtures only and no `/api/` request occurs.
- Confirm the service worker neither precaches nor fallback-caches the fetched team feed or generated snapshot.
- Preserve existing favorites, profile, offline, security, and calendar-subscription regression coverage.

### Manual external checks

- On a supported iPhone, verify subscription handoff and document the observed static-file import path.
- With Google Calendar on a computer, import the snapshot into a selected shared calendar and confirm the events appear in the Android app.
- Keep manual device/import evidence separate from automated tests, GitHub Actions, Pages reachability, and external calendar refresh behavior.

## Acceptance criteria

- Users can understand the consequences of both choices without opening the instructions.
- The automatic option still resolves to the existing stable team subscription.
- One activation downloads one ICS file containing every confirmed future profile-team fixture and no other event.
- The static file can be selected for import into an existing Google Calendar through Google's documented computer workflow.
- The UI and instructions are usable on a 390 x 844 viewport and remain accessible on desktop.
- No API, OAuth flow, backend, new generated public artifact class, or local product runtime is introduced.
- Automated tests pass, and manual Apple/Google import checks are reported separately rather than inferred.
