#!/usr/bin/env python3
"""How many players in each world still lack a photo, birthdate, real name or flag."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, "src", "data", "dossier.json")))
faces = set(os.listdir(os.path.join(ROOT, "public", "faces")))
look = {**d.get("hist", {}), **d["players"]}
for y in (2023, 2024, 2025, 2026):
    w = json.load(open(os.path.join(ROOT, "src", "data", "world.json" if y == 2026 else f"world_{y}.json")))
    tier = {t["id"]: t["tier"] for t in w["teams"]}
    for label, ps in (("全部", w["players"]), ("一级队", [p for p in w["players"] if tier.get(p["teamId"]) == 1])):
        m = dict(img=0, birth=0, real=0, nat=0)
        for p in ps:
            e = look.get(p["id"], {})
            m["img"] += not (e.get("img") in faces)
            m["birth"] += not p.get("birth")
            m["real"] += not (p.get("realName") or e.get("real"))
            m["nat"] += not (p.get("nat") or e.get("nat"))
        print(f"{y} {label:<4} {len(ps):>4} 人 · 缺照片 {m['img']:>3} · 缺生日 {m['birth']:>3} · 缺真名 {m['real']:>3} · 缺国籍 {m['nat']:>2}")
