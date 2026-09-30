"""
Masters Bangkok Features Day photographs onto the 曼谷 2025 cards —
seoul2024_faces.py's Flickr route, for event 2281.

    python3 scripts/bangkok2025_faces.py download   # every candidate frame, 1024 px, 2 s apart
    python3 scripts/bangkok2025_faces.py sheet      # face boxes + analysis/bangkok_face_sheet.html
    python3 scripts/bangkok2025_faces.py crop       # the picks → public/events/bangkok-2025/event-<vlrId>.webp

Candidates: scripts/cache/bangkok2025_flickr_candidates.json ({ vlrId: { ign, ids } }),
every frame whose Riot caption names exactly that player. The pick per player
is a frame with exactly one clear face (the face detector only finds
faces; it never says whose). `sure` is false, with the reason, when a
player's frames don't all show one person, or when no frame is clean —
captions have been wrong before (seoul2024_flickr_picks.json), and a
frame's identity is for the owner's eye, never a face match.
The frame taken furthest from any other player's frame is preferred, and a
pick within NEAR seconds of one — and nearer to it than to his own other
frames — is marked unsure — Riot's batch
captions went wrong exactly that way at Seoul.
Overrides by hand: scripts/cache/bangkok2025_face_picks.json
({ vlrId: { "id": <photo>, "confirmed": true, "note": ... } }) wins over the automatic pick;
`confirmed` is the owner having looked at the frame, which settles `sure`.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CANDS = ROOT / "scripts" / "cache" / "bangkok2025_flickr_candidates.json"
PICKS = ROOT / "scripts" / "cache" / "bangkok2025_face_picks.json"
PHOTOS = ROOT / "scripts" / "cache" / "bangkok2025_photos"
BOXES = PHOTOS / "boxes.json"
URLS = PHOTOS / "urls.json"
# each frame's date taken off its Flickr page: a frame shot seconds from another player's may carry his caption
TAKEN = PHOTOS / "taken.json"
NEAR = 90
SHEET = ROOT / "analysis" / "bangkok_face_sheet.html"
OUT = ROOT / "public" / "events" / "bangkok-2025"
FACES = ROOT / "src" / "data" / "bangkok2025_faces.json"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact: yankejing711@gmail.com)"
INTERVAL = 2.0
# the card's photo window is about square (bk25-photo: inset 13% 4% 23% of a 63:88 card);
# a half-length portrait: the face a quarter of the frame high, its top 17% down
SIDE, FACE_H, FACE_TOP = 640, 0.25, 0.17
# a second face this large next to the biggest one means a second person in the frame
CROWD = 0.45


def candidates() -> dict:
    c = json.loads(CANDS.read_text("utf-8"))
    c.pop("_README", None)
    return c


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        return r.read()


def download() -> int:
    PHOTOS.mkdir(parents=True, exist_ok=True)
    urls = json.loads(URLS.read_text("utf-8")) if URLS.exists() else {}
    todo = [i for v in candidates().values() for i in v["ids"] if not (PHOTOS / f"flickr-{i}.jpg").exists()]
    print(f"{len(todo)} frames to fetch (~{len(todo) * 2 * INTERVAL / 60:.0f} min)", flush=True)
    first = True
    for n, pid in enumerate(todo, 1):
        page = f"https://www.flickr.com/photos/valorantesports/{pid}/"
        try:
            if pid not in urls:
                if not first:
                    time.sleep(INTERVAL)
                first = False
                meta = json.loads(get("https://www.flickr.com/services/oembed/?format=json&url=" + urllib.parse.quote(page, safe="")))
                urls[pid] = {"url": meta["url"], "w": meta.get("width"), "h": meta.get("height"), "license": meta.get("license"), "author": meta.get("author_name")}
                URLS.write_text(json.dumps(urls, indent=1), "utf-8")
            time.sleep(INTERVAL)
            (PHOTOS / f"flickr-{pid}.jpg").write_bytes(get(urls[pid]["url"]))
        except urllib.error.HTTPError as e:
            print(f"!! HTTP {e.code} on {pid}; stopping, {n - 1} done", file=sys.stderr)
            return 2
        if n % 10 == 0 or n == len(todo):
            print(f"  [{n}/{len(todo)}]", flush=True)
    return 0


def faces_of(name: str, boxes: dict) -> list[dict]:
    return sorted(boxes.get(name, {}).get("faces", []), key=lambda f: -f["w"])


def verdict(name: str, boxes: dict) -> str | None:
    """None for a frame with one clear face; otherwise why not."""
    fs = faces_of(name, boxes)
    if not fs:
        return "没有检测到人脸"
    if len(fs) > 1 and fs[1]["w"] >= CROWD * fs[0]["w"]:
        return f"画面里有 {sum(1 for f in fs if f['w'] >= CROWD * fs[0]['w'])} 张明显的人脸"
    return None


def sheet() -> int:
    files = sorted(PHOTOS.glob("flickr-*.jpg"))
    run = subprocess.run(["swift", str(ROOT / "scripts" / "face_boxes.swift"), *map(str, files)], capture_output=True, text=True, check=True)
    boxes = {Path(json.loads(line)["path"]).name: json.loads(line) for line in run.stdout.splitlines() if line.startswith("{")}
    BOXES.write_text(json.dumps(boxes, indent=1), "utf-8")
    rows = []
    for vid, v in candidates().items():
        cells = []
        for pid in v["ids"]:
            name = f"flickr-{pid}.jpg"
            why = verdict(name, boxes) if name in boxes else "未下载"
            cells.append(f'<figure><img src="../scripts/cache/bangkok2025_photos/{name}" loading="lazy"><figcaption>{pid} · {why or "单人"}</figcaption></figure>')
        rows.append(f'<section><h3>{v["ign"]} <small>{vid}</small></h3>{"".join(cells)}</section>')
    SHEET.write_text('<meta charset="utf-8"><style>body{background:#111;color:#ddd;font:12px sans-serif}section{display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #333}h3{width:100%}figure{margin:0;width:220px}img{width:220px}</style>' + "".join(rows), "utf-8")
    print(f"{len(boxes)} frames boxed; contact sheet at {SHEET.relative_to(ROOT)}", flush=True)
    return 0


def square(im: Image.Image, face: dict) -> Image.Image:
    w, h = im.size
    cx = face["x"] + face["w"] / 2
    side = min(face["h"] / FACE_H, w, h)
    left = min(max(0, cx - side / 2), w - side)
    top = min(max(0, face["y"] - FACE_TOP * side), h - side)
    return im.crop((round(left), round(top), round(left + side), round(top + side))).resize((SIDE, SIDE), Image.LANCZOS)


def crop() -> int:
    boxes = json.loads(BOXES.read_text("utf-8"))
    urls = json.loads(URLS.read_text("utf-8"))
    hand = json.loads(PICKS.read_text("utf-8")) if PICKS.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    out, unsure = {}, []
    cands = candidates()
    taken = {k: datetime.strptime(v, "%Y-%m-%d %H:%M:%S") for k, v in json.loads(TAKEN.read_text("utf-8")).items()}
    owner = {pid: vid for vid, v in cands.items() for pid in v["ids"]}

    def gap(pid: str) -> tuple[float, str]:
        """seconds to the nearest frame captioned as someone else, and whose"""
        return min(((abs((taken[pid] - taken[q]).total_seconds()), cands[owner[q]]["ign"]) for q in taken if owner.get(q) != owner[pid]), default=(1e9, ""))

    def own(pid: str) -> float:
        """seconds to the nearest other frame captioned as the same player"""
        return min((abs((taken[pid] - taken[q]).total_seconds()) for q in cands[owner[pid]]["ids"] if q != pid and q in taken), default=1e9)

    for vid, v in cands.items():
        verdicts = {pid: verdict(f"flickr-{pid}.jpg", boxes) for pid in v["ids"]}
        clean = sorted((pid for pid, why in verdicts.items() if why is None), key=lambda q: -gap(q)[0])
        pid = hand.get(vid, {}).get("id") or (clean[0] if clean else v["ids"][0])
        notes = []
        near, other = gap(pid)
        confirmed = bool(hand.get(vid, {}).get("confirmed"))
        # inside his own session (his other frame is nearer than anyone else's) is where a frame belongs
        doubtful = near < NEAR and near < own(pid)
        if doubtful and not confirmed:
            notes.append(f"这张和写着 {other} 的照片只隔 {int(near)} 秒拍，可能是同一组照片里说明写串了")
        if v.get("caption"):
            notes.append(f"Riot 的说明写作「{v['caption']}」")
        if not clean:
            notes.append("候选照片都不是干净的单人照：" + "；".join(f"{p} {w}" for p, w in verdicts.items()))
        elif len(v["ids"]) < 2:
            notes.append("只有一张写着他名字的照片")
        if hand.get(vid, {}).get("note"):
            notes.append(hand[vid]["note"])
        sure = confirmed or (bool(clean) and verdicts.get(pid) is None and not doubtful and not hand.get(vid, {}).get("unsure"))
        fs = faces_of(f"flickr-{pid}.jpg", boxes)
        im = Image.open(PHOTOS / f"flickr-{pid}.jpg").convert("RGB")
        if fs:
            square(im, fs[0]).save(OUT / f"event-{vid}.webp", "WEBP", quality=84)
        else:
            s = min(im.size)
            im.crop(((im.width - s) // 2, 0, (im.width + s) // 2, s)).resize((SIDE, SIDE), Image.LANCZOS).save(OUT / f"event-{vid}.webp", "WEBP", quality=84)
        out[vid] = {"face": f"/events/bangkok-2025/event-{vid}.webp", "ign": v["ign"], "photo": pid, "taken": taken[pid].isoformat(), "sure": sure, "confirmed": confirmed,
                    "note": "；".join(notes) or None,
                    "source": f"https://www.flickr.com/photos/valorantesports/{pid}/",
                    "license": "All Rights Reserved (Riot Games)", "author": urls.get(pid, {}).get("author") or "Riot Games"}
        if not sure:
            unsure.append(v["ign"])
    FACES.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{len(out)} faces cropped; unsure: {', '.join(unsure) or 'none'}", flush=True)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"download": download, "sheet": sheet, "crop": crop}.get(cmd, lambda: print(__doc__) or 1)())
