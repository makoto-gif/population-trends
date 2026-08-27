# 人口推移ビューア

世界（1800〜2100年）と日本の都道府県（1920〜2050年）の人口の推移を、
時系列で再生しながら見て、そのままスライド用の画像・PowerPoint として書き出すツール。

時価総額ランキングのビューアと同じ操作感で、扱う対象を「人口」に置き換えたもの。

## 公開URL

- **https://population-trends-ruby.vercel.app/** （Vercel・本番）
- https://makoto-gif.github.io/population-trends/ （GitHub Pages・予備）

どちらもログイン不要で誰でも使える。`main` に push すると Vercel が自動で再デプロイする。

---

## できること

| 機能 | 内容 |
|---|---|
| 推移グラフ | 折れ線。実績は実線、将来推計は破線。実績と推計の境目に縦線が入る |
| 世界地図 | 国ごとの人口を色の濃さで塗る。時系列の再生に連動し、国にカーソルを合わせると数値が出る |
| 地図の増減表示 | 期間の開始年を1倍として、増えた国を青・減った国を赤で塗り分ける |
| 時系列の再生 | 再生ボタンで年が進む。1位が入れ替わった年には注釈が出る |
| ランキング | 選んだ年の順位が横棒で入れ替わる（最大20位まで） |
| 対象の切替 | 世界（国・大陸・世界全体）／日本（47都道府県・全国） |
| 期間の指定 | 開始年と終了年を自由に選べる。よく使う期間はワンクリック |
| 見せ方の切替 | 人口そのもの／起点の年＝100の指数／全体に占める割合 |
| 未来ゾーン | 推計期間をグレーで塗り、「?」とキャッチ文言を入れられる |
| PNG 書き出し | 1920×1080px の16:9スライド画像 |
| PowerPoint 書き出し | 表紙・グラフ・世界地図・ランキング表・出典の5枚構成（.pptx）。日本モードでは地図を除いた4枚 |

出典表記はグラフの下と書き出したファイルの両方に自動で入る。
表示している期間に応じて、その期間に対応する情報源だけが表示される。

---

## 使い方

サーバー不要の静的サイト。ローカルで開くときは HTTP 経由で開く
（`file://` だと JSON の読み込みがブラウザにブロックされる）。

```bash
python3 -m http.server 4173 --directory 01_アプリ/population-trends
```

ブラウザで <http://localhost:4173> を開く。

Vercel に上げる場合は、このフォルダをそのままルートとして静的サイトとしてデプロイすればよい
（ビルド不要、`vercel.json` 同梱）。

---

## データの出典

人口データは公開されている一次情報をそのまま使っている。加工は単位の変換と結合のみ。

### 世界（`data/world.json`）

Our World in Data が、時代ごとに別々の情報源をつなぎ合わせて公開しているデータセットを使用。

| 期間 | 情報源 |
|---|---|
| 1800〜1949年 | [Gapminder v7](https://www.gapminder.org/data/documentation/gd003/) |
| 1950〜2023年（実績） | [国連 World Population Prospects 2024](https://population.un.org/wpp/) |
| 2024〜2100年（推計） | 同上・中位推計 |

- 統合データの配布元: <https://ourworldindata.org/grapher/population-with-projections>
- 情報源の解説: <https://ourworldindata.org/population-sources>
- ライセンス: CC BY（Our World in Data）

**注意**: 1949年以前は歴史人口学にもとづく推計値で、毎年の実測ではない。
国境も現在の国の領域に合わせて遡って割り当てられている。
細かい年ごとの上下ではなく、大きな流れを読むためのデータとして扱うこと。

### 世界地図の国境（`data/world-geo.json`）

| 内容 | 情報源 |
|---|---|
| 国境ポリゴン（110m 縮尺） | [Natural Earth – Admin 0 Countries](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/)（パブリックドメイン） |

座標は小数点2桁（約1km）に丸めて軽量化している（126KB）。
図法は正距円筒図法で、緯度は -58〜84 度で切っている（南極を除くため）。
人口データ側の国コード（ISO 3166-1 alpha-3）と全173か国が対応済み。

### 日本の都道府県（`data/japan.json`）

| 期間 | 情報源 |
|---|---|
| 1920〜2015年（実績） | 総務省統計局「国勢調査」時系列データ（[e-Stat](https://www.e-stat.go.jp/stat-search/database?tstat=000001011777)） |
| 2020年（実績） | 総務省統計局「令和2年国勢調査」 |
| 2025〜2050年（推計） | [国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5年推計）」](https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp) |

**注意**: 5年ごとの値。1945年は国勢調査ではなく人口調査で、沖縄県は調査されていないため欠測。
グラフ上は5年刻みの点を結んでいる（再生をなめらかにするため点の間は線形補間）。

---

## データを更新する

人口データの更新は年1〜2回程度。更新したくなったら2コマンドで作り直せる。

```bash
bash tools/fetch_raw.sh
python3 tools/build_data.py --raw tools/raw
python3 tools/build_geo.py  --raw tools/raw   # 国境データ。国境が変わらない限り不要
```

- `tools/fetch_raw.sh` … 一次情報を公開URLから取得する
- `tools/build_data.py` … `data/world.json` と `data/japan.json` を作り直す
- `tools/build_geo.py` … `data/world-geo.json`（世界地図）を作り直す
- `tools/jp_names.py` … 国名の日本語表記の対応表（国が増えたらここに足す）

Python の `openpyxl` が必要（社人研の xlsx を読むため）。

---

## ファイル構成

```
population-trends/
├── index.html
├── css/styles.css
├── js/
│   ├── data.js      データの読み込み・集計・数値の整形
│   ├── chart.js     Canvas でのグラフとスライドの描画（画面と書き出しで共用）
│   ├── map.js       世界地図（コロプレス図）の描画と当たり判定
│   ├── export.js    PNG / PowerPoint の書き出し
│   └── app.js       画面の状態管理とイベント
├── data/            アプリが読む JSON（tools で生成）
├── tools/           元データの取得と JSON 生成
└── vendor/          PptxGenJS（PowerPoint 生成）
```

グラフは外部のチャートライブラリを使わず Canvas に直接描いている。
画面プレビューと書き出し画像がまったく同じコードで描かれるので、
「プレビューと書き出しで見た目がずれる」ことが起きない。

---

## 配色について

- UI の色は GLOCAL GUNSHI のブランド定義（`00_ブランド/GLOCAL_GUNSHI/design.md`）に従う。
- グラフの系列色は、色覚多様性を考慮して検証済みの8色を固定順で使う。
  8色を超えて色を循環させない（線が読み取れなくなるため、グラフに出せるのは最大8系列）。
  ランキングでは、グラフに出していない項目はグレーで表示する。
- 地図の色は用途で使い分ける。人口の絶対値は単一色相の明→暗（sequential）、
  増減は赤↔青の2色相＋中央をグレーにした発散型（diverging）。
  倍率の刻みは期間の長さに応じて自動で切り替わる（1800→2100 のような長い期間では
  ほとんどの国が最濃になってしまい、差が読み取れなくなるため）。
