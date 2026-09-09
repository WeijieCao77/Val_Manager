"""Every agent's abilities, with charges, cost and cooldown.

    python3 scripts/fetch_agent_abilities.py

The composition model in scripts/style_dynamics.ts sorts agents onto Isaaa's
Aggro / Midrange / Control triangle, and the sorting criterion is what KIND of
utility the agent carries: one-shot catalytic utility that opens space, high
volume that can be traded away cheaply, or rechargeable utility that comes back
on a cooldown. That table was filled in from memory, which is not good enough
for the thing the whole model rests on.

Two sources, both cheap and neither one that has blocked this project:

  valorant-api.com  — a static mirror of the game's own data. Canonical agent
                      roster, ability names, slots and in-game descriptions,
                      pulled in both en-US and zh-CN so the sheet a Chinese
                      coach reads says 闪点爆破 rather than Flashpoint. The
                      English name stays the join key, as it is everywhere
                      else in this repo. Already used by
                      scripts/fetch_valorant_assets.ts.
  valorant.fandom   — Template:Ability info is a single wiki page holding the
                      charge counts, credit costs and cooldowns for all ~127
                      abilities at once. ONE request for the lot, so there is
                      no crawl to throttle.

Writes src/data/abilities.json and prints the derived classification so the
numbers in style_dynamics.ts can be argued with rather than remembered.
"""
import json, re, urllib.request, pathlib, sys

UA = "val-manager-research/1.0 (esport-manager; agent ability reference)"
CACHE = pathlib.Path("scripts/cache")
OUT = pathlib.Path("src/data/abilities.json")


def get(url, cache_name):
    """Fetch once, then serve from scripts/cache — reruns cost nothing."""
    path = CACHE / cache_name
    if path.exists():
        return json.loads(path.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def wiki_abilities():
    """ability name -> {Cost, Uses, Cooldown, Duration, ...} from one wiki page."""
    d = get(
        "https://valorant.fandom.com/api.php?action=query&prop=revisions"
        "&rvprop=content&rvslots=main&titles=Template:Ability%20info"
        "&format=json&formatversion=2",
        "fandom_ability_info.json",
    )
    text = d["query"]["pages"][0]["revisions"][0]["slots"]["main"]["content"]
    out = {}
    for m in re.finditer(r"\|\s*([^|{}=\n]+?)\s*=\s*\{\{Ability\b", text):
        name = m.group(1).strip()
        # brace-match from the {{Ability so nested {{C}} / {{Game Descriptions}}
        # templates do not end the block early
        i = text.index("{{Ability", m.start())
        depth, j = 0, i
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1; j += 2
            elif text.startswith("}}", j):
                depth -= 1; j += 2
                if depth == 0:
                    break
            else:
                j += 1
        body = text[i:j]
        fields = {}
        for f in re.finditer(r"\n\s*\|\s*([A-Za-z][A-Za-z ]*?)\s*=\s*(.*?)(?=\n\s*\||\Z)", body, re.S):
            fields[f.group(1).strip()] = " ".join(f.group(2).split())
        out[name] = fields
    return out


def clean(s):
    """Wikitext to something readable: strip links, templates and markup."""
    if not s:
        return ""
    s = re.sub(r"\{\{C\}\}", "", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", s)
    s = s.replace("'''", "").replace("''", "")
    return " ".join(s.split()).strip()


def num(s):
    m = re.search(r"\d+(?:\.\d+)?", clean(s) or "")
    return float(m.group()) if m else None


def main():
    agents = get(
        "https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=en-US",
        "valorant_api_agents.json",
    )["data"]
    cn = get(
        "https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=zh-CN",
        "valorant_api_agents_cn.json",
    )["data"]
    # uuid is the only stable key across languages — the display names differ
    # by definition, and ability order is not promised to match
    cn_by_uuid = {a["uuid"]: a for a in cn}
    wiki = wiki_abilities()
    print(f"valorant-api: {len(agents)} agents   fandom: {len(wiki)} abilities\n")

    # valorant-api spells some abilities in caps (Yoru's FAKEOUT, Killjoy's
    # TURRET) and joins a few with a slash (Astra's "Nebula / Dissipate"), so
    # match on a folded key and try each half of a slashed pair.
    folded = {re.sub(r"[^a-z0-9]", "", k.lower()): v for k, v in wiki.items()}

    def wiki_row(name):
        for cand in [name] + [p.strip() for p in name.split("/")]:
            row = folded.get(re.sub(r"[^a-z0-9]", "", cand.lower()))
            if row:
                return row
        return {}

    rows, missing = {}, []
    for a in agents:
        zh = cn_by_uuid.get(a["uuid"], {})
        zh_slots = {x["slot"]: x for x in zh.get("abilities", [])}
        abils = []
        for ab in a["abilities"]:
            name = ab["displayName"]
            zh_ab = zh_slots.get(ab["slot"], {})
            w = wiki_row(name)
            if not w:
                missing.append(f"{a['displayName']}/{name}")
            cd = num(w.get("Cooldown"))
            abils.append({
                "slot": ab["slot"],
                "name": name,
                "cn": zh_ab.get("displayName") or name,
                "descCn": " ".join((zh_ab.get("description") or "").split()),
                "key": clean(w.get("Key")),
                "desc": " ".join((ab.get("description") or "").split()),
                # charges bought per round; None for the ultimate
                "uses": num(w.get("Uses")),
                "cost": num(w.get("Cost")),
                # seconds before it is usable again without buying it; the
                # single most important field for the triangle — rechargeable
                # utility is what a Midrange composition trades with
                "cooldown": cd,
                "rechargeable": cd is not None,
                "duration": clean(w.get("Duration")) or None,
            })
        rows[a["displayName"]] = {
            "cn": zh.get("displayName") or a["displayName"],
            "role": a["role"]["displayName"] if a.get("role") else None,
            "roleCn": zh["role"]["displayName"] if zh.get("role") else None,
            "abilities": abils,
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1, sort_keys=True))
    print(f"wrote {OUT}  ({len(rows)} agents)")
    if missing:
        print(f"no wiki row for {len(missing)}: {', '.join(missing)}")

    print("\n每个特工的基础技能（不含大招）——充能数 / 冷却")
    print(f"{'特工':14}{'位置':10}{'可再生技能':>10}{'总充能':>8}  技能")
    for name in sorted(rows):
        r = rows[name]
        basics = [x for x in r["abilities"] if x["slot"] != "Ultimate"]
        rech = [x for x in basics if x["rechargeable"]]
        charges = sum(x["uses"] or 0 for x in basics)
        detail = "、".join(
            f"{x['cn']}{'×%d' % x['uses'] if x['uses'] and x['uses'] > 1 else ''}"
            f"{' [%ds]' % x['cooldown'] if x['cooldown'] else ''}"
            for x in basics
        )
        print(f"{r['cn']:14}{str(r['roleCn']):10}{len(rech):>10}{charges:>8.0f}  {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
