#!/usr/bin/env python3
"""
Card data for the retired-card preview (preview/retired-v16.html → render_retired_v16_cards.mjs).

    python3 -m scripts.rating.build_retired_preview

普卡: v16 rating and metal, his own attribute shape, the career span, and his
LAST club (owner, 2026-10-10: the last event he played at least 100 rounds of —
show matches and pick-up fives do not count). Photo: the dossier's, else the
one found for the 2020-22 retirees (early_faces.json).
彩卡: mythics.json, with the night's city, result, club and Riot Flickr photo.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
B = ROOT / "analysis" / "rating" / "history_v16"
# the night: city, result, club, card colours, photo crop
NIGHT = {
    "TenZ": ("雷克雅未克", "冠军", "SEN", 2021, "#f2a9ae", "#54182d", "60% 40%"),
    "Sacy": ("伊斯坦布尔", "冠军", "LOUD", 2022, "#bee3b1", "#243e32", "40% 30%"),
    "Leo": ("圣保罗", "冠军", "FNC", 2023, "#ffc58a", "#61311d", "50% 20%"),
    "yay": ("雷克雅未克", "冠军", "OPTC", 2022, "#d6e88f", "#2f3a14", "55% 30%"),
    "ScreaM": ("柏林", "四强", "TL", 2021, "#9cc7f0", "#1d2f4a", "78% 35%"),
    "FNS": ("雷克雅未克", "冠军", "OPTC", 2022, "#d6e88f", "#2f3a14", "45% 35%"),
    "Zest": ("伊斯坦布尔", "季军", "DRX", 2022, "#a8c4f5", "#1e2a4d", "50% 30%"),
    "BONECOLD": ("柏林", "冠军", "ACE", 2021, "#e7c3f2", "#3a2147", "50% 20%"),
}


def main() -> int:
    players = {p["vlrId"]: p for p in json.loads((B / "players.json").read_text()) if p.get("rated") and p["class"] == "retired"}
    hist = json.loads((ROOT / "src" / "data" / "dossier.json").read_text())["hist"]
    early = json.loads((B / "early_faces.json").read_text()) if (B / "early_faces.json").exists() else {}
    mythics = []
    for i, m in enumerate(json.loads((B / "mythics.json").read_text()), 1):
        city, result, club, year, accent, tint, pos = NIGHT[m["ign"]]
        mythics.append({"id": f"AGM:{m['ign']}", "playerId": m["vlrId"], "ign": m["ign"], "club": club, "role": m["role"],
                        "roles": [m["role"]], "year": year, "number": f"余晖 / 彩 {i:02d}", "rating": m["rating"],
                        "theme": city, "event": m["why"], "achievement": result,
                        "photo": f"events/afterglow/portraits/{m['ign'].lower()}-action.jpg", "photoPosition": pos,
                        "accent": accent, "tint": tint, "attrs": m["attrs"], "status": "retired", "ratingSide": "left",
                        "photoNote": "", "reason": "", "source": ""})
    normals = []
    for i, p in enumerate(sorted(players.values(), key=lambda p: (-p["rating"], p["ign"].lower())), 1):
        rr = sorted(p["records"], key=lambda r: (r["date"], r["rounds"]))
        real = [r for r in rr if r["rounds"] >= 100 and r["club"] not in ("Team", "TBD", "")] or rr
        years = sorted({int(r["date"][:4]) for r in rr})
        span = f"{max(2020, years[0])}–{str(years[-1])[2:]}" if years[0] != years[-1] else str(years[0])
        h = hist.get("Hv" + p["vlrId"]) or {}
        face = f"/faces/{h['img']}" if h.get("img") else (f"/faces/{early[p['vlrId']]['file']}" if p["vlrId"] in early else None)
        normals.append({"id": p["vlrId"], "ign": p["ign"], "club": real[-1]["club"], "role": (p.get("card") or {}).get("role") or "—",
                        "year": span, "number": f"余晖 / {i:03d}", "rating": p["rating"], "finish": p["rarity"], "photo": face})
    (ROOT / "preview" / "retired_v16_cards.json").write_text(json.dumps({"mythics": mythics, "normals": normals}, ensure_ascii=False))
    print(f"{len(mythics)} 彩卡, {len(normals)} 普卡; no photo: {[n['ign'] for n in normals if not n['photo']]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
