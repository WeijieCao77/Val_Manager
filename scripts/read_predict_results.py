"""
赛事预测: read Champions Shanghai's group results and playoff bracket off vlr.gg
and print them in the shapes the code takes — nothing is written.

  python3 scripts/read_predict_results.py

Two requests, 5 s apart (vlr has rate-limited this project before). The output
is for a person to compare and paste:
  - each finished group as a src/data/predictResults.json row (winners, first, second)
  - the upper quarterfinals as CHAMPIONS_2026_PLAYOFFS.quarters, in vlr's order
  - finished playoff matches as src/data/predictPlayoffResults.json winners
confirmedAt is left for the person to set once they have checked the rows.
"""
import html
import json
import re
import time
import urllib.request

EVENT = 'https://www.vlr.gg/event/2766/valorant-champions-2026'
TAGS = {
    '100 Thieves': '100T', 'T1': 'T1', 'JD Gaming': 'JDG', 'FUT Esports': 'FUT',
    'Global Esports': 'GE', 'Team Vitality': 'VIT', 'LOUD': 'LOUD', 'EDward Gaming': 'EDG',
    'Team Liquid': 'TL', 'Paper Rex': 'PRX', 'TYLOO': 'TYL', 'G2 Esports': 'G2',
    'Nongshim RedForce': 'NS', 'NRG': 'NRG', 'Karmine Corp': 'KC', 'Xi Lai Gaming': 'XLG',
}
# the group's opening pairs, in the order src/engine/predict.ts writes them
GROUPS = {'A': ['100T', 'T1', 'JDG', 'FUT'], 'B': ['GE', 'VIT', 'LOUD', 'EDG'],
          'C': ['TL', 'PRX', 'TYL', 'G2'], 'D': ['NS', 'NRG', 'KC', 'XLG']}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode('utf-8')


def text(s):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def tag(name):
    return TAGS.get(name, '?' + name)


def items(page):
    """every bracket box on a vlr page: its link, both team names and both scores"""
    out = []
    for href, body in re.findall(r'<a class="bracket-item[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S):
        teams = [text(n) for n in re.findall(r'bracket-item-team-name[^>]*>(.*?)</div>', body, re.S)]
        score = [text(x) for x in re.findall(r'bracket-item-team-score[^>]*>(.*?)</div>', body, re.S)]
        out.append((href, teams, score))
    return out


def finished(teams, score):
    """(winner, loser) for a finished best-of-three or -five, else None"""
    if len(teams) != 2 or len(score) != 2 or not all(x.isdigit() for x in score) or score[0] == score[1] \
            or max(map(int, score)) < 2:
        return None
    a, b = tag(teams[0]), tag(teams[1])
    return (a, b) if int(score[0]) > int(score[1]) else (b, a)


def groups(page):
    """per group: (team, team, winner, loser) for each finished match, from the links' -opening-c style endings"""
    out = {k: [] for k in 'ABCD'}
    for href, teams, score in items(page):
        m = re.search(r'-(opening|winners|elim|decider)-([a-d])$', href)
        r = finished(teams, score)
        if m and r:
            out[m.group(2).upper()].append((r[0], r[1], r[0], r[1]))
    return out


def slots(key, res):
    t0, t1, t2, t3 = GROUPS[key]
    meet = lambda x, y: next((m for m in res if {m[0], m[1]} == {x, y}), None)
    o1, o2 = meet(t0, t1), meet(t2, t3)
    w = o1 and o2 and meet(o1[2], o2[2])
    e = o1 and o2 and meet(o1[3], o2[3])
    d = w and e and meet(w[3], e[2])
    if not (o1 and o2 and w and e and d):
        return None
    win = {'o1': o1[2], 'o2': o2[2], 'w': w[2], 'e': e[2], 'd': d[2]}
    return {'winners': win, 'first': w[2], 'second': d[2], 'confirmedAt': 'SET-AFTER-CHECKING'}


def bracket(page):
    """playoff boxes by slot: vlr's column order is the order of the slots in each round"""
    order = {'ubqf': ['q1', 'q2', 'q3', 'q4'], 'ubsf': ['s1', 's2'], 'ubf': ['uf'], 'gf': ['gf'],
             'lr1': ['l1a', 'l1b'], 'lr2': ['l2a', 'l2b'], 'lr3': ['l3'], 'lbf': ['lf']}
    seen = {k: 0 for k in order}
    out = {}
    for href, teams, score in items(page):
        m = re.search(r'-(ubqf|ubsf|ubf|gf|lr1|lr2|lr3|lbf)$', href)
        if not m:
            continue
        r = m.group(1)
        if seen[r] < len(order[r]):
            out[order[r][seen[r]]] = (teams, score)
            seen[r] += 1
    return out


if __name__ == '__main__':
    gp = get(EVENT + '/group-stage')
    time.sleep(5)
    po = get(EVENT + '/playoffs')
    print('== groups (predictResults.json rows; check against the vlr group page before pasting)')
    for key, res in groups(gp).items():
        row = slots(key, res)
        print(key, json.dumps(row, ensure_ascii=False) if row else f'not finished ({len(res)} of 5 played)')
    print('\n== playoffs')
    b = bracket(po)
    q = [[tag(x) for x in b[k][0]] for k in ['q1', 'q2', 'q3', 'q4'] if k in b]
    drawn = len(q) == 4 and all(len(m) == 2 and all(x and not x.startswith('?') for x in m) for m in q)
    print('quarters:', json.dumps(q) if drawn else f'not drawn yet {q}')
    done = {k: finished(*b[k])[0] for k in b if finished(*b[k])}
    print('finished winners:', json.dumps(done))
