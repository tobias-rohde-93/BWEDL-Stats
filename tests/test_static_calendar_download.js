const assert = require('node:assert/strict');
const path = require('node:path');

const { buildStaticCalendarDownload } = require(path.join(__dirname, '..', 'app_utils.js'));

const encoder = new TextEncoder();
const NOW = new Date('2026-08-19T12:00:00Z');
const OPTIONS = {
    now: NOW,
    teamName: 'DĆ Beispiel / 1',
    feedPath: 'calendars/club-001-team-1.ics',
};

function canonicalEvent({
    uid,
    start,
    end = null,
    status = 'CONFIRMED',
    summary = 'Heimspiel gegen DC Gast',
    descriptionLines = ['DESCRIPTION:Begegnung: DC Heim - DC Gast\\nHeimspiel'],
    location = 'LOCATION:Testlokal\\, Teststraße 1',
    omit = null,
    duplicate = null,
} = {}) {
    const endValue = end || `${start.slice(0, 9)}230000Z`;
    const properties = [
        `UID:${uid}@calendar.bwedl.invalid`,
        'DTSTAMP:20260819T010538Z',
        `DTSTART:${start}`,
        `DTEND:${endValue}`,
        `SUMMARY:${summary}`,
        ...descriptionLines,
        location,
        'SEQUENCE:0',
        'LAST-MODIFIED:20260819T010538Z',
        `STATUS:${status}`,
    ].filter((line) => line && !line.startsWith(`${omit}:`));
    if (duplicate) {
        const original = properties.find((line) => line.startsWith(`${duplicate}:`));
        properties.push(original);
    }
    return ['BEGIN:VEVENT', ...properties, 'END:VEVENT'].join('\r\n');
}

function canonicalFeed(...events) {
    return encoder.encode([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//BWEDL//Team Calendar//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:BWEDL – DC Beispiel',
        'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
        'X-PUBLISHED-TTL:PT6H',
        ...events,
        'END:VCALENDAR',
        '',
    ].join('\r\n'));
}

function build(bytes, overrides = {}) {
    return buildStaticCalendarDownload(bytes, { ...OPTIONS, ...overrides });
}

const boundaryEvent = canonicalEvent({ uid: 'boundary', start: '20260819T120000Z' });
const snapshot = build(canonicalFeed(
    canonicalEvent({ uid: 'past', start: '20260819T115959Z' }),
    boundaryEvent,
    canonicalEvent({ uid: 'cancelled', start: '20260825T180000Z', status: 'CANCELLED' }),
));

assert.equal(snapshot.ok, true);
assert.equal(snapshot.eventCount, 1);
assert.equal(snapshot.filename, 'bwedl-dc-beispiel-1-zukuenftige-spiele.ics');
assert.equal(Object.isFrozen(snapshot), true);
assert.match(snapshot.content, /UID:boundary@calendar\.bwedl\.invalid/);
assert.doesNotMatch(snapshot.content, /UID:(?:past|cancelled)@/);
assert.doesNotMatch(snapshot.content, /REFRESH-INTERVAL|X-PUBLISHED-TTL/);
assert.equal(snapshot.content.includes(boundaryEvent), true, 'the canonical folded event block stays byte-equivalent');
assert.equal(snapshot.content.replaceAll('\r\n', '').includes('\n'), false);
assert.equal(snapshot.content.endsWith('\r\n'), true);
for (const line of snapshot.content.split('\r\n').slice(0, -1)) {
    assert.ok(encoder.encode(line).byteLength <= 75, `physical line exceeds 75 octets: ${line}`);
    assert.doesNotMatch(line, /[ \t]$/u);
}

const folded = build(canonicalFeed(canonicalEvent({
    uid: 'folded',
    start: '20260824T180000Z',
    descriptionLines: [
        'DESCRIPTION:Begegnung: DC Heim - DC Überraschung\\nAuswärtsspiel\\n',
        ' Fortsetzung mit Umlauten äöü',
    ],
})));
assert.equal(folded.ok, true);
assert.match(folded.content, /\r\n Fortsetzung mit Umlauten äöü\r\n/u);

assert.deepEqual(build(canonicalFeed(canonicalEvent({
    uid: 'past-only', start: '20260819T115959Z',
}))), { ok: false, reason: 'empty' });
assert.deepEqual(build(new Uint8Array(524289)), { ok: false, reason: 'oversized' });

const invalidCases = [
    encoder.encode('BEGIN:VCALENDAR\nEND:VCALENDAR\n'),
    Uint8Array.from([0xff]),
    canonicalFeed(canonicalEvent({ uid: 'bad-date', start: '20260824' })),
    canonicalFeed(canonicalEvent({ uid: 'duplicate', start: '20260824T180000Z', duplicate: 'STATUS' })),
    canonicalFeed(canonicalEvent({ uid: 'missing', start: '20260824T180000Z', omit: 'SUMMARY' })),
    canonicalFeed(
        canonicalEvent({ uid: 'same', start: '20260824T180000Z' }),
        canonicalEvent({ uid: 'same', start: '20260825T180000Z' }),
    ),
    canonicalFeed(canonicalEvent({
        uid: 'long-line', start: '20260824T180000Z', summary: 'A'.repeat(70),
    })),
    canonicalFeed(canonicalEvent({
        uid: 'trailing-space', start: '20260824T180000Z', summary: 'Ungültig ',
    })),
    canonicalFeed(canonicalEvent({ uid: 'nested', start: '20260824T180000Z' })
        .replace('SUMMARY:', 'BEGIN:VALARM\r\nSUMMARY:')),
    canonicalFeed(canonicalEvent({ uid: 'unbalanced', start: '20260824T180000Z' })
        .replace('END:VEVENT', 'END:VTODO')),
    canonicalFeed(canonicalEvent({ uid: 'top-level', start: '20260824T180000Z' }))
        .map((byte) => byte),
];
const wrongHeader = new TextDecoder().decode(invalidCases.pop()).replace('VERSION:2.0', 'VERSION:1.0');
invalidCases.push(encoder.encode(wrongHeader));
for (const invalid of invalidCases) assert.deepEqual(build(invalid), { ok: false, reason: 'invalid' });

assert.deepEqual(build(canonicalFeed(boundaryEvent), { feedPath: '../calendar.ics' }), { ok: false, reason: 'invalid' });
assert.deepEqual(build(canonicalFeed(boundaryEvent), { now: new Date('invalid') }), { ok: false, reason: 'invalid' });
assert.deepEqual(build('not bytes'), { ok: false, reason: 'invalid' });

const fallbackName = build(canonicalFeed(boundaryEvent), { teamName: '../../' });
assert.equal(fallbackName.filename, 'bwedl-club-001-team-1-zukuenftige-spiele.ics');
const boundedName = build(canonicalFeed(boundaryEvent), { teamName: `DC ${'sehrlang'.repeat(40)}` });
assert.ok(boundedName.filename.length <= 120);
assert.match(boundedName.filename, /^bwedl-[a-z0-9-]+-zukuenftige-spiele\.ics$/u);

assert.deepEqual(build(canonicalFeed(boundaryEvent)), build(canonicalFeed(boundaryEvent)));

console.log('static team calendar download: ok');
