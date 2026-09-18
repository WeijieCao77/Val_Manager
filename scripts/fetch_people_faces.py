#!/usr/bin/env python3
"""
Faces for the people fetch_faces.py never reaches.

    python3 scripts/fetch_people_faces.py [--limit N]

fetch_faces.py walks the 2026 world by handle. This walks data-raw/people.json
by vlr id: everyone who only exists in a 2023–2025 world gets
public/faces/Hv<vlr id>.webp (the id build_world_year.py gives him), and a 2026
player who still has no picture gets his P-id file from whichever source
build_people.py found one at (vlr first, then The Spike).

Same shaping as fetch_faces.py (imported, not copied), one image a second,
skips what is on disk, records where each came from in
scripts/cache/people_faces.json so the credits can say so.
"""
from __future__ import annotations
import argparse, io, json, sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_faces as ff  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PEOPLE = ROOT / "data-raw" / "people.json"
REG = ROOT / "scripts" / "cache" / "people_registry.json"
LOG = ROOT / "scripts" / "cache" / "people_faces.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    people = json.loads(PEOPLE.read_text())
    reg = json.loads(REG.read_text())["people"]
    log = json.loads(LOG.read_text()) if LOG.exists() else {}
    jobs = []
    for vid, who in people.items():
        if not who.get("img"):
            continue
        years = reg.get(vid, {}).get("years", {})
        # the id the worlds give him: his P-id, else the H id of a past year
        # (Hv<vlr id>, or the named id of a listed homonym: H-zeek-562)
        pid = years["2026"]["id"] if "2026" in years else next((r["id"] for r in years.values()), f"Hv{vid}")
        dest = ff.OUT / f"{pid}.webp"
        if dest.exists() or (log.get(dest.name) or {}).get("url") == who["img"]:
            continue      # on disk, or already looked at and found to be a placeholder
        jobs.append((who["ign"], dest, who["img"], who.get("imgSrc")))
    print(f"{len(jobs)} faces to fetch", flush=True)
    n = bad = 0
    for ign, dest, url, src in jobs:
        try:
            im = Image.open(io.BytesIO(ff.get(url)))
            im.load()
            if ff.is_placeholder(im):
                print(f"  -- {ign}: a placeholder, not a face", flush=True); bad += 1
                log[dest.name] = {"placeholder": True, "url": url}
                continue
            shaped = ff.square(im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB"))
            shaped.save(dest, "WEBP", quality=ff.QUALITY, method=6)
            log[dest.name] = {"src": src, "url": url}
            n += 1
            print(f"  ok {ign:<16} {dest.name} ({src})", flush=True)
        except Exception as e:
            print(f"  !! {ign}: {e}", flush=True); bad += 1
        if a.limit and n >= a.limit:
            break
    LOG.write_text(json.dumps(log, ensure_ascii=False, indent=1))
    print(f"saved {n}, skipped {bad}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
