# Cross-checks data.js's level-up moves against the PokeMMO forum's "Pokemon Move Index for PokeMMO"
# (forums.pokemmo.com topic 188325, saved as HTML): its "Pokemon that can learn this move (Naturally)" lists.
# Run: python -I tools/check_forum.py forum.html data.js
import re, html, json, sys
sys.stdout.reconfigure(encoding='utf-8')
page, data = sys.argv[1], sys.argv[2]
t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', open(page, encoding='utf-8', errors='replace').read())))
s = open(data, encoding='utf-8').read()
species = json.loads(s[s.index('const SPECIES = ') + 16:].rstrip().rstrip(';'))
norm = lambda x: re.sub(r'[^a-z0-9]', '', x.lower())

ours = {}   # (species key, move) -> levels
for sp in species:
    for lv, m in sp['moves']: ours[(sp['key'], norm(m))] = set(lv)
names = {norm(m): m for sp in species for _, m in sp['moves']}
ALIAS = {'nidoranfemale': 'nidoranf', 'nidoranmale': 'nidoranm'}

theirs, unparsed, moves_seen = {}, [], set()
for m in re.finditer(r'([A-Z][A-Za-z\'.\- 0-9]{1,30}?) Definition of Move =', t):
    mv = norm(m.group(1).split(' ')[-1]) if norm(m.group(1)) not in names else norm(m.group(1))
    for n in range(1, 4):   # the move's name: the last 1-3 words before "Definition"
        cand = norm(' '.join(m.group(1).split(' ')[-n:]))
        if cand in names: mv = cand
    end = t.find(' Definition of Move =', m.end())
    seg = t[m.end(): end if end > 0 else len(t)]
    k = seg.find('(Naturally) =')
    if k < 0: continue
    lst = seg[k + 13:]
    lst = re.split(r' Pokemon that can learn this move| What Pokemon| Is this move', lst)[0]
    moves_seen.add(mv)
    for e in re.split(r'(?:,\s*(?:and\s+)?|\s+and\s+)(?![^(]*\))', lst):   # (not the commas in "(Lv. 1, 9)")
        e = e.strip().rstrip('.')
        if not e or e.lower() in ('n/a', 'none'): continue
        lv = re.search(r'\(Lv\.?\s*([\d,\s]+)\)', e)
        nm = norm(re.sub(r'\((?:Evolve|Lv[^)]*)\)', '', e))
        nm = ALIAS.get(nm, nm)
        if '(Prevo)' in e or 'prevo' in nm: continue
        if not lv: unparsed.append((mv, e)); continue
        theirs[(nm, mv)] = {int(x) for x in re.findall(r'\d+', lv.group(1))}

keys = {sp['key'] for sp in species}
diff_lv, only_forum, only_ours = [], [], []
for (sp, mv), lv in theirs.items():
    if sp not in keys: unparsed.append((mv, sp)); continue
    if (sp, mv) not in ours: only_forum.append((sp, mv, sorted(lv)))
    elif ours[(sp, mv)] != lv: diff_lv.append((sp, mv, sorted(ours[(sp, mv)]), sorted(lv)))
for (sp, mv), lv in ours.items():
    if mv in moves_seen and (sp, mv) not in theirs and sp in {k for k, _ in theirs}: only_ours.append((sp, mv, sorted(lv)))
print(f'forum: {len(moves_seen)} moves, {len(theirs)} species/move pairs; ours: {len(ours)} pairs')
print(f'agree: {sum(1 for k in theirs if k in ours and ours[k] == theirs[k])}')
print('different levels:', len(diff_lv)); [print('  ', x) for x in diff_lv[:40]]
print('forum only:', len(only_forum)); [print('  ', x) for x in only_forum[:40]]
print('ours only (move in the guide):', len(only_ours)); [print('  ', x) for x in only_ours[:40]]
print('unparsed:', len(unparsed)); [print('  ', x) for x in unparsed[:40]]
