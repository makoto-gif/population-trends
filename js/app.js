/* 画面の状態管理と描画のとりまとめ。 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var DEFAULTS = {
    world: { from: 1800, to: 2100, callout: 'この先、どこが伸びるか' },
    japan: { from: 1920, to: 2050, callout: 'この先、どこが残るか' }
  };

  var PRESETS = {
    world: [
      { label: '全期間 1800→2100', from: 1800, to: 2100 },
      { label: '1900→2100', from: 1900, to: 2100 },
      { label: '戦後 1950→2100', from: 1950, to: 2100 },
      { label: '直近と近未来 2000→2050', from: 2000, to: 2050 }
    ],
    japan: [
      { label: '全期間 1920→2050', from: 1920, to: 2050 },
      { label: '戦後 1950→2050', from: 1950, to: 2050 },
      { label: '2000→2050', from: 2000, to: 2050 }
    ]
  };

  var state = {
    view: 'explore', mode: 'world', pick: 'top', topN: 5,
    rankAtYear: null, manualIds: [], yearFrom: 1800, yearTo: 2100,
    metric: 'abs', showFuture: true, showCallout: true,
    calloutText: DEFAULTS.world.callout, currentYear: 2100,
    rankN: 10, slideTitle: '', slideSubtitle: '', playing: false,
    mapMode: 'abs', hoverId: null
  };

  var ds = null;               // 現在の Dataset
  var geo = null;              // 世界地図のポリゴン（世界モードで初回表示時に読み込む）
  var mapGeom = null;          // 地図の当たり判定用ジオメトリ
  var cache = {};              // モードごとのキャッシュ
  var series = [];             // 描画中の系列
  var leaderEvents = [];
  var rankNodes = {};          // ランキングの li を id で使い回す
  var chartGeom = null;
  var rafId = null, eventTimer = null;

  /* ================= データ ================= */

  function switchMode(mode) {
    state.mode = mode;
    var d = DEFAULTS[mode];
    state.yearFrom = d.from;
    state.yearTo = d.to;
    state.calloutText = d.callout;
    state.manualIds = [];
    state.pick = 'top';
    state.hoverId = null;
    $('#calloutText').value = d.callout;

    var p = cache[mode] ? Promise.resolve(cache[mode]) : PopData.load(mode).then(function (x) {
      cache[mode] = x; return x;
    });
    return p.then(function (dataset) {
      ds = dataset;
      state.rankAtYear = ds.lastHistoricalYear;
      state.currentYear = state.yearTo;
      buildYearSelects();
      buildPresets();
      buildPicker();
      renderSources();
      syncControls();
      recompute();
    });
  }

  function selectedEntities() {
    if (state.pick === 'manual') {
      return state.manualIds.map(function (id) { return ds.byId[id]; }).filter(Boolean);
    }
    var rows = ds.rankingAt(state.rankAtYear, state.topN);
    return rows.map(function (r) { return ds.byId[r.id]; });
  }

  function transform(id, year, base) {
    var v = ds.valueAt(id, year);
    if (v === null) return null;
    if (state.metric === 'index') return base ? v / base * 100 : null;
    if (state.metric === 'share') {
      var total = ds.totalAt(year);
      return total ? v / total * 100 : null;
    }
    return v;
  }

  function recompute() {
    var ents = selectedEntities();
    series = ents.map(function (e, i) {
      var base = ds.valueAt(e.id, state.yearFrom);
      var points = [];
      for (var y = state.yearFrom; y <= state.yearTo; y++) {
        points.push({ year: y, value: transform(e.id, y, base) });
      }
      return {
        id: e.id, name: e.name,
        color: PopData.SERIES_COLORS[i % PopData.SERIES_COLORS.length],
        points: points, endLabel: ''
      };
    });
    leaderEvents = state.pick === 'top'
      ? ds.leaderChanges(state.yearFrom, state.yearTo)
      : [];
    render();
  }

  /* ================= 描画 ================= */

  function chartSpec(showAll) {
    var year = showAll ? state.yearTo : state.currentYear;
    series.forEach(function (se) {
      var p = null;
      for (var i = se.points.length - 1; i >= 0; i--) {
        if (se.points[i].year <= year && se.points[i].value !== null) { p = se.points[i]; break; }
      }
      se.endLabel = p ? PopData.formatValue(p.value, state.mode, state.metric) : '';
    });
    return {
      series: series,
      yearFrom: state.yearFrom, yearTo: state.yearTo,
      currentYear: year,
      boundaryYear: ds.lastHistoricalYear,
      showFuture: state.showFuture,
      showCallout: state.showCallout,
      calloutText: state.calloutText,
      metric: state.metric,
      markerYears: ds.years.filter(function (y) { return y >= state.yearFrom && y <= state.yearTo; }),
      axisTitle: PopData.axisTitle(state.mode, state.metric),
      formatAxis: function (v, step) { return PopData.formatAxis(v, state.mode, state.metric, step); }
    };
  }

  function sizeCanvas(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx: ctx, w: rect.width, h: rect.height };
  }

  function render() {
    if (!ds) return;
    renderChart();
    renderRanking();
    renderMap();
    renderSlide();
    renderLabels();
  }

  function renderChart() {
    var c = sizeCanvas($('#chart'));
    if (!c) return;
    c.ctx.fillStyle = '#fff';
    c.ctx.fillRect(0, 0, c.w, c.h);
    chartGeom = PopChart.drawChart(c.ctx, { x: 0, y: 0, w: c.w, h: c.h }, chartSpec(false));
  }

  /* ---------- 世界地図 ---------- */

  /** 地図に塗る値を国ごとに一度だけ計算する。 */
  function mapSpec() {
    var year = Math.round(state.currentYear);
    var values = {}, hasNoData = false;

    geo.countries.forEach(function (c) {
      var v = ds.byId[c.id] ? ds.valueAt(c.id, year) : null;
      if (v !== null && state.mapMode === 'ratio') {
        var base = ds.valueAt(c.id, state.yearFrom);
        v = base ? v / base : null;
      }
      if (v === null) hasNoData = true;
      values[c.id] = v;
    });

    return {
      geo: geo,
      mapMode: state.mapMode,
      values: values,
      hasNoData: hasNoData,
      highlightId: state.hoverId,
      yearLabel: year + '年' + (ds.isFuture(year) ? '（推計）' : ''),
      valueOf: function (id) { return values[id]; }
    };
  }

  function mapSlideSpec() {
    var spec = mapSpec();
    var year = Math.round(state.currentYear);
    spec.title = state.slideTitle || (state.mapMode === 'ratio'
      ? state.yearFrom + '年から' + year + '年で、人口はどこが増えたか'
      : year + '年の世界の人口分布');
    spec.subtitle = state.slideSubtitle || (state.mapMode === 'ratio'
      ? '色が濃い青ほど増加、赤は減少（' + state.yearFrom + '年＝1倍）'
      : '国ごとの人口を色の濃さで表示');
    spec.footnote = footnote();
    return spec;
  }

  function renderMap() {
    if (state.view !== 'map') return;
    var usable = state.mode === 'world' && geo;
    $('#mapNotice').hidden = usable;
    if (!usable) { mapGeom = null; return; }

    var c = sizeCanvas($('#map'));
    if (!c) return;
    c.ctx.fillStyle = '#fff';
    c.ctx.fillRect(0, 0, c.w, c.h);
    mapGeom = PopMap.drawMap(c.ctx, { x: 0, y: 0, w: c.w, h: c.h }, mapSpec());
  }

  function ensureGeo() {
    if (geo || state.mode !== 'world') return;
    PopData.loadGeo().then(function (g) {
      geo = g;
      renderMap();
    }).catch(function (err) {
      toast(err.message);
      console.error(err);
    });
  }

  function onMapMove(ev) {
    if (!mapGeom) return;
    var canvas = $('#map');
    var rect = canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var hitCountry = PopMap.countryAt(mapGeom, x, y);
    var tip = $('#mapTooltip');

    if (!hitCountry) {
      tip.hidden = true;
      if (state.hoverId) { state.hoverId = null; renderMap(); }
      return;
    }
    if (state.hoverId !== hitCountry.id) { state.hoverId = hitCountry.id; renderMap(); }

    var year = Math.round(state.currentYear);
    var e = ds.byId[hitCountry.id];
    var pop = e ? ds.valueAt(e.id, year) : null;
    var rows = '<div class="tooltip__row">' + (e ? e.name : hitCountry.id) +
      '<span class="tooltip__val">' + (pop === null ? 'データなし' : PopData.formatValue(pop, 'world', 'abs')) + '</span></div>';
    if (state.mapMode === 'ratio' && e) {
      var base = ds.valueAt(e.id, state.yearFrom);
      rows += '<div class="tooltip__row">' + state.yearFrom + '年から' +
        '<span class="tooltip__val">' + (base && pop !== null ? (pop / base).toFixed(2) + '倍' : '—') + '</span></div>';
    }
    tip.innerHTML = '<div class="tooltip__year">' + year + '年' +
      (ds.isFuture(year) ? '（推計）' : '') + '</div>' + rows;
    tip.hidden = false;
    var tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(x, tw / 2 + 4), rect.width - tw / 2 - 4) + 'px';
    tip.style.top = Math.max(y - 12, tip.offsetHeight + 6) + 'px';
  }

  /** スライド枠を、はみ出さない側の辺に合わせて16:9の実寸で置く。 */
  function layoutSlideStage() {
    var stage = $('.slidestage'), wrap = $('.slidewrap');
    if (!stage || !wrap) return;
    if (getComputedStyle(stage).display === 'block') {   // 折り返しレイアウトでは CSS に任せる
      wrap.style.width = '';
      wrap.style.height = '';
      return;
    }
    var r = stage.getBoundingClientRect();
    var w = Math.floor(Math.min(r.width, r.height * 16 / 9));
    wrap.style.width = w + 'px';
    wrap.style.height = Math.floor(w * 9 / 16) + 'px';
  }

  function renderSlide() {
    if (state.view !== 'slide') return;
    layoutSlideStage();
    var c = sizeCanvas($('#slide'));
    if (!c) return;
    PopChart.drawSlide(c.ctx, c.w, c.h, slideSpec());
  }

  function slideSpec() {
    var spec = chartSpec(false);
    spec.title = state.slideTitle || autoTitle();
    spec.subtitle = state.slideSubtitle || autoSubtitle();
    spec.footnote = footnote();
    return spec;
  }

  function autoTitle() {
    var what = state.mode === 'world' ? '世界の人口' : '日本の人口';
    if (state.pick === 'top') {
      what = state.mode === 'world'
        ? '世界の人口トップ' + state.topN + 'の推移と、これから'
        : '都道府県 人口トップ' + state.topN + 'の推移と、これから';
    } else {
      what = what + 'の推移と、これから';
    }
    return what;
  }

  function autoSubtitle() {
    return state.yearFrom + '年 → ' + ds.lastHistoricalYear + '年 → ' + state.yearTo + '年（推計）';
  }

  function footnote() {
    var parts = [];
    if (state.mode === 'world') {
      if (state.yearFrom < 1950) parts.push('1800〜1949年: Gapminder v7');
      parts.push('1950〜' + ds.lastHistoricalYear + '年: 国連 World Population Prospects 2024');
      if (state.yearTo > ds.lastHistoricalYear && state.showFuture) {
        parts.push((ds.lastHistoricalYear + 1) + '年以降: 同 中位推計');
      }
      var note = state.yearFrom < 1950 ? '。1949年以前は推計値。' : '。';
      return '出典: ' + parts.join('／') + '（Our World in Data 経由）' + note;
    }
    parts.push('1920〜2020年: 総務省統計局「国勢調査」');
    if (state.yearTo > 2020 && state.showFuture) {
      parts.push('2025〜2050年: 国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5年推計）」');
    }
    return '出典: ' + parts.join('／') + '。1945年は人口調査（沖縄県を除く）。';
  }

  function renderLabels() {
    var y = Math.round(state.currentYear);
    var suffix = ds.isFuture(y) ? '年（推計）' : '年';
    $$('.js-timelabel').forEach(function (el) { el.textContent = y + suffix; });
    $('#rankYear').textContent = y + suffix + 'の順位';
    $('#mapTitle').textContent = state.mapMode === 'ratio'
      ? '世界地図で見る人口の増減' : '世界地図で見る人口';
    $('#chartTitle').textContent = (state.mode === 'world' ? '世界' : '日本') + 'の人口の推移';
    $('#dataStamp').textContent = 'データ更新: ' + ds.meta.builtAt + '　実績 ' + ds.startYear + '〜' + ds.lastHistoricalYear + '年／推計 〜' + ds.endYear + '年';
  }

  function renderRanking() {
    var year = Math.round(state.currentYear);
    var rows = ds.rankingAt(year, state.rankN);
    var max = rows.length ? rows[0].value : 1;
    var list = $('#ranking');
    var rowH = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--rank-row'), 10) || 28;
    var colorOf = {};
    series.forEach(function (se) { colorOf[se.id] = se.color; });

    var seen = {};
    rows.forEach(function (r, i) {
      seen[r.id] = true;
      var li = rankNodes[r.id];
      if (!li) {
        li = document.createElement('li');
        li.innerHTML = '<span class="ranking__no"></span>' +
                       '<span class="ranking__name"></span>' +
                       '<span class="ranking__bar"></span>' +
                       '<span class="ranking__val"></span>';
        rankNodes[r.id] = li;
        list.appendChild(li);
      }
      li.style.transform = 'translateY(' + (i * rowH) + 'px)';
      li.style.display = '';
      li.classList.toggle('is-future', ds.isFuture(year));
      li.querySelector('.ranking__no').textContent = i + 1;
      li.querySelector('.ranking__name').textContent = r.name;
      var bar = li.querySelector('.ranking__bar');
      bar.style.width = Math.max(2, r.value / max * 100) + '%';
      bar.style.backgroundColor = colorOf[r.id] || PopData.NEUTRAL;
      li.querySelector('.ranking__val').textContent = PopData.formatValue(r.value, state.mode, 'abs');
    });

    Object.keys(rankNodes).forEach(function (id) {
      if (!seen[id]) rankNodes[id].style.display = 'none';
    });
    list.style.height = (rows.length * rowH) + 'px';
  }

  function renderSources() {
    var ul = $('#sourceList');
    ul.innerHTML = '';
    ds.meta.sources.forEach(function (s) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="sources__period">' + s.period + '</span>' +
                     '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a>';
      ul.appendChild(li);
    });
    if (ds.meta.notes) {
      ds.meta.notes.forEach(function (n) {
        var li = document.createElement('li');
        li.textContent = '※ ' + n;
        ul.appendChild(li);
      });
    }
  }

  /* ================= コントロール ================= */

  function yearOptions() {
    if (state.mode === 'japan') return ds.years.slice();
    var out = [];
    for (var y = ds.startYear; y <= ds.endYear; y += 5) out.push(y);
    if (out[out.length - 1] !== ds.endYear) out.push(ds.endYear);
    if (out.indexOf(ds.lastHistoricalYear) < 0) {
      out.push(ds.lastHistoricalYear);
      out.sort(function (a, b) { return a - b; });
    }
    return out;
  }

  function fillSelect(sel, values, current) {
    sel.innerHTML = '';
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v + '年';
      if (v === current) o.selected = true;
      sel.appendChild(o);
    });
  }

  function buildYearSelects() {
    var years = yearOptions();
    fillSelect($('#yearFrom'), years, state.yearFrom);
    fillSelect($('#yearTo'), years, state.yearTo);
    fillSelect($('#rankAtYear'), years, state.rankAtYear);
  }

  function buildPresets() {
    var box = $('#periodPresets');
    box.innerHTML = '';
    PRESETS[state.mode].forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.textContent = p.label;
      b.addEventListener('click', function () {
        state.yearFrom = p.from; state.yearTo = p.to;
        state.currentYear = p.to;
        $('#yearFrom').value = p.from; $('#yearTo').value = p.to;
        syncTimeline();
        recompute();
      });
      box.appendChild(b);
    });
  }

  function buildPicker() {
    var box = $('#entityPicker');
    box.innerHTML = '';
    ds.regionGroups().forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'picker__group';
      h.textContent = g.name;
      box.appendChild(h);
      g.items.forEach(function (e) {
        var label = document.createElement('label');
        label.className = 'picker__item';
        label.dataset.id = e.id;
        label.dataset.name = e.name + ' ' + (e.en || '');
        label.innerHTML = '<input type="checkbox" value="' + e.id + '"><span>' + e.name + '</span>';
        box.appendChild(label);
      });
    });
    box.addEventListener('change', onPickChange);
    updatePickerState();
  }

  function onPickChange(ev) {
    var cb = ev.target;
    if (cb.type !== 'checkbox') return;
    var id = cb.value;
    var idx = state.manualIds.indexOf(id);
    if (cb.checked && idx < 0) {
      if (state.manualIds.length >= PopData.MAX_SERIES) { cb.checked = false; toast('グラフに出せるのは8つまでです'); return; }
      state.manualIds.push(id);
    } else if (!cb.checked && idx >= 0) {
      state.manualIds.splice(idx, 1);
    }
    updatePickerState();
    recompute();
  }

  function updatePickerState() {
    var full = state.manualIds.length >= PopData.MAX_SERIES;
    $$('#entityPicker .picker__item').forEach(function (el) {
      var cb = el.querySelector('input');
      cb.checked = state.manualIds.indexOf(cb.value) >= 0;
      el.classList.toggle('is-disabled', full && !cb.checked);
    });
    $('#pickCount').textContent = state.manualIds.length + ' / ' + PopData.MAX_SERIES;
  }

  function syncControls() {
    $$('[data-control]').forEach(function (grp) {
      var key = grp.dataset.control;
      Array.prototype.forEach.call(grp.children, function (b) {
        b.classList.toggle('is-active', b.dataset.value === state[key]);
      });
    });
    $('#topN').value = state.topN;
    $('#rankN').value = state.rankN;
    $('#showFuture').checked = state.showFuture;
    $('#showCallout').checked = state.showCallout;
    $('#modeNote').textContent = state.mode === 'world'
      ? '1800年〜2100年。国・大陸・世界全体を比べられます。'
      : '1920年（第1回国勢調査）〜2050年。5年ごとの数値です。';
    $('#metricNote').textContent = state.metric === 'index'
      ? '起点の年を100として、そこから何倍に増えた（減った）かを比べます。規模の違う国どうしの比較に向きます。'
      : state.metric === 'share'
        ? (state.mode === 'world' ? '世界全体を100%としたときの割合です。' : '全国を100%としたときの割合です。')
        : '人口の実数をそのまま表示します。';
    $('#mapModeNote').textContent = state.mapMode === 'ratio'
      ? '期間の開始年（' + state.yearFrom + '年）を1倍として、そこから何倍になったかを塗り分けます。青が増加、赤が減少です。'
      : 'その年の人口が多い国ほど濃い青で塗ります。';
    $('#pptxNote').textContent = state.mode === 'world'
      ? 'PowerPoint は「表紙・グラフ・世界地図・ランキング・出典」の5枚で出力されます。'
      : 'PowerPoint は「表紙・グラフ・ランキング・出典」の4枚で出力されます。';
    syncVisibility();
    syncTimeline();
  }

  function syncVisibility() {
    $$('.field[data-when]').forEach(function (el) {
      var cond = el.dataset.when.split('=');
      el.hidden = state[cond[0]] !== cond[1];
    });
    $$('.field[data-view]').forEach(function (el) {
      el.hidden = el.dataset.view !== state.view;
    });
  }

  function syncTimeline() {
    $$('.js-timeline').forEach(function (r) {
      r.min = state.yearFrom;
      r.max = state.yearTo;
      r.value = Math.round(state.currentYear);
    });
  }

  /* ================= 再生 ================= */

  function togglePlay() {
    state.playing ? stop() : play();
  }

  function play() {
    if (state.currentYear >= state.yearTo) state.currentYear = state.yearFrom;
    state.playing = true;
    $$('.js-play').forEach(function (b) { b.textContent = '❚❚ 停止'; });
    var span = state.yearTo - state.yearFrom;
    var perMs = span / 14000;      // 全期間を約14秒で流す
    var last = performance.now();
    (function step(now) {
      if (!state.playing) return;
      state.currentYear = Math.min(state.yearTo, state.currentYear + (now - last) * perMs);
      last = now;
      syncTimeline();
      checkEvent();
      render();
      if (state.currentYear >= state.yearTo) { stop(); return; }
      rafId = requestAnimationFrame(step);
    })(last);
  }

  function stop() {
    state.playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    $$('.js-play').forEach(function (b) { b.textContent = '▶ 再生'; });
  }

  function checkEvent() {
    var y = Math.round(state.currentYear);
    var hit = leaderEvents.find(function (e) { return e.year === y; });
    if (!hit) return;
    var b = $('#eventBanner');
    if (b.dataset.year === String(y)) return;
    b.dataset.year = String(y);
    b.textContent = y + '年　' + hit.name + 'が1位に';
    b.hidden = false;
    clearTimeout(eventTimer);
    eventTimer = setTimeout(function () { b.hidden = true; }, 2200);
  }

  /* ================= ツールチップ ================= */

  function onChartMove(ev) {
    if (!chartGeom || !series.length) return;
    var rect = $('#chart').getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var g = chartGeom;
    if (x < g.px || x > g.px + g.pw || y < g.py || y > g.py + g.ph) { $('#tooltip').hidden = true; return; }

    var year = Math.round(g.from + (x - g.px) / g.pw * (g.to - g.from));
    var rows = series.map(function (se) {
      var p = se.points[year - state.yearFrom];
      return { name: se.name, color: se.color, value: p ? p.value : null };
    }).filter(function (r) { return r.value !== null; })
      .sort(function (a, b) { return b.value - a.value; });

    var tip = $('#tooltip');
    tip.innerHTML = '<div class="tooltip__year">' + year + '年' +
      (ds.isFuture(year) ? '（推計）' : '') + '</div>' +
      rows.map(function (r) {
        return '<div class="tooltip__row"><span class="tooltip__dot" style="background:' + r.color + '"></span>' +
          r.name + '<span class="tooltip__val">' + PopData.formatValue(r.value, state.mode, state.metric) + '</span></div>';
      }).join('');
    tip.hidden = false;
    var tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(g.xAt(year), tw / 2 + 4), rect.width - tw / 2 - 4) + 'px';
    tip.style.top = Math.max(y - 14, tip.offsetHeight + 6) + 'px';
  }

  /* ================= その他 ================= */

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  window.popToast = toast;

  function setView(view) {
    state.view = view;
    $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.view === view); });
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === view); });
    syncVisibility();
    if (view === 'map') ensureGeo();
    requestAnimationFrame(render);
  }

  /* ================= 初期化 ================= */

  function bind() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });

    $$('[data-control]').forEach(function (grp) {
      grp.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b || !b.dataset.value) return;
        var key = grp.dataset.control;
        if (key === 'mode') {
          if (state.mode === b.dataset.value) return;
          stop();
          rankNodes = {}; $('#ranking').innerHTML = '';
          switchMode(b.dataset.value);
          return;
        }
        state[key] = b.dataset.value;
        syncControls();
        recompute();
      });
    });

    $('#topN').addEventListener('change', function () {
      state.topN = parseInt(this.value, 10); recompute();
    });
    $('#rankAtYear').addEventListener('change', function () {
      state.rankAtYear = parseInt(this.value, 10); recompute();
    });
    $('#rankN').addEventListener('change', function () {
      state.rankN = parseInt(this.value, 10); renderRanking();
    });
    $('#yearFrom').addEventListener('change', function () {
      state.yearFrom = parseInt(this.value, 10);
      if (state.yearFrom >= state.yearTo) {
        state.yearTo = yearOptions().filter(function (y) { return y > state.yearFrom; })[0] || ds.endYear;
        $('#yearTo').value = state.yearTo;
      }
      state.currentYear = state.yearTo;
      syncTimeline(); recompute();
    });
    $('#yearTo').addEventListener('change', function () {
      state.yearTo = parseInt(this.value, 10);
      if (state.yearTo <= state.yearFrom) {
        var before = yearOptions().filter(function (y) { return y < state.yearTo; });
        state.yearFrom = before[before.length - 1] || ds.startYear;
        $('#yearFrom').value = state.yearFrom;
      }
      state.currentYear = state.yearTo;
      syncTimeline(); recompute();
    });

    $('#showFuture').addEventListener('change', function () { state.showFuture = this.checked; render(); });
    $('#showCallout').addEventListener('change', function () { state.showCallout = this.checked; render(); });
    $('#calloutText').addEventListener('input', function () { state.calloutText = this.value; render(); });
    $('#slideTitle').addEventListener('input', function () { state.slideTitle = this.value; renderSlide(); });
    $('#slideSubtitle').addEventListener('input', function () { state.slideSubtitle = this.value; renderSlide(); });

    $$('.js-timeline').forEach(function (r) {
      r.addEventListener('input', function () {
        stop();
        state.currentYear = parseInt(this.value, 10);
        syncTimeline(); render();
      });
    });
    $$('.js-play').forEach(function (b) { b.addEventListener('click', togglePlay); });

    $('#entitySearch').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      $$('#entityPicker .picker__item').forEach(function (el) {
        el.style.display = !q || el.dataset.name.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
      });
    });
    $('#clearPick').addEventListener('click', function () {
      state.manualIds = []; updatePickerState(); recompute();
    });

    var chart = $('#chart');
    chart.addEventListener('mousemove', onChartMove);
    chart.addEventListener('mouseleave', function () { $('#tooltip').hidden = true; });

    var map = $('#map');
    map.addEventListener('mousemove', onMapMove);
    map.addEventListener('mouseleave', function () {
      $('#mapTooltip').hidden = true;
      if (state.hoverId) { state.hoverId = null; renderMap(); }
    });
    $('#dlMapPng').addEventListener('click', function () {
      if (!geo || state.mode !== 'world') { toast('世界地図は「世界（国・地域）」のときに使えます'); return; }
      PopExport.mapPng(mapSlideSpec(), fileBase() + '-map');
    });

    $('#dlPng').addEventListener('click', function () { PopExport.png(slideSpec(), fileBase()); });
    $('#dlPptx').addEventListener('click', function () {
      // 世界モードでは地図のスライドも入れるので、地図データを先に用意する
      var ready = state.mode === 'world' && !geo
        ? PopData.loadGeo().then(function (g) { geo = g; }).catch(function () { geo = null; })
        : Promise.resolve();

      ready.then(function () {
        PopExport.pptx(slideSpec(), rankingRows(), fileBase(), {
          mode: state.mode, metric: state.metric,
          year: Math.round(state.currentYear), isFuture: ds.isFuture(Math.round(state.currentYear)),
          sources: ds.meta.sources,
          mapSpec: state.mode === 'world' && geo ? mapSlideSpec() : null
        });
      });
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 120);
    });
  }

  function rankingRows() {
    return ds.rankingAt(Math.round(state.currentYear), state.rankN);
  }

  function fileBase() {
    return (state.mode === 'world' ? 'world' : 'japan') + '-population-' +
      state.yearFrom + '-' + state.yearTo;
  }

  bind();
  switchMode('world').then(function () { setView('explore'); }).catch(function (err) {
    $('#dataStamp').textContent = 'データの読み込みに失敗しました';
    toast(err.message);
    console.error(err);
  });
})();
