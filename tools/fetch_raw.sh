#!/bin/bash
# 元データを公開サイトから取得する。取得先は README.md に記載。
# 使い方: bash tools/fetch_raw.sh [保存先ディレクトリ]
set -euo pipefail

DEST="${1:-$(dirname "$0")/raw}"
mkdir -p "$DEST"
UA="Mozilla/5.0"

echo "▶ 世界（Our World in Data: HYDE + Gapminder + 国連WPP）"
curl -sSL -o "$DEST/pop_proj.csv" \
  "https://ourworldindata.org/grapher/population-with-projections.csv?v=1&csvType=full&useColumnShortNames=true"

echo "▶ 日本 都道府県 1920–2015（総務省統計局 国勢調査 時系列データ / e-Stat）"
curl -sSL -A "$UA" -o "$DEST/pref.csv" \
  "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000031524010&fileKind=1"

echo "▶ 日本 都道府県 2020–2050（国立社会保障・人口問題研究所 令和5年推計）"
curl -sSL -A "$UA" -o "$DEST/kekkahyo1.xlsx" \
  "https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/2gaiyo_hyo/kekkahyo1.xlsx"

echo "✔ 取得完了: $DEST"
echo "  次に: python3 tools/build_data.py --raw \"$DEST\""
