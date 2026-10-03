"""
Put the manager worlds on the card rating scale.

Since 2026-10-01 the 普卡 are rated by the published study
(src/data/card_ratings.json, /cards/stats) while the manager kept the world
builder's own overall — a player's card said 73 and his career said 88. This
makes the two the same number:

- world.json: each rated player's overall becomes his card rating. All eight
  attributes move by the gap (exactly what cards.ts shiftAttrs does, so the
  card faces do not change), the growth room he had (potential − overall) is
  kept, salary follows the overall on the same curve as build_world, value is
  recomputed, and every club's rating/reputation is re-read off its five.
- world_2023/24/25.json and retired.json: those years have no card rating, so
  they move rank for rank onto the new ruler — the n-th best old 2026 overall
  maps to the n-th best card rating (old 95 → 92). This is the map cards.ts
  used for retired players' 预估能力 until now.

Idempotent: every file records `ratingScale`, and a file already on this
version is left alone. build_world.py calls `sync_world` after writing.

    python3 scripts/sync_world_ratings.py
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "src", "data")
sys.path.insert(0, HERE)
import build_world as bw  # noqa: E402

RATED = os.path.join(DATA, "card_ratings.json")


def load(name):
    return json.load(open(os.path.join(DATA, name), encoding="utf-8"))


def save(name, obj, **fmt):
    json.dump(obj, open(os.path.join(DATA, name), "w", encoding="utf-8"), ensure_ascii=False,
              **(fmt or {"separators": (",", ":")}))


def raw(p):
    w = bw.ROLE_WEIGHT.get(p["role"], bw.ATTR_WEIGHT)
    return p.get("stageBonus", 0.0) + sum(p["attrs"][k] * w.get(k, bw.ATTR_WEIGHT[k]) for k in bw.ATTRS)


def recompute(p):
    """player.ts recomputeOverall — Math.round, not Python's half-to-even"""
    return int(math.floor(bw.clamp(raw(p), 30, 99) + 0.5))


def shift(p, new):
    """Move one player to `new`, keeping his room, his pay curve and his shape."""
    gap = new - p["overall"]
    if not gap:
        return
    p["attrs"] = {k: int(bw.clamp(v + gap, 20, 99)) for k, v in p["attrs"].items()}
    room = p["potential"] - p["overall"]
    p["overall"] = new
    p["potential"] = int(bw.clamp(new + room, new, 99))
    p["salary"] = int(round(p["salary"] * math.exp(gap / 12.0) / 1000.0) * 1000)
    p["value"] = bw.value_for(new, p.get("age"), p["potential"])


def rerate_clubs(world):
    by_id = {p["id"]: p for p in world["players"]}
    for t in world["teams"]:
        ovrs = sorted((by_id[i]["overall"] for i in t["roster"] if i in by_id), reverse=True)[:5]
        if not ovrs:
            continue
        t["rating"] = int(round(sum(ovrs) / len(ovrs)))
        t["reputation"] = int(bw.clamp(round(t["rating"] * (1.0 if t["tier"] == 1 else 0.72)), 20, 99))


def ruler(pairs):
    """The rank-for-rank map from the old overall to the card scale."""
    top_old, top_new = pairs[0]
    low_old, low_new = pairs[-1]

    def to_new(ov):
        if ov >= top_old:
            return min(99, top_new + (ov - top_old))
        if ov <= low_old:
            return max(1, low_new - (low_old - ov))
        for o, n in pairs:
            if o <= ov:
                return n
        return ov
    return to_new


def sync_world(verbose=True):
    rated = json.load(open(RATED, encoding="utf-8"))
    version, ratings = rated["version"], rated["ratings"]
    world = load("world.json")
    ps = [p for p in world["players"] if p["id"] in ratings]
    missing = [p["ign"] for p in world["players"] if p["id"] not in ratings]
    if missing:
        raise SystemExit(f"no card rating for {len(missing)}: {missing[:10]}")
    neu = sorted((ratings[p["id"]] for p in ps), reverse=True)
    if world["meta"].get("ratingScale") == version:
        # the old ruler, kept so the year worlds and retired.json can follow later
        old = world["meta"]["ratingScaleFrom"]
        if verbose:
            print(f"world.json already on {version}")
    else:
        old = sorted((p["overall"] for p in ps), reverse=True)
        for p in ps:
            shift(p, ratings[p["id"]])
            # an attribute pinned at 99 cannot take the whole gap: what it could
            # not hold goes on stageBonus, which the engine re-adds on every
            # recompute and the card face never shows
            if recompute(p) != p["overall"]:
                p["stageBonus"] = round(p.get("stageBonus", 0.0) + p["overall"] - raw(p), 4)
            if recompute(p) != p["overall"]:
                raise SystemExit(f"{p['ign']}: attributes read {recompute(p)}, rating says {p['overall']}")
        rerate_clubs(world)
        world["meta"]["ratingScale"] = version
        world["meta"]["ratingScaleFrom"] = old
        save("world.json", world)
        if verbose:
            print(f"world.json: {len(ps)} players on {version}")
    to_new = ruler(list(zip(old, neu)))

    for y in (2023, 2024, 2025):
        name = f"world_{y}.json"
        w = load(name)
        if w["meta"].get("ratingScale") == version:
            continue
        for p in w["players"]:
            shift(p, to_new(p["overall"]))
        rerate_clubs(w)
        w["meta"]["ratingScale"] = version
        save(name, w)
        if verbose:
            top = sorted((p["overall"] for p in w["players"]), reverse=True)[:3]
            print(f"{name}: {len(w['players'])} players mapped rank for rank, top {top}")

    ret = load("retired.json")
    if ret.get("ratingScale") != version:
        for r in ret["players"]:
            if r.get("peak") is not None:
                r["peak"] = to_new(r["peak"])
        ret["ratingScale"] = version
        save("retired.json", ret, indent=1)
        if verbose:
            print(f"retired.json: {len(ret['players'])} peaks mapped")


if __name__ == "__main__":
    sync_world()
