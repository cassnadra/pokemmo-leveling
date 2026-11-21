# Reads every species' exp group from the Pokemon Black ROM PokeMMO uses (personal data, a/0/1/6: one 0x4C-byte
# entry per species, growth rate at 0x15) - to check PokeAPI's exp groups against the game's own.
# Run: python -I tools/rom_growth.py ROM.nds out.json
import json, sys
import ndspy.rom, ndspy.narc

GROWTH = ['Medium Fast', 'Erratic', 'Fluctuating', 'Medium Slow', 'Fast', 'Slow']   # (the games' own order)
rom = ndspy.rom.NintendoDSRom.fromFile(sys.argv[1])
narc = ndspy.narc.NARC(rom.getFileByName('a/0/1/6'))
out = {}
for i, f in enumerate(narc.files):
    if 1 <= i <= 667 and len(f) > 0x15: out[i] = GROWTH[f[0x15]]
print(rom.name.decode(), len(narc.files), 'entries; #1', out[1], '#25', out[25], '#129', out[129], file=sys.stderr)
json.dump(out, open(sys.argv[2], 'w'))
