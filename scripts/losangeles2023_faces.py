"""
Champions Los Angeles 2023 Features Day photographs onto the 洛杉矶 2023 cards —
bangkok2025_faces.py's Flickr route, for vlr event 1657.

    python3 scripts/losangeles2023_faces.py search    # captions off Riot's Flickr search pages, 2 s apart → candidates
    python3 scripts/losangeles2023_faces.py taken     # each candidate frame's date taken (photo page), 2 s apart
    python3 scripts/losangeles2023_faces.py download  # every candidate frame, 1024 px, 2 s apart
    python3 scripts/losangeles2023_faces.py sheet     # face boxes + analysis/losangeles_face_sheet.html
    python3 scripts/losangeles2023_faces.py crop      # the picks → public/events/los-angeles-2023/event-<vlrId>.webp

Candidates (scripts/cache/losangeles2023_flickr_candidates.json, { vlrId: { ign, ids, pairs } }) are frames
whose Riot caption names exactly that player; a player with fewer than two such frames also gets the frames
captioned as him and one teammate, with the side the caption puts him on ("(L)" names the left one first).
T1 had no Features Day session, so T1's frames are the posed 5 August Shrine Expo Hall set
("… of T1 at VALORANT Champions Los Angeles Group Stage …", no competes/arrives/reacts).

Captions are not proof of who is pictured (seoul2024_flickr_picks.json). The pick is a frame with one clear
face (two for a pair frame); the face detector only finds faces, it never says whose. The frame taken
furthest from any other player's frame is preferred, and a pick within NEAR seconds of one — and nearer to
it than to his own other frames — is marked unsure, as on 曼谷. A pair frame is always unsure.
Overrides by hand: scripts/cache/losangeles2023_face_picks.json
({ vlrId: { "id": <photo>, "side": "L"|"R"?, "confirmed": true, "note": ... } }).
"""
from __future__ import annotations

import html as htmllib
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data" / "losangeles2023.json"
CANDS = ROOT / "scripts" / "cache" / "losangeles2023_flickr_candidates.json"
PICKS = ROOT / "scripts" / "cache" / "losangeles2023_face_picks.json"
PHOTOS = ROOT / "scripts" / "cache" / "losangeles2023_photos"
BOXES = PHOTOS / "boxes.json"
URLS = PHOTOS / "urls.json"
TAKEN = PHOTOS / "taken.json"
NEAR = 90
SHEET = ROOT / "analysis" / "losangeles_face_sheet.html"
OUT = ROOT / "public" / "events" / "los-angeles-2023"
FACES = ROOT / "src" / "data" / "losangeles2023_faces.json"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact: yankejing711@gmail.com)"
INTERVAL = 2.0
SIDE, FACE_H, FACE_TOP = 640, 0.25, 0.17
CROWD = 0.45
SOLO_MAX = 5
SEARCH = "https://www.flickr.com/search/?user_id=valorantesports&view_all=1&text="
TEAM_QUERY = {
    "EG": "Evil Geniuses", "PRX": "Paper Rex", "LOUD": "LOUD", "FNC": "FNATIC", "DRX": "DRX", "EDG": "EDward Gaming",
    "BLG": "Bilibili Gaming", "FUT": "FUT Esports", "NAVI": "Natus Vincere", "NRG": "NRG", "GIA": "Giants",
    "TL": "Team Liquid", "FPX": "FunPlus Phoenix", "KRÜ": "KRÜ", "ZETA": "ZETA DIVISION",
}
T1_QUERIES = ["VALORANT Champions Los Angeles T1 " + n for n in ("Sayaplayer", "xeta", "Munchkin", "carpe", "ban")]
# how Riot's captions spell a handle, when it differs (rin is DK — Li Lewei, vlr 3024 — under his 2023 name)
ALIAS = {"fns": "finesse", "whz": "whzy", "tzh": "nizhaotzh", "fitlnho": "fit1nho", "rin": "dk", "com": "c0m", "forsaken": "f0rsaken", "atakaptan": "atakaptan"}
NOT_PLAYERS = {"autumn", "tombizz", "aevilcat", "stunner", "potter", "pipson"}


def norm(s: str) -> str:
    s = re.sub(r"[^a-z0-9]", "", s.lower())
    return ALIAS.get(s, s)


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        return r.read()


