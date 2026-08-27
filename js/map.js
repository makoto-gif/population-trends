/* 世界地図（コロプレス図）の描画。
   chart.js と同じく「幅1000pxを基準にした比率」で描くので、
   画面表示と1920×1080の書き出しで同じコードが使える。 */
(function (global) {
  'use strict';

  var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP",sans-serif';
  var INK = '#221714';
  var INK2 = '#6B6462';
  var OCEAN = '#EDEAE8';
  var NODATA = '#CFCAC7';
  var BORDER = '#FFFFFF';

  // 南極を除いた範囲で切る。正距円筒図法。
  var LAT_MAX = 84, LAT_MIN = -58;
  var MAP_RATIO = 360 / (LAT_MAX - LAT_MIN);

  /** 人口の絶対値: 単一色相の明→暗（sequential） */
  var SEQ = {
    colors: ['#EFF5FC', '#D3E3F7', '#A9C8EE', '#7AA9E2', '#4A88D4', '#2A6BB8', '#173F73'],
    bins: [1e6, 1e7, 3e7, 1e8, 3e8, 1e9],
    ticks: ['100万', '1000万', '3000万', '1億', '3億', '10億'],
    title: 'その年の人口'
  };

  /** 起点の年からの倍率: 減少=赤 / ほぼ横ばい=グレー / 増加=青（diverging）。
      真ん中（4番目）が必ず「横ばい」の帯になるように刻みを組む。 */
  var DIV_COLORS = ['#B2182B', '#D9704F', '#F0B49A', '#E4E0DD', '#9CC7E0', '#4A90C4', '#1C5E93'];

  // 期間が長いほど倍率は大きくなるので、実際の広がりに合わせて刻みを選ぶ
  var DIV_LADDERS = [
    { max: 1.6, bins: [0.80, 0.93, 0.98, 1.02, 1.10, 1.30] },
    { max: 6,   bins: [0.50, 0.85, 0.97, 1.03, 2, 4] },
    { max: Infinity, bins: [0.50, 0.90, 0.98, 1.02, 3, 10] }
  ];

  function ratioTick(v) {
    return (v >= 10 ? String(Math.round(v)) : String(v)) + '倍';
  }

  function divScale(values) {
    var maxV = 0;
    for (var k in values) {
      var v = values[k];
      if (v !== null && v !== undefined && !isNaN(v) && v > maxV) maxV = v;
    }
    var ladder = DIV_LADDERS.find(function (l) { return maxV < l.max; }) || DIV_LADDERS[2];
    return {
      colors: DIV_COLORS,
      bins: ladder.bins,
      ticks: ladder.bins.map(ratioTick),
      title: '起点の年からの倍率（1倍＝横ばい／赤は減少）'
    };
  }

  function scaleFor(mapMode, values) {
    return mapMode === 'ratio' ? divScale(values || {}) : SEQ;
  }

  function binIndex(v, bins) {
    for (var i = 0; i < bins.length; i++) if (v < bins[i]) return i;
    return bins.length;
  }

  function font(size, weight) { return (weight || 400) + ' ' + size + 'px ' + FONT; }

  /** 与えられた枠の中に、縦横比を保った地図の矩形を収める。 */
  function fitMap(box, legendH) {
    var availW = box.w, availH = box.h - legendH;
    var w = availW, h = w / MAP_RATIO;
    if (h > availH) { h = availH; w = h * MAP_RATIO; }
    return { x: box.x + (availW - w) / 2, y: box.y + (availH - h) / 2, w: w, h: h };
  }

  /**
   * 地図を描く。
   * @returns {object} 当たり判定用のジオメトリ（投影済み座標つき）
   */
  function drawMap(ctx, box, spec) {
    var s = box.w / 1000;
    var scale = scaleFor(spec.mapMode, spec.values);
    var legendH = 62 * s;
    var rect = fitMap(box, legendH);

    var projX = function (lon) { return rect.x + (lon + 180) / 360 * rect.w; };
    var projY = function (lat) { return rect.y + (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * rect.h; };

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    ctx.fillStyle = OCEAN;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    var hit = [];
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.5, 0.7 * s);
    ctx.strokeStyle = BORDER;

    spec.geo.countries.forEach(function (c) {
      var v = spec.valueOf(c.id);
      ctx.fillStyle = v === null || v === undefined || isNaN(v)
        ? NODATA
        : scale.colors[binIndex(v, scale.bins)];

      var shapes = [];
      c.polys.forEach(function (flat) {
        var pts = new Array(flat.length);
        ctx.beginPath();
        for (var i = 0; i < flat.length; i += 2) {
          var x = projX(flat[i]), y = projY(flat[i + 1]);
          pts[i] = x; pts[i + 1] = y;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        shapes.push(pts);
      });
      hit.push({ id: c.id, shapes: shapes, value: v });
    });

    // ホバー中の国を強調
    if (spec.highlightId) {
      var target = hit.find(function (h) { return h.id === spec.highlightId; });
      if (target) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1.2, 1.8 * s);
        target.shapes.forEach(function (pts) {
          ctx.beginPath();
          for (var i = 0; i < pts.length; i += 2) {
            if (i === 0) ctx.moveTo(pts[i], pts[i + 1]); else ctx.lineTo(pts[i], pts[i + 1]);
          }
          ctx.closePath();
          ctx.stroke();
        });
      }
    }

    // 年は右下（南太平洋）の空きスペースに置く。陸地と重ならない場所。
    if (spec.yearLabel) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(34,23,20,.38)';
      ctx.font = font(34 * s, 700);
      ctx.fillText(spec.yearLabel, rect.x + rect.w - 16 * s, rect.y + rect.h - 10 * s);
    }

    ctx.restore();

    drawLegend(ctx, {
      x: rect.x, y: rect.y + rect.h + 16 * s, w: rect.w, s: s
    }, scale, spec.hasNoData);

    return {
      rect: rect, s: s, hit: hit,
      lonAt: function (x) { return (x - rect.x) / rect.w * 360 - 180; },
      latAt: function (y) { return LAT_MAX - (y - rect.y) / rect.h * (LAT_MAX - LAT_MIN); }
    };
  }

  function drawLegend(ctx, box, scale, hasNoData) {
    var s = box.s;
    var n = scale.colors.length;
    var boxW = Math.min(56 * s, box.w / (n + 3));
    var boxH = 13 * s;
    var totalW = boxW * n + (hasNoData ? boxW + 22 * s : 0);
    var x0 = box.x + (box.w - totalW) / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = INK2;
    ctx.font = font(12.5 * s, 600);
    ctx.fillText(scale.title, box.x + box.w / 2, box.y - 2 * s);

    scale.colors.forEach(function (col, i) {
      ctx.fillStyle = col;
      ctx.fillRect(x0 + i * boxW, box.y + 6 * s, boxW, boxH);
    });
    ctx.strokeStyle = '#D8D3D1';
    ctx.lineWidth = Math.max(0.5, 0.6 * s);
    ctx.strokeRect(x0, box.y + 6 * s, boxW * n, boxH);

    // しきい値は箱の境目の下に置く
    ctx.textBaseline = 'top';
    ctx.fillStyle = INK2;
    ctx.font = font(11 * s, 400);
    scale.ticks.forEach(function (t, i) {
      ctx.fillText(t, x0 + (i + 1) * boxW, box.y + 6 * s + boxH + 4 * s);
    });

    if (hasNoData) {
      var nx = x0 + boxW * n + 22 * s;
      ctx.fillStyle = NODATA;
      ctx.fillRect(nx, box.y + 6 * s, boxW * 0.5, boxH);
      ctx.fillStyle = INK2;
      ctx.textAlign = 'left';
      ctx.fillText('データなし', nx + boxW * 0.5 + 6 * s, box.y + 6 * s + 1 * s);
    }
  }

  /** 投影済み座標で点が国の中に入っているか（レイキャスティング）。 */
  function countryAt(geom, x, y) {
    if (!geom) return null;
    for (var i = 0; i < geom.hit.length; i++) {
      var c = geom.hit[i];
      for (var j = 0; j < c.shapes.length; j++) {
        if (pointInFlatPolygon(c.shapes[j], x, y)) return c;
      }
    }
    return null;
  }

  function pointInFlatPolygon(pts, x, y) {
    var inside = false;
    for (var i = 0, k = pts.length - 2; i < pts.length; k = i, i += 2) {
      var xi = pts[i], yi = pts[i + 1], xj = pts[k], yj = pts[k + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 16:9 のスライドを1枚描く（地図版）。 */
  function drawMapSlide(ctx, w, h, spec) {
    var s = w / 1920;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = INK;
    ctx.font = font(56 * s, 700);
    ctx.fillText(spec.title, w / 2, 44 * s);

    if (spec.subtitle) {
      ctx.fillStyle = INK2;
      ctx.font = font(25 * s, 500);
      ctx.fillText(spec.subtitle, w / 2, 122 * s);
    }

    drawMap(ctx, { x: 50 * s, y: 178 * s, w: w - 100 * s, h: h - 178 * s - 74 * s }, spec);

    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = INK2;
    ctx.font = font(18 * s, 400);
    ctx.fillText(spec.footnote, w / 2, h - 24 * s);
  }

  global.PopMap = {
    drawMap: drawMap,
    drawMapSlide: drawMapSlide,
    countryAt: countryAt,
    scaleFor: scaleFor,
    binIndex: binIndex
  };
})(window);
