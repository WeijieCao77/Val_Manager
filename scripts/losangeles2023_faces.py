"""
Champions Los Angeles 2023 Features Day photographs onto the 洛杉矶 2023 cards —
bangkok2025_faces.py's Flickr route, for vlr event 1657.

    python3 scripts/losangeles2023_faces.py search    # captions off Riot's Flickr search pages, 2 s apart → candidates
    python3 scripts/losangeles2023_faces.py taken     # each candidate frame's date taken (photo page), 2 s apart
    python3 scripts/losangeles2023_faces.py download  # every candidate frame, 1024 px, 2 s apart
    python3 scripts/losangeles2023_faces.py sheet     # face boxes + analysis/losangeles_face_sheet.html
    python3 scripts/losangeles2023_faces.py crop      # the picks, cut out → public/events/los-angeles-2023/event-<vlrId>.webp

Candidates (scripts/cache/losangeles2023_flickr_candidates.json, { vlrId: { ign, ids, pairs } }) are frames
whose Riot caption names exactly that player; a player with fewer than two such frames also gets the frames
captioned as him and one teammate, with the side the caption puts him on ("(L)" names the left one first).
T1 had no Features Day session, so T1's frames are the posed 5 August Shrine Expo Hall set
("… of T1 at VALORANT Champions Los Angeles Group Stage …", no competes/arrives/reacts).

Captions are not proof of who is pictured (seoul2024_flickr_picks.json). The pick is a frame with one clear
face (two for a pair frame); the face detector only finds faces, it never says whose. Riot captions a whole
batch at once, so a frame is trusted by its company: the pick is the frame with the most of his own frames
within NEAR seconds and the fewest of anyone else's (BLG's lone 16:35 「whz」 frame, far from everybody, was
Biank — the owner caught it). A pick within NEAR seconds of someone else's frame, and nearer to it than to
his own, is marked unsure, as on 曼谷. A pair frame is always unsure.

Every pick is softened into the card (see soften(): owner, 2026-10-18 — 背景和卡面底板融合得不自然, a plain
cutout didn't look right either, 柔和融合 chosen of five): the player as shot, cut out with
scripts/person_cutout.swift (Vision's person instance mask, the person under the face), over his own frame
mapped into the sunset palette, darkened and dissolving outward; teammates are masked out of it.
Overrides by hand: scripts/cache/losangeles2023_face_picks.json
({ vlrId: { "id": <photo>, "side": "L"|"R"?, "confirmed": true, "keep": true?, "tone": "warm"?, "note": ... } }).
`tone: "warm"` tones a colour-lit frame out (luminance, warm tint) before it is softened (aspas).
`keep` is the owner pinning a card as it is (Jinggg, 2026-10-18): his first-version image — the frame as
shot, no cutout, no grade — and the first-version face style (`style: "raw"`). Never change a kept card.
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
CUT = PHOTOS / "cutouts"
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


# The light on a player's face, read off the middle of the face box (a jersey's colour doesn't count),
# against the median skin of all 80 frames: the picker prefers the most naturally lit frame of a session.
SKIN = (0.4385, 0.3075, 0.255)
# a face this far from natural skin was lit in a colour (aspas's three frames under LOUD's green light read
# 0.5–1.3): such a frame only wins when the player has no naturally lit one — the 柔和融合 keeps his colours
# as shot, so a green face stays green on the card (owner, 2026-10-18: 为什么aspas脸是绿的)
CAST_MAX = 0.35


def skin_share(photo: Image.Image, face: dict | None) -> tuple[float, float, float] | None:
    import numpy as np
    if not face:
        return None
    a = np.asarray(photo.convert("RGB")).astype(np.float32)
    x0, y0 = int(face["x"] + face["w"] * .25), int(face["y"] + face["h"] * .35)
    x1, y1 = int(face["x"] + face["w"] * .75), int(face["y"] + face["h"] * .8)
    m = a[y0:y1, x0:x1].reshape(-1, 3).mean(0)
    return tuple(float(v) for v in m / max(m.sum(), 1))


# The 柔和融合 treatment (owner's pick of five, 2026-10-18): the player as shot over a softened copy of his own
# frame — its light kept, its colour mapped into the card's night-plum-to-peach sunset and darkened, fading out
# from the middle so the art shows around him. Anyone else in the frame is taken out of that background.
PALETTE = ((23, 19, 30), (70, 32, 58), (168, 74, 66), (236, 150, 98), (255, 222, 170))


def warm(photo: Image.Image) -> Image.Image:
    """a frame lit in a colour, toned out: its luminance with a warm skin tint (picks `tone: "warm"`, aspas)"""
    import numpy as np
    lum = np.asarray(photo.convert("RGB")).astype(np.float32) @ np.array([.299, .587, .114], np.float32)
    return Image.fromarray(np.stack([np.clip(lum * t, 0, 255) for t in (1.12, 0.92, 0.78)], -1).astype(np.uint8))


def soften(raw: Image.Image, cut: Image.Image, others: Image.Image | None) -> Image.Image:
    import numpy as np
    from PIL import ImageFilter
    rgb = np.asarray(raw.convert("RGB")).astype(np.float32)
    alpha = np.asarray(cut.split()[-1].filter(ImageFilter.GaussianBlur(5))).astype(np.float32)[..., None] / 255
    lum = (rgb @ np.array([.299, .587, .114], np.float32)) / 255
    pal = np.array(PALETTE, np.float32)
    x = np.clip(lum * .55, 0, 1) * (len(pal) - 1)
    i = np.clip(x.astype(int), 0, len(pal) - 2)
    t = (x - i)[..., None]
    bg = pal[i] * (1 - t) + pal[i + 1] * t
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h * .45) / (h / 2)) ** 2)[..., None]
    bga = np.clip(1.15 - dist * .9, 0, 1) * .85
    if others is not None:
        o = others.convert("L").filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(8))
        bga = bga * (1 - np.asarray(o).astype(np.float32)[..., None] / 255)
    comp = rgb * alpha + bg * (1 - alpha)
    a = alpha + (1 - alpha) * bga
    return Image.fromarray(np.clip(np.concatenate([comp, a * 255], -1), 0, 255).astype(np.uint8), "RGBA")


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

    def company(pid: str, vid: str) -> int:
        """his own frames within NEAR seconds, less everyone else's"""
        if pid not in taken_at:
            return 0
        near = [q for q in taken_at if q != pid and q in owner and abs((taken_at[pid] - taken_at[q]).total_seconds()) <= NEAR]
        return sum(1 for q in near if vid in owner[q]) - sum(1 for q in near if vid not in owner[q])

    def face_of(pid: str, side: str | None) -> dict | None:
        fs = clear(f"flickr-{pid}.jpg", boxes) or faces_of(f"flickr-{pid}.jpg", boxes)
        if side and len(fs) >= 2:
            pair = sorted(fs[:2], key=lambda f: f["x"])
            return pair[0] if side == "L" else pair[1]
        return fs[0] if fs else None

    def cast(pid: str, side: str | None) -> float:
        """how far the light on his face is from natural, in steps of 0.1 (so session company still leads)"""
        share = skin_share(Image.open(PHOTOS / f"flickr-{pid}.jpg"), face_of(pid, side))
        return round(sum(abs(a - b) for a, b in zip(share, SKIN)), 1) if share else 0.0

    jobs = []
    for vid, v in cands.items():
        sides = {p: s for p, s in v["pairs"]}
        options = frames(v)
        if not options and vid not in hand:
            continue
        verdicts = {pid: verdict(f"flickr-{pid}.jpg", boxes, 2 if pid in sides else 1) for pid in options}
        clean = sorted((pid for pid in options if verdicts[pid] is None), key=lambda q: (q in sides, cast(q, sides.get(q)) > CAST_MAX, -company(q, vid), cast(q, sides.get(q)), -gap(q, vid)[0]))
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
        if not h.get("id") and clean and pid != sorted(clean, key=lambda q: (q in sides, -company(q, vid)))[0] and company(pid, vid) <= 0 and not confirmed:
            notes.append("同组的照片打了彩色光，换成了光线正常的这张，它不在同一组里，请确认是他")
            doubtful = True
        if h.get("note"):
            notes.append(h["note"])
        sure = confirmed or (bool(clean) and verdicts.get(pid) is None and not doubtful and not side and not h.get("unsure"))
        face = face_of(pid, side)
        jobs.append((vid, pid, face))
        out[vid] = {"face": f"/events/los-angeles-2023/event-{vid}.webp", "ign": v["ign"], "photo": pid, "side": side,
                    "taken": taken_at[pid].isoformat() if pid in taken_at else None, "sure": sure, "confirmed": confirmed,
                    "note": "；".join(notes) or None,
                    "source": f"https://www.flickr.com/photos/valorantesports/{pid}/",
                    "license": "All Rights Reserved (Riot Games)", "author": urls.get(pid, {}).get("author") or "Riot Games"}
        if not sure:
            unsure.append(v["ign"])
    # cut every pick out in one Vision run, then crop the cut-out square around the face
    CUT.mkdir(parents=True, exist_ok=True)
    args = []
    for vid, pid, face in jobs:
        im = Image.open(PHOTOS / f"flickr-{pid}.jpg")
        x, y = (face["x"] + face["w"] / 2, face["y"] + face["h"] / 2) if face else (im.width / 2, im.height / 3)
        args += [str(PHOTOS / f"flickr-{pid}.jpg"), str(CUT / f"{vid}.png"), f"{x:.1f}", f"{y:.1f}"]
    run = subprocess.run(["swift", str(ROOT / "scripts" / "person_cutout.swift"), *args], capture_output=True, text=True, check=True)
    how = {Path(json.loads(l)["out"]).stem: json.loads(l).get("how") for l in run.stdout.splitlines() if l.startswith("{") and "out" in l}
    for vid, pid, face in jobs:
        if hand.get(vid, {}).get("keep"):
            # pinned by the owner: the first version, exactly — the frame as shot, cropped square, no cutout or grade
            out[vid].update(cutout=False, style="raw", keep=True)
            square(Image.open(PHOTOS / f"flickr-{pid}.jpg").convert("RGB"), face).save(OUT / f"event-{vid}.webp", "WEBP", quality=84)
            continue
        cut = CUT / f"{vid}.png"
        photo = Image.open(PHOTOS / f"flickr-{pid}.jpg").convert("RGB")
        if how.get(vid) not in ("person", "foreground") or not cut.exists() or not face:
            out[vid].update(style="raw", cutout=False)
            out[vid]["note"] = "；".join(filter(None, [out[vid]["note"], "没能把人从背景里抠出来，用的是原图"]))
            out[vid]["sure"] = False
            unsure.append(out[vid]["ign"])
            (square(photo, face) if face else photo.resize((SIDE, SIDE))).save(OUT / f"event-{vid}.webp", "WEBP", quality=84)
            continue
        out[vid].update(style="soft", cutout=True)
        if hand.get(vid, {}).get("tone") == "warm":
            photo = warm(photo)
            out[vid]["toned"] = "warm"
        rest = CUT / f"{vid}-others.png"
        soften(square(photo, face), square(Image.open(cut).convert("RGBA"), face),
               square(Image.open(rest), face) if rest.exists() else None).save(OUT / f"event-{vid}.webp", "WEBP", quality=80, alpha_quality=100, method=6)
    FACES.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    unsure = sorted(set(unsure), key=unsure.index)
    print(f"{len(out)} faces cropped, {sum(1 for v in out.values() if v.get('cutout'))} cut out; unsure ({len(unsure)}): {', '.join(unsure) or 'none'}", flush=True)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"search": search, "taken": taken, "download": download, "sheet": sheet, "crop": crop}.get(cmd, lambda: print(__doc__) or 1)())
