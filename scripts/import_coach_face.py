"""
Bring in a coach's photo that the owner supplied by hand.

    python3 scripts/import_coach_face.py ~/Downloads/ed101.jpg ED101 --box 290,0,660

Squared and compressed exactly like the scraped faces (fetch_faces.square), so
it sits in the same round avatar. A studio shot framed to the waist leaves the
head a few pixels wide once it is shrunk beside a name, so `--box left,top,side`
(source pixels) takes the head-and-shoulders square by hand first.

Written to public/faces/c-<slug>.webp, recorded in scripts/cache/manual_faces.json
under "C:<name>" (box included) so a later fetch_faces --refresh leaves it
alone, and build_dossier is run so the dossier carries the file and its stamp.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_faces import OUT, QUALITY, coach_file, square  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts" / "cache" / "manual_faces.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("name", help="the coach's name as world.json spells it")
    ap.add_argument("--box", default="", help="left,top,side of the square to keep, in source pixels")
    args = ap.parse_args()
    src, name = Path(args.src).expanduser(), args.name
    if not src.exists():
        print(f"no such file: {src}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / coach_file(name)
    im = Image.open(src).convert("RGBA")
    entry: dict = {"file": dest.name, "source": src.name, "by": "manual"}
    if args.box:
        left, top, side = (int(v) for v in args.box.split(","))
        im = im.crop((left, top, left + side, top + side))
        entry["box"] = [left, top, side]
    square(im).save(dest, "WEBP", quality=QUALITY, method=6)
    manifest = json.loads(MANIFEST.read_text("utf-8")) if MANIFEST.exists() else {}
    manifest[f"C:{name}"] = entry
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{name} -> {dest.relative_to(ROOT)} ({dest.stat().st_size / 1024:.1f} KB)")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_dossier.py")], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
