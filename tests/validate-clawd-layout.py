"""Check that all vector frames stay centered and fit the fixed panel icon."""
from pathlib import Path
import re

frames = Path(__file__).resolve().parents[1] / 'icons' / 'mascot' / 'octopus'
count = 0
for path in frames.glob('*.svg'):
    source = path.read_text()
    x0, y0, width, height = map(float, re.search(r'viewBox="([^"]+)"', source).group(1).split())
    bounds = []
    for attrs, commands in re.findall(r'<path([^>]*?) d="([^"]+)"', source):
        transform = re.search(r'translate\(([-\d.]+) ([-\d.]+)\)', attrs)
        dx, dy = map(float, transform.groups()) if transform else (0, 0)
        for x, y, w, h in re.findall(r'M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)', commands):
            x, y, w, h = map(float, (x, y, w, h))
            bounds.append((x + dx, y + dy, x + w + dx, y + h + dy))
    assert bounds, f'{path.name}: no visible vector cells'
    left, top = min(b[0] for b in bounds), min(b[1] for b in bounds)
    right, bottom = max(b[2] for b in bounds), max(b[3] for b in bounds)
    assert abs((left + right) / 2 - (x0 + width / 2)) < .001, f'{path.name}: off-center horizontally'
    assert abs((top + bottom) / 2 - (y0 + height / 2)) < .001, f'{path.name}: off-center vertically'
    assert left >= x0 and right <= x0 + width and top >= y0 and bottom <= y0 + height, f'{path.name}: clipped artwork'
    count += 1
print(f'Clawd layout passed ({count} centered frames without clipping)')
