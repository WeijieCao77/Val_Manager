#!/usr/bin/env python3
"""
Who everybody is, decided from every source at once and keyed by vlr id.

    python3 scripts/build_people.py

Reads the registry (build_people_registry.py) and what each site says:

  vlr.gg       vlr_people.json (by id) and vlr_profiles.json (2026, by handle
               but each carries its id) — flag, real name, photo, clubs
  Liquipedia   liquipedia_players.json + liquipedia_births_hist.json, keyed by
               handle, so a page only counts when it is the same man: the
               country matches vlr's flag, or the real names agree
  thespike.gg  spike_people.json — every candidate behind the slug; the one
               that shares a club with him (or, failing that, the only one
               with his flag) is him
  号角          births_verified.json / haojiao_players.json, read by hand

and writes data-raw/people.json: per person nat / real / birth / photo with
the source that won and what the others said, plus analysis/people/audit.md
listing every disagreement for a human to look at. Nothing is fetched here.

Rules. Flag: majority of the sites that know him, vlr on a tie. Name: the
native-script name from Liquipedia or 号角 when it is the same man, else vlr,
else The Spike. Birthdate: 号角 by hand, Liquipedia, The Spike — and when two
disagree the row is reported, the earlier source in that order is kept.
"""
import json, os, re, unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *p: os.path.join(ROOT, *p)
J = lambda *p: json.load(open(P(*p))) if os.path.exists(P(*p)) else {}

src = open(P("scripts", "build_world.py")).read()
COUNTRY_OF = eval(re.search(r"COUNTRY_OF = (\{[\s\S]*?\n\})", src).group(1))
CODE_OF = {v: k for k, v in COUNTRY_OF.items() if k != "uk"}
CODE_OF.update({"korea": "kr", "türkiye": "tr", "czechia": "cz", "usa": "us", "uk": "gb", "macau": "mo", "cambodia": "kh",
                "egypt": "eg", "mongolia": "mn", "pakistan": "pk", "bangladesh": "bd", "sri lanka": "lk", "nepal": "np",
                "kazakhstan": "kz", "belarus": "by", "ecuador": "ec", "venezuela": "ve", "bolivia": "bo", "paraguay": "py",
                "dominican republic": "do", "costa rica": "cr", "puerto rico": "pr", "guatemala": "gt", "el salvador": "sv",
                "bosnia and herzegovina": "ba", "north macedonia": "mk", "albania": "al", "kosovo": "xk", "moldova": "md",
                "georgia": "ge", "armenia": "am", "azerbaijan": "az", "jordan": "jo", "lebanon": "lb", "iraq": "iq",
                "united arab emirates": "ae", "kuwait": "kw", "bahrain": "bh", "qatar": "qa", "tunisia": "tn", "algeria": "dz",
                "south africa": "za", "luxembourg": "lu", "malta": "mt", "cyprus": "cy", "montenegro": "me", "myanmar": "mm",
                "laos": "la", "brunei": "bn", "syria": "sy", "palestine": "ps", "iran": "ir", "libya": "ly", "oman": "om"})

reg = J("scripts", "cache", "people_registry.json")
people_vlr = J("scripts", "cache", "vlr_people.json")
profiles = J("scripts", "cache", "vlr_profiles.json")
spike = J("scripts", "cache", "spike_people.json")
spike_idx = J("scripts", "cache", "spike_player_index.json")
lp = {k.lower(): v for k, v in J("scripts", "cache", "liquipedia_births_hist.json").items()}
lp.update({k.lower(): v for k, v in J("data-raw", "liquipedia_players.json").items()})
verified = {k.lower(): v for k, v in (J("data-raw", "births_verified.json").get("players") or {}).items()}
hj = {k.lower(): v for k, v in (J("data-raw", "haojiao_players.json").get("players") or {}).items()}
homonyms = {k.lower(): v for k, v in (J("data-raw", "overrides.json").get("homonyms") or {}).items()}
flags_by_hand = {str(k): v for k, v in (J("data-raw", "overrides.json").get("flags") or {}).items() if not str(k).startswith("_")}
handles = {str(k): v for k, v in (J("data-raw", "overrides.json").get("handles") or {}).items() if isinstance(v, dict)}
lp_new = J("scripts", "cache", "liquipedia_people.json")      # fetch_liquipedia_people.py: titles guessed per person
lp_by_vlr = {str(v["vlr"]): v for v in lp_new.values() if v.get("page") and v.get("player") and v.get("vlr")}
DEMONYM = eval(re.search(r"DEMONYM = (\{[\s\S]*?\n\})", open(P("scripts", "fetch_liquipedia_people.py")).read()).group(1))
prof_by_id = {str(v["vlrId"]): v for k, v in profiles.items() if not k.startswith("_") and isinstance(v, dict) and v.get("vlrId")}


