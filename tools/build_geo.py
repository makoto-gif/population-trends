#!/usr/bin/env python3
"""Natural Earth の国境データをアプリ用の軽量ポリゴン JSON に変換する。

座標は小数点2桁（約1km）に丸め、丸めた結果の重複点を落とす。
出力は data/world-geo.json。

使い方:
    python3 tools/build_geo.py --raw <生データ置き場>
"""
import argparse
import json
import os
from datetime import date

# 南極と仏領南方・南極地域は定住人口がないので除く
SKIP = {"ATA", "ATF"}

# Natural Earth 側に ISO_A3 が無い（-99）ものの補正
FALLBACK = {
    "France": "FRA",
    "Norway": "NOR",
    "Kosovo": "OWID_KOS",
    "Somaliland": None,          # 人口データ側に対応する国がない
    "N. Cyprus": None,
    "Northern Cyprus": None,
}


def iso3(props):
    name = props.get("NAME") or props.get("ADMIN")
    if name in FALLBACK:
        return FALLBACK[name]
    for key in ("ISO_A3_EH", "ISO_A3", "ADM0_A3"):
        v = props.get(key)
        if v and v not in ("-99", -99):
            return v
    return None


def clean_ring(ring, digits=2):
    """座標を丸め、連続する重複点を落として平坦な配列にする。"""
    out = []
    last = None
    for pt in ring:
        x = round(pt[0], digits)
        y = round(pt[1], digits)
        if (x, y) == last:
            continue
        last = (x, y)
        out.append(x)
        out.append(y)
    if len(out) < 8:      # 4点未満のリングは描いても見えない
        return None
    return out


def rings_of(geom):
    t = geom["type"]
    if t == "Polygon":
        return geom["coordinates"]
    if t == "MultiPolygon":
        return [ring for poly in geom["coordinates"] for ring in poly]
    return []


def build(raw_dir, out_dir):
    src = os.path.join(raw_dir, "ne110m.geojson")
    gj = json.load(open(src, encoding="utf-8"))

    countries = []
    skipped = []
    for feat in gj["features"]:
        props = feat["properties"]
        code = iso3(props)
        if not code or code in SKIP:
            skipped.append(props.get("NAME"))
            continue
        polys = []
        for ring in rings_of(feat["geometry"]):
            flat = clean_ring(ring)
            if flat:
                polys.append(flat)
        if not polys:
            skipped.append(props.get("NAME"))
            continue
        countries.append({"id": code, "en": props.get("NAME_EN") or props.get("NAME"), "polys": polys})

    data = {
        "meta": {
            "builtAt": date.today().isoformat(),
            "projectionNote": "経緯度そのまま（正距円筒図法）。緯度は -58〜84 度で切る。",
            "source": {
                "name": "Natural Earth 110m Admin 0 – Countries（パブリックドメイン）",
                "url": "https://www.naturalearthdata.com/downloads/110m-cultural-vectors/",
            },
        },
        "countries": countries,
    }
    path = os.path.join(out_dir, "world-geo.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    pts = sum(len(r) // 2 for c in countries for r in c["polys"])
    print(f"地図: {len(countries)} か国 / {pts} 点 → {path} ({os.path.getsize(path)/1024:.0f} KB)")
    if skipped:
        print(f"  除外: {', '.join(str(s) for s in skipped)}")

    # 人口データ側と突き合わせて、色が塗られない国を洗い出す
    wpath = os.path.join(out_dir, "world.json")
    if os.path.exists(wpath):
        w = json.load(open(wpath, encoding="utf-8"))
        pop_ids = {e["id"] for e in w["entities"] if e["group"] == "country"}
        geo_ids = {c["id"] for c in countries}
        missing = sorted(geo_ids - pop_ids)
        if missing:
            print(f"  [warn] 人口データが無く灰色になる地域: {', '.join(missing)}")
        else:
            print("  すべての国が人口データと対応しています")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(out, exist_ok=True)
    build(args.raw, out)


if __name__ == "__main__":
    main()
