const assert = require('node:assert/strict');
const BwedlAppUtils = require('../app_utils.js');
const rankingData = require('../ranking_data.json');

const {
    PLAYER_PROFILE_VERSION,
    PLAYER_PROFILE_STORAGE_KEY,
    canonicalRankingCategory,
    rankingRecordKey,
    rankingPersonKey,
    groupRankingPeople,
    createPlayerProfile,
    validatePlayerProfile,
    resolvePlayerProfile,
    migrateLegacyPlayerProfile,
} = BwedlAppUtils;

assert.equal(PLAYER_PROFILE_VERSION, 2);
assert.equal(PLAYER_PROFILE_STORAGE_KEY, 'bwedl_player_profile');

assert.equal(canonicalRankingCategory('Bezirksliga 2026/27'), 'Bezirksliga');
assert.equal(canonicalRankingCategory('Rangliste A Klasse 2025-2026'), 'A-Klasse');
assert.equal(canonicalRankingCategory('b-klasse'), 'B-Klasse');
assert.equal(canonicalRankingCategory(' C-Klasse '), 'C-Klasse');
assert.equal(canonicalRankingCategory('Ligapokal'), null);

assert.equal(rankingRecordKey({ league: 'B-Klasse 2026/27', id: ' 1017 ' }), 'B-Klasse|1017');
assert.equal(rankingRecordKey({ league: 'A-Klasse', id: '1017' }), 'A-Klasse|1017');
assert.equal(rankingRecordKey({ league: 'A-Klasse', id: '' }), null);
assert.equal(rankingRecordKey({ league: 'Unbekannt', id: '1017' }), null);

assert.equal(
    rankingPersonKey({ v_nr: '005', id: ' 1017 ', name: '  Timo   Frank ' }),
    '5|1017|timo frank',
);
assert.equal(rankingPersonKey({ v_nr: '', id: '1017', name: 'Timo Frank' }), null);
assert.equal(rankingPersonKey({ v_nr: '005', id: '', name: 'Timo Frank' }), null);
assert.equal(rankingPersonKey({ v_nr: '005', id: '1017', name: '' }), null);

const currentCollision = rankingData.players.filter((player) => (
    String(player.v_nr) === '005' && String(player.id) === '1017'
));
assert.deepEqual(currentCollision.map((player) => player.name).sort(), ['Timo Frank', 'Timo Weber']);
const collisionGroups = groupRankingPeople(currentCollision);
assert.equal(collisionGroups.length, 2, 'different names never merge despite equal club number and id');

const multiClassPerson = [
    { v_nr: '007', id: '77', name: 'Mara  Beispiel', league: 'C-Klasse', company: 'DC Test' },
    { v_nr: '007', id: '77', name: 'MARA BEISPIEL', league: 'A-Klasse 2026/27', company: 'DC Test' },
    { v_nr: '0007', id: '77', name: 'Mara Beispiel', league: 'B-Klasse', company: 'DC Test' },
];
const before = JSON.stringify(multiClassPerson);
const groups = groupRankingPeople(multiClassPerson);
assert.equal(JSON.stringify(multiClassPerson), before, 'grouping does not mutate source records');
assert.equal(groups.length, 1);
assert.deepEqual(groups[0].recordKeys, ['A-Klasse|77', 'B-Klasse|77', 'C-Klasse|77']);

assert.equal(createPlayerProfile(groups[0], null, 'DC Test'), null);
assert.equal(createPlayerProfile(groups[0], 'Bezirksliga|77', 'DC Test'), null);
const profile = createPlayerProfile(groups[0], 'B-Klasse|77', ' DC Test ');
assert.deepEqual(profile, {
    version: 2,
    recordKey: 'B-Klasse|77',
    personKey: '7|77|mara beispiel',
    id: '77',
    vNr: '7',
    name: 'MARA BEISPIEL',
    primaryLeague: 'B-Klasse',
    teamName: 'DC Test',
});

assert.equal(validatePlayerProfile(profile).status, 'valid');
assert.deepEqual(validatePlayerProfile(JSON.parse(JSON.stringify(profile))).profile, profile);
for (const corrupt of [
    null,
    {},
    { ...profile, version: 1 },
    { ...profile, recordKey: '' },
    { ...profile, personKey: 'wrong' },
    { ...profile, primaryLeague: 'Ligapokal' },
    { ...profile, teamName: 42 },
]) {
    assert.equal(validatePlayerProfile(corrupt).status, 'invalid');
}

const resolved = resolvePlayerProfile(multiClassPerson, profile);
assert.equal(resolved.status, 'resolved');
assert.equal(resolved.player.league, 'B-Klasse');
assert.equal(resolved.records.length, 3);
assert.equal(resolvePlayerProfile(multiClassPerson, { ...profile, recordKey: 'C-Klasse|999' }).status, 'invalid');
assert.equal(resolvePlayerProfile([], profile).status, 'missing');

const uniqueLegacy = migrateLegacyPlayerProfile([
    { v_nr: '009', id: '12', name: 'Unique Name', league: 'C-Klasse', company: 'Old Team' },
], ' unique  name ', 'Old Team');
assert.equal(uniqueLegacy.status, 'resolved');
assert.equal(uniqueLegacy.profile.recordKey, 'C-Klasse|12');
assert.equal(uniqueLegacy.profile.teamName, 'Old Team');

const ambiguousLegacy = migrateLegacyPlayerProfile([
    { v_nr: '001', id: '1', name: 'Same Name', league: 'A-Klasse' },
    { v_nr: '002', id: '2', name: 'same name', league: 'B-Klasse' },
], 'Same Name', '');
assert.equal(ambiguousLegacy.status, 'ambiguous');
assert.equal(ambiguousLegacy.profile, null);

const reorderedMultiClass = [...multiClassPerson].reverse();
assert.equal(migrateLegacyPlayerProfile(multiClassPerson, 'Mara Beispiel', 'DC Test').status, 'ambiguous');
assert.equal(migrateLegacyPlayerProfile(reorderedMultiClass, 'Mara Beispiel', 'DC Test').status, 'ambiguous');

console.log('category-safe player identity contract: ok');
