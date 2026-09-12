"""
Champions Seoul 2024 photographs onto the 首尔 2024 cards, in three steps so a
wrong face never reaches a card unseen.

    python3 scripts/seoul2024_faces.py download [--per 2]
    python3 scripts/seoul2024_faces.py sheet
    python3 scripts/seoul2024_faces.py crop

download  the first --per candidates of each player found by
          fetch_seoul2024_photos.py (Liquipedia commons, 800 px thumbnails),
          one file every 5 s, into scripts/cache/seoul2024_photos/; stops and
          keeps what it has on 403/429. Never load the candidates straight off
          Liquipedia in a browser: a page of thumbnails is dozens of requests.
sheet     face boxes for every downloaded file (scripts/face_boxes.swift) and a
          contact sheet at analysis/seoul_face_sheet.html to pick from.
crop      reads scripts/cache/seoul2024_face_picks.json
            { vlrId: { "local": <file in the photo cache>, "face": 0,
                       "source": <page>, "license": ..., "author": ... } }
          and writes a 400 px square per player, the face a third of the
          frame high and a fifth down from the top (where the card's portrait
          window wants it), to public/events/seoul-2024/event-<vlrId>.webp,
          plus src/data/seoul2024_faces.json for the engine and the credits.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FOUND = ROOT / "scripts" / "cache" / "seoul2024_photos.json"
PHOTOS = ROOT / "scripts" / "cache" / "seoul2024_photos"
BOXES = PHOTOS / "boxes.json"
PICKS = ROOT / "scripts" / "cache" / "seoul2024_face_picks.json"
SHEET = ROOT / "analysis" / "seoul_face_sheet.html"
OUT = ROOT / "public" / "events" / "seoul-2024"
FACES = ROOT / "src" / "data" / "seoul2024_faces.json"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact: yankejing711@gmail.com)"
INTERVAL = 5.0
SIDE, FACE_H, FACE_TOP = 400, 0.34, 0.20


def local_name(title: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", title.removeprefix("File:"))


def download(per: int) -> int:
    found = json.loads(FOUND.read_text("utf-8"))
    PHOTOS.mkdir(parents=True, exist_ok=True)
    todo = [(t, found["files"][t]) for v in found["players"].values() for t in v["files"][:per] if t in found["files"]]
    todo = [(t, f) for t, f in todo if not (PHOTOS / local_name(t)).exists() and (f.get("thumb") or f.get("url"))]
    print(f"{len(todo)} files to download (~{len(todo) * INTERVAL / 60:.0f} min)", flush=True)
    for i, (title, f) in enumerate(todo, 1):
        if i > 1:
            time.sleep(INTERVAL)
        req = urllib.request.Request(f.get("thumb") or f["url"], headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                (PHOTOS / local_name(title)).write_bytes(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"!! {e.code} on {title}; stopping with {i - 1} downloaded", file=sys.stderr)
                return 2
            print(f"   skip {title}: HTTP {e.code}", flush=True)
            continue
        if i % 10 == 0 or i == len(todo):
            print(f"  [{i}/{len(todo)}]", flush=True)
    return 0


def sheet() -> int:
    found = json.loads(FOUND.read_text("utf-8"))
    files = sorted(p for p in PHOTOS.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    run = subprocess.run(["swift", str(ROOT / "scripts" / "face_boxes.swift"), *map(str, files)], capture_output=True, text=True, check=True)
    boxes = {Path(json.loads(line)["path"]).name: json.loads(line) for line in run.stdout.splitlines() if line.startswith("{")}
    BOXES.write_text(json.dumps(boxes, indent=1), "utf-8")
    rows = []
    for vid, v in found["players"].items():
        cells = []
        for t in v["files"]:
            name = local_name(t)
            if name not in boxes:
                continue
            b = boxes[name]
            faces = " ".join(f'{int(x["w"])}px' for x in b.get("faces", []))
            cells.append(f'<figure><img src="../scripts/cache/seoul2024_photos/{name}" loading="lazy"><figcaption>{name}<br>{int(b["width"])}×{int(b["height"])} · faces {faces or "none"}</figcaption></figure>')
        rows.append(f'<section><h3>{v["team"]} {v["ign"]} <small>{vid}</small></h3>{"".join(cells) or "<p>no photo</p>"}</section>')
    SHEET.write_text('<meta charset="utf-8"><style>body{background:#111;color:#ddd;font:12px sans-serif}section{display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #333}h3{width:100%}figure{margin:0;width:260px}img{width:260px}</style>' + "".join(rows), "utf-8")
    print(f"{len(boxes)} files boxed; contact sheet at {SHEET.relative_to(ROOT)}", flush=True)
    return 0


def square(im: Image.Image, face: dict) -> Image.Image:
    w, h = im.size
    cx = face["x"] + face["w"] / 2
    side = min(face["h"] / FACE_H, w, h)
    left = min(max(0, cx - side / 2), w - side)
    top = min(max(0, face["y"] - FACE_TOP * side), h - side)
    return im.crop((round(left), round(top), round(left + side), round(top + side))).resize((SIDE, SIDE), Image.LANCZOS)


def crop() -> int:
    picks = json.loads(PICKS.read_text("utf-8"))
    boxes = json.loads(BOXES.read_text("utf-8"))
    faces = json.loads(FACES.read_text("utf-8")) if FACES.exists() else {}
    for vid, pick in picks.items():
        box = boxes[pick["local"]]["faces"][pick.get("face", 0)]
        im = Image.open(PHOTOS / pick["local"]).convert("RGB")
        square(im, box).save(OUT / f"event-{vid}.webp", "WEBP", quality=82)
        faces[vid] = {"face": f"/events/seoul-2024/event-{vid}.webp", **{k: pick.get(k) for k in ("source", "license", "author")}}
    FACES.write_text(json.dumps(faces, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{len(picks)} faces cropped; {len(faces)} in {FACES.relative_to(ROOT)}", flush=True)
    return 0


FLICKR_PICKS = ROOT / "scripts" / "cache" / "seoul2024_flickr_picks.json"


def flickr() -> int:
    """Riot's Features Day frames for the players picked by caption, into crop picks.

    scripts/cache/seoul2024_flickr_picks.json holds { vlrId: { "id": <photo>, "ign": ...,
    "names": [igns left to right as the caption names them] } }. Each frame comes down
    at 1024 px (oEmbed gives the URL), 2 s apart; a solo frame takes its largest face,
    a group frame keeps as many of the largest faces as the caption names and reads
    them left to right. A frame whose faces cannot be matched is listed, not guessed.
    """
    chosen = json.loads(FLICKR_PICKS.read_text("utf-8"))
    PHOTOS.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for p in chosen.values():
        local = PHOTOS / f"flickr-{p['id']}.jpg"
        if local.exists():
            continue
        page = f"https://www.flickr.com/photos/valorantesports/{p['id']}/"
        for url in ("https://www.flickr.com/services/oembed/?format=json&url=" + urllib.parse.quote(page, safe=""), None):
            if fetched:
                time.sleep(2.0)
            fetched += 1
            with urllib.request.urlopen(urllib.request.Request(url or image, headers={"User-Agent": UA}), timeout=30) as r:
                body = r.read()
            if url:
                image = json.loads(body)["url"]
            else:
                local.write_bytes(body)
    files = [PHOTOS / f"flickr-{p['id']}.jpg" for p in chosen.values()]
    run = subprocess.run(["swift", str(ROOT / "scripts" / "face_boxes.swift"), *map(str, files)], capture_output=True, text=True, check=True)
    boxes = json.loads(BOXES.read_text("utf-8")) if BOXES.exists() else {}
    boxes.update({Path(json.loads(line)["path"]).name: json.loads(line) for line in run.stdout.splitlines() if line.startswith("{")})
    BOXES.write_text(json.dumps(boxes, indent=1), "utf-8")
    picks = json.loads(PICKS.read_text("utf-8")) if PICKS.exists() else {}
    unsure = []
    for vid, p in chosen.items():
        name = f"flickr-{p['id']}.jpg"
        faces = boxes[name].get("faces", [])
        names = p.get("names") or [p["ign"]]
        biggest = sorted(sorted(range(len(faces)), key=lambda k: -faces[k]["w"])[:len(names)], key=lambda k: faces[k]["x"])
        if len(biggest) < len(names):
            unsure.append(f"{p['ign']} ({len(faces)} faces, {len(names)} named)")
            continue
        picks[vid] = {"local": name, "face": faces.index(faces[biggest[names.index(p["ign"])]]) if len(names) > 1 else 0,
                      "source": f"https://www.flickr.com/photos/valorantesports/{p['id']}/",
                      "license": "All Rights Reserved (Riot Games)", "author": "Riot Games"}
    PICKS.write_text(json.dumps(picks, ensure_ascii=False, indent=1), "utf-8")
    print(f"{len(chosen) - len(unsure)} Flickr frames ready to crop; unsure: {', '.join(unsure) or 'none'}", flush=True)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    per = int(sys.argv[sys.argv.index("--per") + 1]) if "--per" in sys.argv else 2
    sys.exit({"download": lambda: download(per), "sheet": sheet, "crop": crop, "flickr": flickr}.get(cmd, lambda: print(__doc__) or 1)())