def norm_slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def tokens(s):
    s = unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode()
    return set(re.findall(r"[a-z]{3,}", s))


def club_key(s):
    s = unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode()
    s = re.sub(r"\b(esports?|gaming|team|club|e-sports|academy)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def names_agree(a, b):
    ta, tb = tokens(a), tokens(b)
    if ta and tb:
        return bool(ta & tb)
    ka = re.sub(r"[\s()（）]", "", a or ""); kb = re.sub(r"[\s()（）]", "", b or "")
    # native script on one side, "Roman (native)" on the other
    nat_a = re.findall(r"[぀-ヿ一-鿿가-힯Ѐ-ӿ]+", ka)
    nat_b = re.findall(r"[぀-ヿ一-鿿가-힯Ѐ-ӿ]+", kb)
    if not (nat_a and nat_b):
        return None                                   # cannot tell
    if set(nat_a) & set(nat_b):
        return True
    # 鄧閔維 and 邓闵维 are one name in two scripts, and nothing here can
    # convert them: same length in Han characters is "cannot tell", not "no"
    han = lambda xs: "".join(x for x in xs if re.match(r"[\u4e00-\u9fff]", x))
    ja, jb = han(nat_a), han(nat_b)
    if ja and jb and len(ja) == len(jb):
        return None
    return False


recheck = []     # handle pages whose owner is in doubt: fetch_liquipedia_people.py --recheck reads their vlr= field
out, report = {}, {"flag": [], "name": [], "birth": [], "lp_refused": [], "spike_weak": []}
stat = Counter()
for vid, q in reg["people"].items():
    ign = q["ign"]; k = ign.lower()
    v = people_vlr.get(vid) or prof_by_id.get(vid) or {}
    game = list(q["years"].values())
    g_nat = next((r["nat"] for r in game if r.get("nat")), None)
    v_nat = v.get("nat") if v.get("nat") not in (None, "un") else None
    base_nat = v_nat or g_nat
    v_real = v.get("real")
    clubs = {club_key(t["name"]) for t in (v.get("current") or []) + (v.get("past") or [])}
    clubs |= {club_key((e.get("team") or "").split(" ", 1)[-1]) for e in v.get("events") or []}
    clubs.discard("")

    # ---- Liquipedia: the page under his handle, if it is about him
    l = dict(lp.get(k) or {})
    h = homonyms.get(k)
    if h and str(h["vlr"]) != vid:
        l = {}
    elif h:
        l = {}     # the page is the other man's (that is why he is listed)
    # a page whose infobox names his vlr id is his, whatever it is titled; a
    # page found under a guessed title counts like the handle page does
    by_id = lp_by_vlr.get(vid)
    if by_id:
        l = dict(by_id)
    elif not l.get("birth"):
        for title in ((handles.get(vid) or {}).get("ign"), f"{ign} ({DEMONYM.get(base_nat or '', '?')} player)"):
            g = lp_new.get(title or "") or {}
            if g.get("page") and g.get("player") and not g.get("vlr"):
                l = dict(g); break
    # a name in a script the game's players mostly cannot read (Arabic, Thai,
    # Devanagari…) is shown in the romanisation the same infobox gives
    if l.get("real") and l.get("romanized") and re.search(r"[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0eff]", l["real"]):
        l["real"] = l["romanized"]
    # "Non-representing" first and the country second is how Liquipedia lists a
    # Russian under the neutral flag: the second line is where he is from
    l_nat = CODE_OF.get(str(l.get("country") or "").strip().lower()) or CODE_OF.get(str(l.get("country2") or "").strip().lower())
    if l.get("page") is False:
        l = {}
    if by_id:
        pass
    elif l and k in verified:
        pass
    elif l and (l.get("birth") or l.get("real")):
        agree = names_agree(l.get("real"), v_real)
        same = (l_nat and base_nat and l_nat == base_nat and agree is not False) or agree is True
        if not same and (l_nat and base_nat or agree is False):
            recheck.append(ign)
            report["lp_refused"].append(f"{ign} (vlr {vid}): Liquipedia page is {l.get('real')} / {l.get('country')}, vlr says {v_real} / {base_nat}")
            l, l_nat = {}, None

    # ---- The Spike: the candidate who shares a club, else the only one with his flag
    slugs = {norm_slug(ign), norm_slug((handles.get(vid) or {}).get("ign") or ign)}
    cands = [spike[s] for sl in slugs for s in spike_idx.get(sl, []) if s in spike and not spike[s].get("miss")]
    best, how = None, None
    for c in cands:
        sc = {club_key(t["title"]) for t in c["current"] + c["past"]}
        sc.discard("")
        if clubs & sc and (not c.get("nat") or len(c["nat"]) != 2 or not base_nat or c["nat"] == base_nat or names_agree(f"{c.get('name')} {c.get('surname')}", v_real)):
            best, how = c, "club"; break
    if not best:
        flagged = [c for c in cands if c.get("nat") == base_nat and (c.get("matches") or 0) >= 10]
        named = [c for c in flagged if names_agree(f"{c.get('name')} {c.get('surname')}", v_real)]
        if len(named) == 1:
            best, how = named[0], "flag+name"
        elif len(flagged) == 1 and len(cands) == 1 and names_agree(f"{flagged[0].get('name')} {flagged[0].get('surname')}", v_real) is not False:
            best, how = flagged[0], "flag only"
            report["spike_weak"].append(f"{ign} (vlr {vid}) ← thespike {best['id']} on flag alone")
    s = best or {}
    s_nat = s.get("nat") if s.get("nat") and len(s["nat"]) == 2 else None
    s_real = " ".join(x for x in (s.get("name"), s.get("surname")) if x).strip() or None
    if s_real and s_real.lower() == k:
        s_real = None

    # ---- flag
    # 号角's flag, where the page was read by hand (births_verified.json)
    h_nat = CODE_OF.get(str((verified.get(k) or {}).get("country") or "").strip().lower()) or (hj.get(k) or {}).get("nat")
    votes = Counter(x for x in (v_nat, l_nat, s_nat, h_nat) if x)
    # Not every voice is equal. A Liquipedia page proven his by its vlr= field
    # and a 号角 page read by hand are each worth a vote and a half; vlr and The
    # Spike one each (they agree with each other suspiciously often). So 2–2
    # between {vlr, Spike} and {Liquipedia, 号角} goes to the second pair
    # (jowa is Canadian, ra1ny Taiwanese), and 1–1 still keeps vlr.
    weight = Counter()
    for x, wt in ((v_nat, 1.0), (l_nat, 1.5 if by_id else 1.0), (s_nat, 1.0), (h_nat, 1.5)):
        if x:
            weight[x] += wt
    nat = base_nat
    if weight:
        top, n = weight.most_common(1)[0]
        if n >= 2 and top != base_nat and n > weight.get(base_nat, 0):
            nat = top
        elif base_nat in (None, "", "un"):
            # vlr's white "un" flag is not a country: it is what vlr shows for a
            # Russian playing as non-representing (Shao, SUYGETSU) and for anyone
            # it has no flag for. Any site that names a country beats it.
            nat = top
    if flags_by_hand.get(vid):
        nat = flags_by_hand[vid]          # the owner's call (overrides.json `flags`)
    if len(votes) > 1:
        if l_nat and l_nat != v_nat and not by_id:
            recheck.append(ign)
        tie = " ← 一比一，保留 vlr，待定" if weight.most_common(1)[0][1] < 2 else ""
        if flags_by_hand.get(vid):
            tie = " ← overrides.json 指定"
        sure = "（infobox 的 vlr 编号证实是他本人）" if by_id and l_nat else ""
        report["flag"].append(f"{ign} (vlr {vid}): game {g_nat} · vlr {v_nat} · Liquipedia {l_nat}{sure} · thespike {s_nat} · 号角 {h_nat} → {nat}{tie}")

    # ---- name
    ver = verified.get(k) or hj.get(k) or {}
    real = ver.get("realName") or (l.get("real") if l.get("real") and l["real"].lower() != k else None) or v_real or s_real
    real_src = "号角" if ver.get("realName") else "liquipedia" if l.get("real") and l["real"].lower() != k else "vlr" if v_real else "thespike" if s_real else None
    pairs = [(a, b) for a, b in ((v_real, s_real), (v_real, l.get("real")), (l.get("real"), s_real)) if a and b]
    if any(names_agree(a, b) is False for a, b in pairs):
        report["name"].append(f"{ign} (vlr {vid}): vlr「{v_real}」 Liquipedia「{l.get('real')}」 thespike「{s_real}」 → {real}")

    # ---- birthdate
    full = lambda d: d if d and re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", d) else None
    b_ver, b_lp, b_sp = full(ver.get("birth")), full(l.get("birth")), full(s.get("birth"))
    birth = b_ver or b_lp or b_sp
    birth_src = "号角" if b_ver else "liquipedia" if b_lp else "thespike" if b_sp else None
    iso = lambda d: "-".join(f"{int(x):02d}" for x in d.split("-")) if d else None
    if b_lp and b_sp and iso(b_lp) != iso(b_sp):
        report["birth"].append(f"{ign} (vlr {vid}): Liquipedia {b_lp} · thespike {b_sp} → {birth}")

    img = v.get("img") or s.get("img") or None
    out[vid] = {
        "ign": ign, "handleNow": v.get("handle") or ign, "nat": nat, "real": real, "birth": iso(birth),
        "img": img, "imgSrc": "vlr" if v.get("img") else "thespike" if s.get("img") else None,
        "src": {"nat": dict(votes), "real": real_src, "birth": birth_src, "spike": s.get("id"), "spikeHow": how},
        "lastMatch": max([d for d in (v.get("lastMatch"), s.get("lastMatch")) if d] or [None], key=lambda d: d or ""),
        # vlr's Current Teams only: The Spike also lists national sides (TenZ is
        # "currently on Canada" off one Nations Cup) and show-match fives
        "current": [t["name"] for t in v.get("current") or []],
        "spikeCurrent": [t["title"] for t in s.get("current") or [] if (t.get("title") or "").lower() not in CODE_OF],
        "currentRole": next((t.get("role") for t in v.get("current") or [] if t.get("role")), None)
                       or next((t.get("position") for t in s.get("current") or [] if t.get("position") not in (None, "Active", "Player", "Benched / Inactive")), None),
        "years": sorted(q["years"].keys()),
    }
    for f in ("nat", "real", "birth", "img"):
        stat[f] += bool(out[vid][f])

json.dump(out, open(P("data-raw", "people.json"), "w"), ensure_ascii=False, indent=1)
json.dump(sorted(set(recheck)), open(P("scripts", "cache", "liquipedia_recheck.json"), "w"), ensure_ascii=False)
with open(P("analysis", "people", "audit.md"), "w") as f:
    f.write(f"# People audit\n\n{len(out)} people · flag {stat['nat']} · real name {stat['real']} · birthdate {stat['birth']} · photo {stat['img']}\n")
    for key, title in (("flag", "Flags the sites disagree on"), ("name", "Real names the sites disagree on"),
                       ("birth", "Birthdates the sites disagree on"), ("lp_refused", "Liquipedia pages refused (another man under the same handle)"),
                       ("spike_weak", "thespike matched on flag alone")):
        f.write(f"\n## {title} ({len(report[key])})\n\n" + "\n".join(f"- {x}" for x in report[key]) + "\n")
print(f"{len(out)} people · flag {stat['nat']} · real {stat['real']} · birth {stat['birth']} · photo {stat['img']}")
print({k: len(v) for k, v in report.items()})
