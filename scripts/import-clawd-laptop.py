"""Convert the original Clawd Laptop Lottie rectangles to bundled SVG frames.

Usage: python3 scripts/import-clawd-laptop.py Clawd-Laptop.lottie.json
No Lottie renderer or network access is needed at runtime.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

source = Path(sys.argv[1])
document = json.loads(source.read_text())
output = Path(__file__).resolve().parents[1] / 'icons/mascot/octopus'
groups = []
for layer in reversed(document['layers']):
    for group in layer['shapes']:
        items = group.get('it', [])
        fill = next((item for item in items if item['ty'] == 'fl'), None)
        if not fill:
            continue
        color = '#%02x%02x%02x' % tuple(round(value * 255) for value in fill['c']['k'][:3])
        rectangles = []
        for item in items:
            if item['ty'] == 'sh':
                vertices = item['ks']['k']['v']
                xs, ys = zip(*vertices)
                rectangles.append((min(xs), min(ys), max(xs), max(ys)))
        groups.append((color, fill.get('o', {'a': 0, 'k': 100}), rectangles))

sequence, signatures = [], []
for frame in range(int(document['ip']), int(document['op'])):
    cells = {}
    for color, opacity, rectangles in groups:
        if opacity['a'] == 0:
            visible = opacity['k']
        else:
            visible = 0
            for key in opacity['k']:
                if key['t'] <= frame and 's' in key:
                    visible = key['s'][0]
        if visible <= 50:
            continue
        for left, top, right, bottom in rectangles:
            for y in range(math.ceil((top - 25) / 50), math.ceil((bottom - 25) / 50)):
                for x in range(math.ceil((left - 25) / 50), math.ceil((right - 25) / 50)):
                    cells[(x, y)] = color
    paths = {}
    for (x, y), color in sorted(cells.items()):
        paths.setdefault(color, []).append(f'M{x} {y}h1v1h-1z')
    body = ''.join(f'<path fill="{color}" d="{"".join(rects)}"/>' for color, rects in paths.items())
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="14 13 36 25" shape-rendering="crispEdges">' + body + '</svg>\n'
    name = f'laptop-{frame:02}.svg'
    (output / name).write_text(svg)
    duration = round((frame + 1) * 1000 / document['fr']) - round(frame * 1000 / document['fr'])
    sequence.append([name, duration])
    signatures.append(hashlib.sha256(body.encode()).hexdigest()[:8])

manifest_path = output / 'animations.json'
manifest = json.loads(manifest_path.read_text())
manifest['sources']['Laptop'] = {
    'file': 'Clawd-Laptop.lottie.json',
    'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'archive': 'https://github.com/HermannBjorgvin/Clawdmeter/blob/main/research/clawd-official/Clawd-Laptop.lottie.json',
}
manifest['workFull'] = sequence
manifest['workIntro'] = sequence[:17]
manifest['workLoop'] = sequence[17:20]
manifest['workOutro'] = sequence[33:]
manifest['complete'] = manifest['active'][1]
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(list(enumerate(signatures)))