def roster() -> dict[str, str]:
    """normalised handle → vlr id, both the printed handle and vlr's"""
    out = {}
    for p in json.loads(DATA.read_text("utf-8"))["players"]:
        out[norm(p["ign"])] = p["vlrId"]
        out[norm(p["profile"].rsplit("/", 1)[-1])] = p["vlrId"]
    return out


def parse(page: str) -> list[dict]:
    out = []
    for part in page.split('"_flickrModelRegistry":"photo-lite-models"')[1:]:
        d = re.search(r'"description":"((?:[^"\\]|\\.)*)"', part)
        pid = re.search(r'"id":"(\d{9,12})"', part)
        if not (d and pid):
            continue
        sizes = {m[0]: ("https:" + m[1].replace("\\/", "/"), int(m[2]), int(m[3]))
                 for m in re.findall(r'"(b|c|z)":\{"data":\{"displayUrl":"([^"]+)","width":(\d+),"height":(\d+)', part)}
        out.append({"id": pid.group(1), "desc": htmllib.unescape(json.loads(f'"{d.group(1)}"')), "size": sizes.get("b") or sizes.get("c") or sizes.get("z")})
    return out


def search() -> int:
    seen: dict[str, dict] = {}
    queries = [(f"Champions Los Angeles Features Day {q}", 6) for q in TEAM_QUERY.values()] + [(q, 1) for q in T1_QUERIES]
    first = True
    for q, pages in queries:
        for page in range(1, pages + 1):
            if not first:
                time.sleep(INTERVAL)
            first = False
            try:
                found = parse(get(SEARCH + urllib.parse.quote(q) + f"&page={page}").decode("utf-8"))
            except urllib.error.HTTPError as e:
                print(f"!! HTTP {e.code} on {q} p{page}; stopping", file=sys.stderr)
                return 2
            fresh = [f for f in found if f["id"] not in seen]
            for f in fresh:
                seen[f["id"]] = f
            print(f"  {q} p{page}: {len(found)} ({len(fresh)} new)", flush=True)
            if len(found) < 20 or not fresh:
                break
    who = roster()
    cands: dict[str, dict] = {}
    urls = json.loads(URLS.read_text("utf-8")) if URLS.exists() else {}
    for f in seen.values():
        d = f["desc"]
        t1 = " of T1" in d
        if t1:
            if "at VALORANT Champions Los Angeles Group Stage at the Shrine Expo Hall on August 5" not in d:
                continue
            if re.search(r"\((L|R)\)|competes|arrives|walks|react|poses with|speaks|huddles|is seen", d):
                continue
        elif "Features Day" not in d:
            continue
        names = [n for n in re.findall(r'"([^"”]+)[”"]', d) if norm(n) not in NOT_PLAYERS]
        ids = [who.get(norm(n)) for n in names]
        if not f["size"]:
            continue
        if len(ids) == 1 and ids[0]:
            cands.setdefault(ids[0], {"solo": [], "pairs": []})["solo"].append(f)
        elif len(ids) == 2 and all(ids) and "(L)" in d:
            for vid, side in zip(ids, "LR"):
                cands.setdefault(vid, {"solo": [], "pairs": []})["pairs"].append({**f, "side": side})
    out = {"_README": "Riot's Champions Los Angeles Features Day (2023-08-02..04) frames whose caption names exactly one player "
                      "(`ids`), or him and one teammate with his side (`pairs`, only when fewer than two solo frames); T1's are the "
                      "posed 5 August group-stage set. Read off flickr.com/photos/valorantesports search pages, 2026-10-18. "
                      "Captions are not proof of who is pictured (see seoul2024_flickr_picks.json)."}
    by_id = {p["vlrId"]: p for p in json.loads(DATA.read_text("utf-8"))["players"]}
    for vid, p in by_id.items():
        c = cands.get(vid, {"solo": [], "pairs": []})
        solo = sorted(c["solo"], key=lambda f: (f["size"][2] <= f["size"][1], f["id"]))[:SOLO_MAX]
        pairs = c["pairs"][: max(0, 4 - len(solo))] if len(solo) < 2 else []
        for f in solo + pairs:
            urls[f["id"]] = {"url": f["size"][0], "w": f["size"][1], "h": f["size"][2], "license": "All Rights Reserved",
                             "author": "VALORANT Champions Tour Photos", "caption": f["desc"].strip()}
        out[vid] = {"ign": p["ign"], "ids": [f["id"] for f in solo], "pairs": [[f["id"], f["side"]] for f in pairs]}
        if not solo and not pairs:
            print(f"!! no frame for {p['ign']}", file=sys.stderr)
    PHOTOS.mkdir(parents=True, exist_ok=True)
    URLS.write_text(json.dumps(urls, indent=1, ensure_ascii=False), "utf-8")
    CANDS.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{len(seen)} captioned frames; candidates for {sum(1 for k, v in out.items() if k != '_README' and (v['ids'] or v['pairs']))}/80", flush=True)
    return 0


