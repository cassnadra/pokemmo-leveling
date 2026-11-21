# Compares the game's own learnsets (pak_learnsets.json, tools/pak_learnsets.py) with MMO Showdown's (src_mmosd/).
# Run: python -I tools/compare_pak.py src_mmosd
import json, os, re, sys
sys.stdout.reconfigure(encoding='utf-8')
src = sys.argv[1]
def js(name):
    s = open(os.path.join(src, name + '.js'), encoding='utf-8').read()
    return json.loads(s[s.index('{'):s.rstrip().rstrip(';').rindex('}') + 1])
dex, learn, moves = js('pokedex'), js('learnsets'), js('moves')
num2move = {v['num']: k for k, v in moves.items() if v.get('num', 0) > 0}
for k, n in re.findall(r'[{,]([a-z0-9]+):\{num:(-?\d+),', open(os.path.join(src, 'moves_base.js'), encoding='utf-8').read()):
    num2move.setdefault(int(n), k)
pak = {int(k): v for k, v in json.load(open(os.path.join(src, 'pak_learnsets.json'))).items()}

def sd(key):   # MMO Showdown: {(move, level)}
    return {(m, int(s[2:])) for m, srcs in learn.get(key, {}).get('learnset', {}).items() for s in srcs if s.startswith('5L')}
def pk(sp):
    return {(num2move.get(m, f'?{m}'), lv) for m, lv in pak.get(sp, [])}

base = {v['num']: k for k, v in dex.items() if 1 <= v.get('num', 0) <= 649 and not v.get('forme')}
same = 0; diffs = []
for n in range(1, 650):
    a, b = pk(n), sd(base[n])
    if a == b: same += 1
    else: diffs.append((n, base[n], sorted(a - b), sorted(b - a)))
print(f'species 1-649: {same} identical, {len(diffs)} differ')
for n, k, ga, sa in diffs[:60]: print(f'  #{n} {k}: game only {ga}  showdown only {sa}')
unknown = sorted({m for v in pak.values() for m, _ in v if m not in num2move})
print('move numbers with no name:', unknown)

# the ids above 649: match them to MMO Showdown's forms by their moves
forms = {k: sd(k) for k, v in dex.items() if 1 <= v.get('num', 0) <= 649 and v.get('forme')}
print('ids above 649:')
for sp in sorted(pak):
    if sp <= 649: continue
    a = pk(sp); best = max(forms, key=lambda k: len(a & forms[k]) - len(a ^ forms[k]))
    print(f'  {sp}: {len(a)} moves; best form {best} ({"identical" if forms[best] == a else f"{len(a ^ forms[best])} differ"})')
