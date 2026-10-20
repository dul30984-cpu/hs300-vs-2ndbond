# -*- coding: utf-8 -*-
"""CI builder: fetch CSI300 total return + rebuild the secondary-bond-fund index,
then write data.json at the repository root (consumed by the static site).

Runs on GitHub Actions (ubuntu) and locally.
"""
import os, re, ssl, json, time, pickle, http.cookiejar
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("CACHE", os.path.join(BASE, ".cache"))
OUT = os.environ.get("OUT", os.path.join(BASE, "data.json"))
os.makedirs(CACHE, exist_ok=True)

ANCHOR_DATE = "2026-10-16"
ANCHOR_VALUE = 5163.65
CORE_TYPE = "债券型-混合二级"
BROAD_TYPES = ["债券型-混合二级", "混合型-偏债", "债券型-混合一级"]
CACHE_TTL_H = 20
MAX_FAIL_RATIO = 0.2

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj),
    urllib.request.HTTPSHandler(context=ctx))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

def _get(url, referer="http://fund.eastmoney.com/", timeout=40):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": referer, "Accept": "*/*"})
    return opener.open(req, timeout=timeout).read()

def get_fund_list(force=False):
    path = os.path.join(CACHE, "fundlist.json")
    if not force and os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_TTL_H * 3600:
        return json.load(open(path, encoding="utf-8"))
    _get("http://fund.eastmoney.com/")
    txt = _get("http://fund.eastmoney.com/js/fundcode_search.js").decode("utf-8", "replace")
    arr = json.loads(txt[txt.find("["):txt.rfind("]") + 1])
    json.dump(arr, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return arr

def parse_fund(txt):
    m_name = re.search(r'fS_name\s*=\s*"([^"]*)"', txt)
    m_nav = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", txt, re.S)
    m_ac = re.search(r"Data_ACWorthTrend\s*=\s*(\[.*?\]);", txt, re.S)
    if not m_nav or not m_ac:
        return None
    name = m_name.group(1) if m_name else ""
    net = json.loads(m_nav.group(1))
    ac = json.loads(m_ac.group(1))
    ac_map = {int(p[0]): float(p[1]) for p in ac if p and len(p) >= 2}

    pts = []
    for e in net:
        nav = e.get("y")
        if nav is None or float(nav) <= 0:
            continue
        pts.append((int(e["x"]), float(nav), e.get("unitMoney") or ""))
    if len(pts) < 2:
        return None
    pts.sort()

    vals = [1.0]
    for i in range(1, len(pts)):
        ts_prev, nav_prev, _ = pts[i - 1]
        ts_cur, nav_cur, um = pts[i]
        ac_prev, ac_cur = ac_map.get(ts_prev), ac_map.get(ts_cur)
        if ac_prev and ac_cur and nav_prev > 0:
            r = (ac_cur - ac_prev) / nav_prev
            if "折算" in um or "拆分" in um:
                r = 0.0
            if abs(r) > 0.5:
                r = nav_cur / nav_prev - 1
        else:
            r = nav_cur / nav_prev - 1
        r = max(min(r, 0.5), -0.5)
        vals.append(vals[-1] * (1 + r))
    return name, [p[0] for p in pts], vals

def fetch_fund(code, force=False):
    path = os.path.join(CACHE, code + ".pkl")
    if not force and os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_TTL_H * 3600:
        try:
            with open(path, "rb") as f:
                return pickle.load(f)
        except Exception:
            pass
    last = None
    for attempt in range(3):
        try:
            txt = _get(f"http://fund.eastmoney.com/pingzhongdata/{code}.js").decode("utf-8", "replace")
            res = parse_fund(txt) or ("__EMPTY__", [], [])
            try:
                with open(path, "wb") as f:
                    pickle.dump(res, f)
            except Exception:
                pass
            return res
        except Exception as e:
            last = e
            time.sleep(0.4 + attempt * 0.8)
    return ("__ERR__", [], [])

def fetch_hs300():
    url = ("https://www.csindex.com.cn/csindex-home/perf/index-perf"
           "?indexCode=H00300&startDate=20041231&endDate=20261231")
    d = json.loads(_get(url, referer="https://www.csindex.com.cn/", timeout=90).decode("utf-8", "replace"))
    rows = [{"date": pd.to_datetime(x["tradeDate"]), "close": float(x["close"])}
            for x in d.get("data", []) if x.get("close") is not None]
    df = pd.DataFrame(rows).drop_duplicates("date").sort_values("date").reset_index(drop=True)
    return df.set_index("date")["close"]

def clean_name(name):
    n = re.sub(r"[（(][^)）]*[)）]", "", name)
    return re.sub(r"(A/B|B/A|C/A|A/C|E/A|A/E|A|B|C|D|E|I|O|R|Y)$", "", n.strip())

def comp_index(panel, cal):
    panel = panel.reindex(panel.index.union(cal)).ffill()
    first = panel.apply(lambda s: s.first_valid_index())
    last = panel.apply(lambda s: s.last_valid_index())
    mask = pd.DataFrame(False, index=panel.index, columns=panel.columns)
    for c in panel.columns:
        mask.loc[first[c]:last[c], c] = True
    panel = panel.where(mask).reindex(cal)
    rets = panel.pct_change(fill_method=None).where(lambda x: x.abs() < 0.2)
    r = rets.mean(axis=1)
    r.iloc[0] = 0.0
    return 1000 * (1 + r.fillna(0)).cumprod()

def build(force=False, verbose=True):
    t0 = time.time()
    def log(msg):
        if verbose:
            print(f"[{time.time()-t0:6.1f}s] {msg}", flush=True)

    log("fetch CSI300 total return")
    hs = fetch_hs300()
    hs = hs.loc[hs.index >= "2004-12-31"]

    log("fetch fund list")
    arr = get_fund_list()
    core = [a for a in arr if a[3] == CORE_TYPE]
    broad = [a for a in arr if a[3] in BROAD_TYPES]
    core_names = set(clean_name(a[2]) for a in core)
    broad_names = set(clean_name(a[2]) for a in broad)
    all_codes = list(dict.fromkeys([a[0] for a in broad] + [a[0] for a in core]))
    log(f"fund codes: {len(all_codes)}")

    results, done, fail = {}, 0, 0
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(fetch_fund, c, force): c for c in all_codes}
        for fut in as_completed(futs):
            code = futs[fut]
            try:
                results[code] = fut.result()
            except Exception:
                results[code] = ("__ERR__", [], [])
            if results[code][0] == "__ERR__":
                fail += 1
            done += 1
            if done % 200 == 0:
                log(f"funds {done}/{len(all_codes)} (fail {fail})")
    if fail > MAX_FAIL_RATIO * len(all_codes):
        raise RuntimeError(f"too many fetch failures: {fail}/{len(all_codes)}")

    def to_panel(names):
        best = {}
        for c, (name, ts, vals) in results.items():
            if name in ("__ERR__", "__EMPTY__") or len(ts) < 30:
                continue
            k = clean_name(name)
            if k not in names:
                continue
            if k not in best or ts[0] < best[k][0]:
                best[k] = (ts[0], ts, vals)
        cols = {}
        for k, (_, ts, vals) in best.items():
            s = pd.Series(vals, index=pd.to_datetime(pd.Series(ts), unit="ms").values)
            s = s[~s.index.duplicated(keep="last")].sort_index()
            cols[k] = s
        return pd.DataFrame(cols).sort_index()

    core_panel = to_panel(core_names)
    broad_panel = to_panel(broad_names)
    core_idx = comp_index(core_panel, hs.index)
    broad_idx = comp_index(broad_panel, hs.index)

    anchor = pd.Timestamp(ANCHOR_DATE)
    k = ANCHOR_VALUE / float(broad_idx.loc[anchor])
    w = np.arange(len(broad_idx)) / (len(broad_idx) - 1)
    bond_cal = broad_idx * (k ** w)

    sp = np.log(hs / bond_cal)
    sg = np.sign(sp)
    cr = sp.index[(sg.shift(1) * sg) < 0]
    crossings, prev, eps = [], None, []
    for d in cr:
        if prev is None or (d - prev).days > 120:
            eps.append([d])
        else:
            eps[-1].append(d)
        prev = d
    below_days = 0
    for e in eps:
        seg = sp.loc[e[0]:e[-1]]
        if seg.min() >= 0:
            continue
        d = seg.idxmin()
        below_days += int((seg < 0).sum())
        crossings.append({"date": d.strftime("%Y-%m-%d"),
                          "hs300": round(float(hs[d]), 2),
                          "bond": round(float(bond_cal[d]), 2),
                          "depth": round(float(seg.min() * 100), 2),
                          "start": e[0].strftime("%Y-%m-%d"),
                          "end": e[-1].strftime("%Y-%m-%d")})

    meta = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "hs300_last": hs.index[-1].strftime("%Y-%m-%d"),
        "hs300_last_close": round(float(hs.iloc[-1]), 2),
        "n_funds_core": int(core_panel.shape[1]),
        "n_funds_broad": int(broad_panel.shape[1]),
        "n_series": len(results),
        "fetch_fail": fail,
        "anchor_date": ANCHOR_DATE,
        "anchor_value": ANCHOR_VALUE,
        "below_days": below_days,
        "duration_s": round(time.time() - t0, 1),
    }
    data = {
        "dates": [d.strftime("%Y-%m-%d") for d in hs.index],
        "hs300": [round(float(v), 2) for v in hs.values],
        "bond_core": [round(float(v), 2) for v in core_idx.values],
        "bond_cal": [round(float(v), 2) for v in bond_cal.values],
        "crossings": crossings,
        "meta": meta,
    }
    tmp = OUT + ".tmp"
    json.dump(data, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, OUT)
    log(f"wrote {OUT}")
    log(json.dumps(meta, ensure_ascii=False))
    return meta

if __name__ == "__main__":
    build()