def candidates() -> dict:
    c = json.loads(CANDS.read_text("utf-8"))
    c.pop("_README", None)
    return c


def frames(v: dict) -> list[str]:
    return v["ids"] + [p for p, _ in v["pairs"]]


def taken() -> int:
    t = json.loads(TAKEN.read_text("utf-8")) if TAKEN.exists() else {}
    todo = [i for v in candidates().values() for i in frames(v) if i not in t]
    print(f"{len(todo)} frames to date (~{len(todo) * INTERVAL / 60:.0f} min)", flush=True)
    for n, pid in enumerate(todo, 1):
        if n > 1:
            time.sleep(INTERVAL)
        try:
            m = re.search(r'"dateTaken":"([^"]+)"', get(f"https://www.flickr.com/photos/valorantesports/{pid}/").decode("utf-8"))
        except urllib.error.HTTPError as e:
            print(f"!! HTTP {e.code} on {pid}; stopping", file=sys.stderr)
            return 2
        t[pid] = m.group(1) if m else None
        TAKEN.write_text(json.dumps(t), "utf-8")
        if n % 20 == 0:
            print(f"  [{n}/{len(todo)}]", flush=True)
    return 0


def download() -> int:
    urls = json.loads(URLS.read_text("utf-8"))
    todo = [i for v in candidates().values() for i in frames(v) if not (PHOTOS / f"flickr-{i}.jpg").exists()]
    print(f"{len(todo)} frames to fetch (~{len(todo) * INTERVAL / 60:.0f} min)", flush=True)
    for n, pid in enumerate(todo, 1):
        if n > 1:
            time.sleep(INTERVAL)
        try:
            (PHOTOS / f"flickr-{pid}.jpg").write_bytes(get(urls[pid]["url"]))
        except urllib.error.HTTPError as e:
            print(f"!! HTTP {e.code} on {pid}; stopping, {n - 1} done", file=sys.stderr)
            return 2
        if n % 20 == 0:
            print(f"  [{n}/{len(todo)}]", flush=True)
    return 0


def faces_of(name: str, boxes: dict) -> list[dict]:
    return sorted(boxes.get(name, {}).get("faces", []), key=lambda f: -f["w"])


def clear(name: str, boxes: dict) -> list[dict]:
    fs = faces_of(name, boxes)
    return [f for f in fs if f["w"] >= CROWD * fs[0]["w"]] if fs else []


def verdict(name: str, boxes: dict, want: int = 1) -> str | None:
    """None for a frame with `want` clear faces; otherwise why not."""
    fs = clear(name, boxes)
    if not fs:
        return "没有检测到人脸"
    if len(fs) != want:
        return f"画面里有 {len(fs)} 张明显的人脸"
    return None


