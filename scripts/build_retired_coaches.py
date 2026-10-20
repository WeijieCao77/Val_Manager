"""
退役教练卡 (owner, 2026-10-20): the 70 coaches the v16 rebuild found no longer coaching, as cards.

    python3 scripts/build_retired_coaches.py [v16 dir]   # default ../esport-manager/analysis/rating/history_v16

v16's coach numbers sit on their own ruler (mean 73.6, sd 3.3) while the live coach cards still carry the
old one (mean 69.5, sd 8.6). The owner's call: keep every live coach card as it is and carry the retired
coaches over by RANK — each of tactics / development / motivation is mapped from its place among the 70
onto the same attribute's distribution over the live head coaches, and the card's number is then the
live formula (coachRating) over the mapped three, so the two kinds of coach compare on one scale.

Writes src/data/retired_coaches.json and public/faces/rc-<vlrId>.webp (192 square, like every face).
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
V16 = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "esport-manager" / "analysis" / "rating" / "history_v16"
OUT = ROOT / "src" / "data" / "retired_coaches.json"
FACES = ROOT / "public" / "faces"
SIDE = 192
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36"
ATTRS = ("tactics", "development", "motivation")
# faces found by hand where v16 had none (2026-10-20): vlr player pages, and Riot's valorantesports Flickr
# (mini at Masters Tokyo 2023, Mt Fuji hat and all). `crop` is a box in the source image.
MANUAL = {
    "fluyr": {"url": "https://owcdn.net/img/62d0735887613.png"},
    "Warbirds": {"url": "https://owcdn.net/img/6821f79304fbe.png"},
    "mini": {"url": "https://live.staticflickr.com/65535/52990745900_e7f7051d25_b.jpg", "page": "https://www.flickr.com/photos/valorantesports/52990745900/", "crop": [275, 60, 735, 520]},
}


def ranks(values: list[float]) -> list[float]:
    """average rank (0-based) of each value; ties share it"""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2
        i = j + 1
    return out


def quantile(sorted_vals: list[float], p: float) -> float:
    x = p * (len(sorted_vals) - 1)
    lo = int(x)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (x - lo)


def teams_index() -> dict[str, tuple[str, str]]:
    """team name (lower) → (tag, region), newest world first"""
    idx: dict[str, tuple[str, str]] = {}
    for f in ("world.json", "world_2025.json", "world_2024.json", "world_2023.json"):
        p = ROOT / "src" / "data" / f
        if not p.exists():
            continue
        for t in json.loads(p.read_text("utf-8")).get("teams", []):
            for name in {t.get("name", ""), t.get("tag", "")}:
                if name and name.lower() not in idx:
                    idx[name.lower()] = (t["tag"], t.get("region"))
    return idx


def face(url: str, vid: str, crop: list[int] | None = None) -> tuple[str, str] | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        raw = urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:  # noqa: BLE001
        print(f"  face {vid}: {e}", flush=True)
        return None
    im = Image.open(io.BytesIO(raw))
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    if crop:
        im = im.crop(tuple(crop))
    w, h = im.size
    side = min(w, h)
    left, top = (w - side) // 2, 0 if h > w else (h - side) // 2
    im = im.crop((left, top, left + side, top + side)).resize((SIDE, SIDE), Image.LANCZOS)
    if im.mode == "RGBA":
        bg = Image.new("RGB", im.size, (24, 28, 36))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    FACES.mkdir(parents=True, exist_ok=True)
    out = FACES / f"rc-{vid}.webp"
    im.save(out, "WEBP", quality=82)
    return out.name, hashlib.sha1(out.read_bytes()).hexdigest()[:8]


def main() -> int:
    coaches = json.loads((V16 / "coaches.json").read_text("utf-8"))["coaches"]
    tenures = {p["key"]: p for p in json.loads((V16 / "coach_tenures.json").read_text("utf-8"))["people"]}
    photos = json.loads((V16 / "coach_photo_sources.json").read_text("utf-8"))
    world = json.loads((ROOT / "src" / "data" / "world.json").read_text("utf-8"))
    live = [t["coach"] for t in world["teams"] if t.get("coach") and t["coach"].get("name")]
    seen, live_heads = set(), []
    for c in live:
        if c["name"] not in seen:
            seen.add(c["name"])
            live_heads.append(c)
    dist = {a: sorted(float(c[a]) for c in live_heads) for a in ATTRS}

    gone = [c for c in coaches if c["status"] == "inactive"]
    idx = teams_index()
    mapped = {}
    for a in ATTRS:
        rk = ranks([float(c[a]) for c in gone])
        for c, r in zip(gone, rk):
            p = (r + 0.5) / len(gone)
            mapped.setdefault(c["key"], {})[a] = round(quantile(dist[a], p))
    rows, missing_face = [], []
    dossier_coaches = json.loads((ROOT / "src" / "data" / "dossier.json").read_text("utf-8")).get("coaches", {})
    for c in sorted(gone, key=lambda c: c["name"].lower()):
        m = mapped[c["key"]]
        rating = round(m["tactics"] * 0.45 + m["development"] * 0.3 + m["motivation"] * 0.25)
        stints = sorted(tenures.get(c["key"], {}).get("stints", []), key=lambda s: (s.get("to") or s.get("from") or "", s.get("from") or ""))
        # the club he is remembered by: a head-coach job at a club the game knows, else any job there,
        # else any job (a national side or a team that never reached the game's leagues comes last)
        def at_known(s: dict) -> bool:
            t = (s.get("team") or "").lower()
            return t in idx or t.replace(" esports", "").replace(" gaming", "").strip() in idx
        known = [s for s in stints if at_known(s)]
        heads = [s for s in known if s.get("role") == "head"]
        def months(s: dict) -> int:
            f, t = s.get("from"), s.get("to") or (c.get("lastEvent") or "")[:10] or None
            if not f or not t:
                return 0
            return (int(t[:4]) - int(f[:4])) * 12 + int(t[5:7]) - int(f[5:7])
        # the longest of those jobs, the latest on a tie: Chet is NRG's coach, not M80's for six weeks
        pool = heads or known or stints
        last = max(pool, key=lambda s: (months(s), s.get("to") or s.get("from") or "")) if pool else None
        team = (last or {}).get("team") or ""
        bare = team.lower().replace(" esports", "").replace(" gaming", "").replace(" esports club", "").strip()
        tag, region = idx.get(team.lower()) or idx.get(bare) or (None, None)
        if not tag and team:
            words = [w for w in team.replace("-", " ").split() if w[:1].isalnum()]
            tag = "".join(w[0] for w in words).upper()[:4] if len(words) > 1 else team[:4].upper()
        years = [int(s[k][:4]) for s in stints for k in ("from", "to") if s.get(k)]
        span = [min(years), max(years)] if years else None
        # a coach v16 knows only by name has no vlr number: his id and file come from the name
        slug = c["vlrId"] or "n-" + "".join(ch for ch in unicodedata.normalize("NFKD", c["name"]).lower() if ch.isascii() and ch.isalnum())
        handle = tenures.get(c["key"], {}).get("handle") or ""
        plain = unicodedata.normalize("NFKD", c["name"]).encode("ascii", "ignore").decode().lower()
        ph = MANUAL.get(c["name"]) or photos.get(c["name"]) or photos.get(c["name"].lower()) or photos.get(handle) or photos.get(plain)
        got = None
        if ph:
            got = face(ph["url"], slug, ph.get("crop"))
            time.sleep(2.0 if "liquipedia" in ph["url"] else 1.0)
        if not got:
            # a coach the game once had keeps the face the 资料库 already holds
            d = dossier_coaches.get(c["name"]) or dossier_coaches.get(c["name"].lower()) or {}
            if d.get("img") and (FACES / d["img"]).exists():
                got = (d["img"], d.get("v") or hashlib.sha1((FACES / d["img"]).read_bytes()).hexdigest()[:8])
        if not got:
            missing_face.append(c["name"])
        rows.append({
            "id": f"rc:{slug}", "vlrId": c["vlrId"], "name": c["name"], "realName": c.get("real"),
            "nat": c.get("nat"), "clubTag": tag or None, "club": team or None, "region": region,
            "tactics": m["tactics"], "development": m["development"], "motivation": m["motivation"],
            "rating": rating, "span": span, "lastEvent": c.get("lastEvent"),
            "face": got[0] if got else None, "faceV": got[1] if got else None,
            "v16": {"rating": c["rating"], **{a: c[a] for a in ATTRS}},
        })
    meta = {
        "built": time.strftime("%Y-%m-%d"),
        "source": "analysis/rating/history_v16/coaches.json (status inactive)",
        "rule": "each attribute mapped by rank among the retired onto the live head coaches' distribution; rating = coachRating",
        "liveHeads": len(live_heads), "count": len(rows),
    }
    OUT.write_text(json.dumps({"meta": meta, "coaches": rows}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    rs = sorted(r["rating"] for r in rows)
    print(f"{len(rows)} retired coaches → {OUT.name}; ratings {rs[0]}–{rs[-1]}, median {rs[len(rs) // 2]}; "
          f"no face: {', '.join(missing_face) or 'none'}; no club tag: {[r['name'] for r in rows if not r['clubTag']]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
