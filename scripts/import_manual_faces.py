"""Bring in a face that was found by hand rather than by the picker.

Two of the twenty彩卡 had nothing on the night in Liquipedia — Liquipedia only
had white-background studio portraits of nAts and Neon — so the owner went and
found the trophy shots himself. This puts them through the same crop and
compression as everything else so they sit correctly on a card, and records
where each one came from.

    python3 scripts/import_manual_faces.py ~/Downloads/xxx.jpg L:nats-berlin-2021
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "faces"
MANIFEST = ROOT / "scripts" / "cache" / "manual_faces.json"

# Legends are drawn as the card's whole background now, so they are kept as a
# portrait at card proportions rather than as the square a round avatar needs.
W, H = 360, 500
QUALITY = 82


def portrait(im: Image.Image) -> Image.Image:
    """Crop to the card's shape, keeping the middle and favouring the top."""
    want = W / H
    w, h = im.size
    if w / h > want:
        # too wide: take a centre column
        new_w = int(h * want)
        x = (w - new_w) // 2
        im = im.crop((x, 0, x + new_w, h))
    else:
        # too tall: take from the top third, where a standing figure's head is
        new_h = int(w / want)
        y = min(int(h * 0.08), max(0, h - new_h))
        im = im.crop((0, y, w, y + new_h))
    return im.resize((W, H), Image.LANCZOS)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src = Path(sys.argv[1]).expanduser()
    legend_id = sys.argv[2]
    if not src.exists():
        print(f"no such file: {src}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    name = "l-" + legend_id.split(":", 1)[-1].lower().replace(":", "-") + ".webp"
    dest = OUT / name
    im = Image.open(src).convert("RGB")
    portrait(im).save(dest, "WEBP", quality=QUALITY, method=6)

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    manifest[legend_id] = {"file": name, "source": src.name, "by": "manual"}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"{legend_id}: {src.name} → {name}  {dest.stat().st_size / 1024:.1f}KB  {W}x{H}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
