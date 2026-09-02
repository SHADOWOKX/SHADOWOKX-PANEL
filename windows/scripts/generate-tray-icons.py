"""Regenerate the dedicated multi-size tray ICO assets (requires Pillow)."""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "ShadowokxPanel" / "Assets" / "Tray"
SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (48, 48)]


def icon(color: str, destination: Path) -> None:
    scale = 4
    size = 48 * scale
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = 4 * scale
    draw.ellipse((inset, inset, size - inset - 1, size - inset - 1), fill=color)
    white = (250, 250, 249, 255)
    ring = (15 * scale, 15 * scale, 33 * scale, 33 * scale)
    draw.ellipse(ring, outline=white, width=3 * scale)
    draw.rounded_rectangle(
        (22 * scale, 10 * scale, 26 * scale, 38 * scale),
        radius=2 * scale,
        fill=white,
    )
    image.save(destination, format="ICO", sizes=SIZES, bitmap_format="bmp")


OUTPUT.mkdir(parents=True, exist_ok=True)
icon("#f43f5e", OUTPUT / "shadowokx-tray.ico")
icon("#3b82f6", OUTPUT / "shadowokx-tray-idle.ico")
icon("#f97316", OUTPUT / "shadowokx-tray-peak.ico")
