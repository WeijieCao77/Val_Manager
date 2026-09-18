"""
Step two of the calibration: pick E(d) from the probe table.

  python3 scripts/balance/fit_curve.py analysis/balance_v2/raw/probe_train_*.json

P5(E) is read off the TRAINING probe (isotonic, then linear between grid
points). The family is a softened knee, the smooth cousin of the old curve:

  E(d) = s0·d + (s1 − s0)·w·[softplus((d − k)/w) − softplus(−k/w)]

slope s0 near zero, s1 far out, the turn centred on k and w points wide;
E(0) = 0, E' in (s0, s1) everywhere, so it is continuous, strictly increasing
and cannot overshoot. For each width w the other three are fitted to the four
BO5 targets; the widest turn that still lands every target is preferred,
because a wide turn is what "no step at an integer" means.
"""
import json, math, sys

TARGETS = {2: 0.545, 3: 0.58, 5: 0.71, 10: 0.93}
rows = []
for path in sys.argv[1:]:
    rows += json.load(open(path))['grid']
rows.sort(key=lambda r: r['E'])
Es = [r['E'] for r in rows]

def isotonic(ys):
    ys = ys[:]; ws = [1.0] * len(ys); i = 0
    blocks = [[y, 1.0, 1] for y in ys]
    out = []
    for b in blocks:
        out.append(b)
        while len(out) > 1 and out[-2][0] > out[-1][0]:
            a = out.pop(); c = out.pop()
            out.append([(a[0]*a[1] + c[0]*c[1]) / (a[1]+c[1]), a[1]+c[1], a[2]+c[2]])
    res = []
    for v, _, n in out: res += [v] * n
    return res

def table(key):
    ys = isotonic([r[key]['rate'] for r in rows])
    ys[0] = 0.5  # E = 0 is 50% by symmetry; the sample said what it said, the truth is known
    def P(E):
        if E <= Es[0]: return ys[0]
        for i in range(1, len(Es)):
            if E <= Es[i]:
                t = (E - Es[i-1]) / (Es[i] - Es[i-1])
                return ys[i-1] + t * (ys[i] - ys[i-1])
        return ys[-1]
    return P
P5, P3 = table('bo5'), table('bo3')

def softplus(x): return x if x > 30 else math.log1p(math.exp(x))
def curve(s0, s1, k, w):
    base = softplus(-k / w)
    return lambda d: s0 * d + (s1 - s0) * w * (softplus((d - k) / w) - base)
def loss(p):
    E = curve(*p)
    return sum((P5(E(d)) - t) ** 2 for d, t in TARGETS.items())

def fit(w):
    best = None
    for s0 in [x / 100 for x in range(20, 71, 2)]:
        for s1 in [x / 100 for x in range(110, 191, 2)]:
            for k in [x / 10 for x in range(15, 46)]:
                l = loss((s0, s1, k, w))
                if best is None or l < best[0]: best = (l, s0, s1, k)
    return best

print('probe (training):  E  BO3  BO5')
for r in rows: print(f"  {r['E']:>5}  {r['bo3']['rate']*100:5.1f}  {r['bo5']['rate']*100:5.1f}")
print('\nE needed for each BO5 target:')
for d, t in TARGETS.items():
    lo, hi = 0.0, 25.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if P5(mid) < t: lo = mid
        else: hi = mid
    print(f'  +{d}: {t*100:.1f}%  ->  E = {lo:.2f}')
print('\nwidth   s0    s1    k     rms error (pp)   P5 at +2 +3 +5 +10')
for w in [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]:
    l, s0, s1, k = fit(w)
    E = curve(s0, s1, k, w)
    print(f'  {w:<5} {s0:.2f}  {s1:.2f}  {k:.1f}   {math.sqrt(l/4)*100:5.2f}           ' + '  '.join(f'{P5(E(d))*100:.1f}' for d in TARGETS))
if len(sys.argv) and '--show' in sys.argv: pass
