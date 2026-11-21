# Reads the level-up learnsets out of PokeMMO's own game data (data/data.pak: gzip, "\x07POKEMMO" header).
# The learnset table: records of [u16 species][u8 count][count x (u16 move, u8 level)], species in descending order.
# Found by searching for Pikachu's moves as MMO Showdown lists them (Electro Ball 486 @ 12, Double Kick 24 @ 9).
# Run: python -I tools/pak_learnsets.py PATH/TO/data.pak out.json
import gzip, json, struct, sys

d = gzip.open(sys.argv[1]).read()
assert d[1:8] == b'POKEMMO', 'not a PokeMMO data.pak'

def chain(o, stop=None):
    """Parse records from o while they look like learnset records; return [(species, [(move, lv)])], end offset."""
    recs, last = [], None
    while o + 3 <= len(d) and (stop is None or o < stop):
        sp, n = struct.unpack_from('<HB', d, o)
        if not (1 <= sp <= 2000) or not (1 <= n <= 80) or (last is not None and sp >= last) or o + 3 + 3 * n > len(d): break
        ent = [struct.unpack_from('<HB', d, o + 3 + 3 * k) for k in range(n)]
        if not all(1 <= m <= 1000 and 1 <= lv <= 100 for m, lv in ent): break
        lvs = [lv for _, lv in ent]
        if lvs != sorted(lvs) and lvs[lvs.index(max(1, lvs[0])):] != sorted(lvs[lvs.index(max(1, lvs[0])):]): break
        recs.append((sp, ent)); last = sp; o += 3 + 3 * n
    return recs, o

# the anchor: Pikachu's record
anchor = None
for o in range(len(d) - 80):
    if d[o:o + 3] == b'\x19\x00\x19' and d[o + 3:o + 6] == bytes([0xa1, 0x01, 0x01]): anchor = o; break
assert anchor is not None, "Pikachu's record not found"
# the table's start: the earliest offset whose chain of records runs into the anchor
start = anchor
for o in range(anchor - 1, max(0, anchor - 200000), -1):
    recs, end = chain(o, stop=anchor)
    if end == anchor and recs and len(recs) >= 1:
        start = o
recs, end = chain(start)
print(f'table at {start}..{end}: {len(recs)} records, species {recs[0][0]}..{recs[-1][0]}', file=sys.stderr)
json.dump({str(sp): ent for sp, ent in recs}, open(sys.argv[2], 'w'), separators=(',', ':'))
