/* データの読み込みと集計。
   world.json は千人単位、japan.json は人単位で持っているので、
   ここで「人」に揃えてから外に出す。 */
(function (global) {
  'use strict';

  /** 検証済みカテゴリカル配色（dataviz スキルの reference palette / light）。
      並び順は固定。8色を超えて循環させない。 */
  var SERIES_COLORS = [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
    '#e87ba4', '#008300', '#4a3aa7', '#e34948'
  ];
  var MAX_SERIES = SERIES_COLORS.length;
  var NEUTRAL = '#B9B3B1';

  function Dataset(raw, mode) {
    this.mode = mode;
    this.meta = raw.meta;
    this.entities = raw.entities;
    this.byId = {};

    var scale = raw.meta.unit === 'thousand' ? 1000 : 1;
    var self = this;
    raw.entities.forEach(function (e) {
      e.values = e.v.map(function (v) { return v === null ? null : v * scale; });
      delete e.v;
      self.byId[e.id] = e;
    });

    // 年の並び。世界は毎年、日本は5年ごと。
    if (raw.meta.years) {
      this.years = raw.meta.years.slice();
    } else {
      this.years = [];
      for (var y = raw.meta.startYear; y <= raw.meta.endYear; y++) this.years.push(y);
    }
    this.startYear = this.years[0];
    this.endYear = this.years[this.years.length - 1];
    this.lastHistoricalYear = raw.meta.lastHistoricalYear;

    // 再生をなめらかにするため、内部では1年刻みの目盛りを持つ
    this.tickYears = [];
    for (var t = this.startYear; t <= this.endYear; t++) this.tickYears.push(t);
  }

  /** 指定年の人口。データ点がない年は前後から線形補間する（日本モードの5年刻み用）。 */
  Dataset.prototype.valueAt = function (id, year) {
    var e = this.byId[id];
    if (!e) return null;
    var ys = this.years;
    if (year <= ys[0]) return e.values[0];
    if (year >= ys[ys.length - 1]) return e.values[ys.length - 1];

    var hi = 1;
    while (hi < ys.length && ys[hi] < year) hi++;
    var lo = hi - 1;
    if (ys[lo] === year) return e.values[lo];

    var a = e.values[lo], b = e.values[hi];
    if (a === null || b === null) return a === null ? b : a;
    var t = (year - ys[lo]) / (ys[hi] - ys[lo]);
    return a + (b - a) * t;
  };

  /** 実データが存在する年だけを返す（グラフ上の丸印用）。 */
  Dataset.prototype.surveyYears = function (from, to) {
    return this.years.filter(function (y) { return y >= from && y <= to; });
  };

  Dataset.prototype.isFuture = function (year) {
    return year > this.lastHistoricalYear;
  };

  /** ランキングの母集団。世界モードは国のみ（世界全体・大陸は除く）。 */
  Dataset.prototype.pool = function () {
    var g = this.mode === 'world' ? 'country' : 'prefecture';
    return this.entities.filter(function (e) { return e.group === g; });
  };

  Dataset.prototype.regionGroups = function () {
    var order = [], map = {};
    this.pool().forEach(function (e) {
      var r = e.region || 'その他';
      if (!map[r]) { map[r] = []; order.push(r); }
      map[r].push(e);
    });
    // 世界モードでは大陸そのものも選べるようにする
    var extra = this.entities.filter(function (e) { return e.group === 'region' || e.group === 'world' || e.group === 'national'; });
    var groups = [];
    if (extra.length) groups.push({ name: this.mode === 'world' ? '全体・大陸' : '全体', items: extra });
    order.forEach(function (r) { groups.push({ name: r, items: map[r] }); });
    return groups;
  };

  /** その年の人口が多い順。null は除外。 */
  Dataset.prototype.rankingAt = function (year, limit) {
    var self = this;
    var rows = this.pool().map(function (e) {
      return { id: e.id, name: e.name, value: self.valueAt(e.id, year) };
    }).filter(function (r) { return r.value !== null && r.value > 0; });
    rows.sort(function (a, b) { return b.value - a.value; });
    return limit ? rows.slice(0, limit) : rows;
  };

  /** 「全体」に当たる系列（世界全体 / 全国）。割合の分母に使う。 */
  Dataset.prototype.totalAt = function (year) {
    var whole = this.entities.find(function (e) {
      return e.group === 'world' || e.group === 'national';
    });
    if (whole) return this.valueAt(whole.id, year);
    var sum = 0, self = this;
    this.pool().forEach(function (e) {
      var v = self.valueAt(e.id, year);
      if (v) sum += v;
    });
    return sum;
  };

  /** 順位1位が入れ替わった年を拾う（再生中の注釈用）。 */
  Dataset.prototype.leaderChanges = function (from, to) {
    var events = [], prev = null;
    for (var y = from; y <= to; y++) {
      var top = this.rankingAt(y, 1)[0];
      if (!top) continue;
      if (prev && top.id !== prev) {
        events.push({ year: y, id: top.id, name: top.name });
      }
      prev = top.id;
    }
    return events;
  };

  /* ---------- 表示用の数値整形 ---------- */

  function unitFor(mode) {
    return mode === 'world'
      ? { div: 1e8, suffix: '億人', axisSuffix: '億人' }
      : { div: 1e4, suffix: '万人', axisSuffix: '万人' };
  }

  function formatValue(v, mode, metric) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (metric === 'index') return v.toFixed(1);
    if (metric === 'share') return v.toFixed(1) + '%';
    // 1億人を境に単位を切り替える（0.28億人 のような読みにくい表記を避ける）
    if (v >= 1e8) {
      var o = v / 1e8;
      return o.toFixed(o >= 100 ? 0 : o >= 10 ? 1 : 2) + '億人';
    }
    if (v >= 1e4) {
      var m = v / 1e4;
      return m.toFixed(m >= 100 ? 0 : 1) + '万人';
    }
    return Math.round(v).toLocaleString('ja-JP') + '人';
  }

  /** 目盛りの刻み幅から小数点以下の桁数を決め、軸全体で表記を揃える。 */
  function formatAxis(v, mode, metric, step) {
    if (metric === 'index') return String(Math.round(v));
    if (metric === 'share') return Math.round(v) + '%';
    var u = unitFor(mode);
    var s = (step || v || 1) / u.div;
    var digits = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
    return (v / u.div).toFixed(digits);
  }

  function axisTitle(mode, metric) {
    if (metric === 'index') return '指数（起点の年＝100）';
    if (metric === 'share') return mode === 'world' ? '世界全体に占める割合（%）' : '全国に占める割合（%）';
    return '人口（' + unitFor(mode).axisSuffix + '）';
  }

  function load(mode) {
    var file = mode === 'world' ? 'data/world.json' : 'data/japan.json';
    return fetch(file).then(function (r) {
      if (!r.ok) throw new Error(file + ' を読み込めませんでした（' + r.status + '）');
      return r.json();
    }).then(function (raw) { return new Dataset(raw, mode); });
  }

  global.PopData = {
    load: load,
    SERIES_COLORS: SERIES_COLORS,
    MAX_SERIES: MAX_SERIES,
    NEUTRAL: NEUTRAL,
    formatValue: formatValue,
    formatAxis: formatAxis,
    axisTitle: axisTitle,
    unitFor: unitFor
  };
})(window);
