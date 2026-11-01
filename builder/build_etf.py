# -*- coding: utf-8 -*-
"""Fetch the "top-4 CSI300 ETF AUM / CSI300 market cap" series from legulegu.com.

The chart on https://legulegu.com/stockdata/hs300-etf-ratio is driven by a
public JSON endpoint guarded by an MD5(date) token plus a session cookie.
"""
import hashlib, http.cookiejar, json, os, ssl, time, urllib.request
from datetime import datetime, timedelta, timezone

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
PAGE = "https://legulegu.com/stockdata/hs300-etf-ratio"

def _opener():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPSHandler(context=ctx))

def fetch_etf_ratio(verbose=True):
    opener = _opener()
    headers = {"User-Agent": UA, "Accept": "application/json, text/plain, */*",
               "Accept-Language": "zh-CN,zh;q=0.9"}

    def get(url, referer=PAGE):
        req = urllib.request.Request(url, headers={**headers, "Referer": referer})
        return opener.open(req, timeout=45).read()

    get(PAGE, referer="https://legulegu.com/")     # seed session cookie
    bj = datetime.now(timezone(timedelta(hours=8)))
    rows = None
    for attempt in range(3):
        day = bj - timedelta(days=attempt)
        token = hashlib.md5(day.strftime("%Y-%m-%d").encode()).hexdigest()
        try:
            raw = get(f"https://legulegu.com/api/stockdata/hs300-etf-ratio?token={token}")
            payload = json.loads(raw.decode("utf-8"))
            rows = payload.get("data") if isinstance(payload, dict) else payload
            if rows:
                break
        except Exception:
            time.sleep(1 + attempt)
    if not rows:
        raise RuntimeError("legulegu ratio api unavailable")

    valid = [r for r in rows if r.get("ratio") is not None and r.get("floatMv")]
    valid.sort(key=lambda r: r["tradeDate"])
    if verbose:
        print(f"etf ratio: {len(valid)} rows, {valid[0]['tradeDate']} -> {valid[-1]['tradeDate']}", flush=True)

    def rnd(v, n=2):
        return round(float(v), n) if v is not None else None

    data = {
        "dates": [r["tradeDate"] for r in valid],
        "etf_mv": [rnd(r["etfNavMv"], 1) for r in valid],
        "float_mv": [rnd(r["floatMv"], 1) for r in valid],
        "free_mv": [rnd(r["freeFloatMv"], 1) for r in valid],
        "total_mv": [rnd(r["totalMv"], 1) for r in valid],
        "ratio_float": [rnd(r["etfNavMv"] / r["floatMv"] * 100, 3) for r in valid],
        "ratio_free": [rnd(r["etfNavMv"] / r["freeFloatMv"] * 100, 3) for r in valid],
        "ratio_total": [rnd(r["etfNavMv"] / r["totalMv"] * 100, 3) for r in valid],
        "hs300": [rnd(r["hs300Close"], 2) for r in valid],
        "meta": {
            "source": "legulegu.com",
            "source_url": PAGE,
            "definition": "华泰柏瑞510300 + 易方达510310 + 嘉实159919 + 华夏510330 四只ETF资产净值之和 / 沪深300市值",
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "last_date": valid[-1]["tradeDate"],
            "n": len(valid),
        },
    }
    return data

def write_etf_json(out_path):
    data = fetch_etf_ratio()
    tmp = out_path + ".tmp"
    json.dump(data, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, out_path)
    return data["meta"]

if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "etf.json")
    print(json.dumps(write_etf_json(out), ensure_ascii=False))