def sheet() -> int:
    files = sorted(PHOTOS.glob("flickr-*.jpg"))
    run = subprocess.run(["swift", str(ROOT / "scripts" / "face_boxes.swift"), *map(str, files)], capture_output=True, text=True, check=True)
    boxes = {Path(json.loads(line)["path"]).name: json.loads(line) for line in run.stdout.splitlines() if line.startswith("{")}
    BOXES.write_text(json.dumps(boxes, indent=1), "utf-8")
    rows = []
    for vid, v in candidates().items():
        cells = []
        for pid, side in [(p, None) for p in v["ids"]] + [tuple(x) for x in v["pairs"]]:
            name = f"flickr-{pid}.jpg"
            why = verdict(name, boxes, 2 if side else 1) if name in boxes else "未下载"
            tag = f"双人·{side}" if side else "单人"
            cells.append(f'<figure><img src="../scripts/cache/losangeles2023_photos/{name}" loading="lazy"><figcaption>{pid} · {tag} · {why or "可用"}</figcaption></figure>')
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
    hand.pop("_README", None)
    OUT.mkdir(parents=True, exist_ok=True)
    out, unsure = {}, []
    cands = candidates()
    taken_at = {k: datetime.strptime(v, "%Y-%m-%d %H:%M:%S") for k, v in json.loads(TAKEN.read_text("utf-8")).items() if v}
    owner: dict[str, set] = {}
    for vid, v in cands.items():
        for pid in frames(v):
            owner.setdefault(pid, set()).add(vid)

    def gap(pid: str, vid: str) -> tuple[float, str]:
        """seconds to the nearest frame captioned as someone else (not shared with him), and whose"""
        if pid not in taken_at:
            return (1e9, "")
        return min(((abs((taken_at[pid] - taken_at[q]).total_seconds()), cands[next(iter(owner[q] - {vid}))]["ign"])
                    for q in taken_at if q in owner and vid not in owner[q]), default=(1e9, ""))

    def own(pid: str, vid: str) -> float:
        if pid not in taken_at:
            return 1e9
        return min((abs((taken_at[pid] - taken_at[q]).total_seconds()) for q in frames(cands[vid]) if q != pid and q in taken_at), default=1e9)

    for vid, v in cands.items():
        sides = {p: s for p, s in v["pairs"]}
        options = frames(v)
        if not options and vid not in hand:
            continue
        verdicts = {pid: verdict(f"flickr-{pid}.jpg", boxes, 2 if pid in sides else 1) for pid in options}
        clean = sorted((pid for pid in options if verdicts[pid] is None), key=lambda q: (q in sides, -gap(q, vid)[0]))
        h = hand.get(vid, {})
        pid = h.get("id") or (clean[0] if clean else options[0])
        side = h.get("side") or sides.get(pid)
        notes = []
        near, other = gap(pid, vid)
        confirmed = bool(h.get("confirmed"))
        doubtful = near < NEAR and near < own(pid, vid)
        if doubtful and not confirmed:
            notes.append(f"这张和写着 {other} 的照片只隔 {int(near)} 秒拍，可能是同一组照片里说明写串了")
        if side and not confirmed:
            notes.append(f"双人照，按说明取{'左' if side == 'L' else '右'}边的人")
        if not clean:
            notes.append("候选照片都不是干净的照片：" + "；".join(f"{p} {w}" for p, w in verdicts.items()))
        elif len(options) < 2:
            notes.append("只有一张写着他名字的照片")
        if h.get("note"):
            notes.append(h["note"])
        sure = confirmed or (bool(clean) and verdicts.get(pid) is None and not doubtful and not side and not h.get("unsure"))
        fs = clear(f"flickr-{pid}.jpg", boxes) or faces_of(f"flickr-{pid}.jpg", boxes)
        if side and len(fs) >= 2:
            pair = sorted(fs[:2], key=lambda f: f["x"])
            face = pair[0] if side == "L" else pair[1]
        else:
            face = fs[0] if fs else None
        im = Image.open(PHOTOS / f"flickr-{pid}.jpg").convert("RGB")
        if face:
            square(im, face).save(OUT / f"event-{vid}.webp", "WEBP", quality=84)
        else:
            s = min(im.size)
            im.crop(((im.width - s) // 2, 0, (im.width + s) // 2, s)).resize((SIDE, SIDE), Image.LANCZOS).save(OUT / f"event-{vid}.webp", "WEBP", quality=84)
        out[vid] = {"face": f"/events/los-angeles-2023/event-{vid}.webp", "ign": v["ign"], "photo": pid, "side": side,
                    "taken": taken_at[pid].isoformat() if pid in taken_at else None, "sure": sure, "confirmed": confirmed,
                    "note": "；".join(notes) or None,
                    "source": f"https://www.flickr.com/photos/valorantesports/{pid}/",
                    "license": "All Rights Reserved (Riot Games)", "author": urls.get(pid, {}).get("author") or "Riot Games"}
        if not sure:
            unsure.append(v["ign"])
    FACES.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{len(out)} faces cropped; unsure ({len(unsure)}): {', '.join(unsure) or 'none'}", flush=True)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"search": search, "taken": taken, "download": download, "sheet": sheet, "crop": crop}.get(cmd, lambda: print(__doc__) or 1)())
