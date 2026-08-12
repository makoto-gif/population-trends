/* Canvas による折れ線グラフとスライドの描画。
   画面表示と PNG/PowerPoint 書き出しで同じ関数を使うため、
   すべての寸法を「幅1000pxを基準にした比率」で持つ。 */
(function (global) {
  'use strict';

  var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP",sans-serif';
  var INK = '#221714';
  var INK2 = '#6B6462';
  var GRID = '#EDEAE9';
  var FUTURE_BG = '#F2F0EF';
  var GG_RED = '#CA1139';

  function font(size, weight) { return (weight || 400) + ' ' + size + 'px ' + FONT; }

  function niceStep(range, target) {
    var raw = range / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function yTicks(min, max, target) {
    var step = niceStep(max - min, target);
    var start = Math.floor(min / step) * step;
    var ticks = [];
    for (var v = start; v <= max + step * 0.001; v += step) {
      if (v >= min - step * 0.001) ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return ticks;
  }

  function xTicks(from, to, target) {
    var span = to - from;
    var candidates = [1, 2, 5, 10, 20, 25, 50, 100];
    var step = candidates[candidates.length - 1];
    for (var i = 0; i < candidates.length; i++) {
      if (span / candidates[i] <= target) { step = candidates[i]; break; }
    }
    var start = Math.ceil(from / step) * step;
    var ticks = [];
    for (var y = start; y <= to; y += step) ticks.push(y);
    if (ticks[0] !== from) ticks.unshift(from);
    if (ticks[ticks.length - 1] !== to) ticks.push(to);
    return ticks;
  }

  /** 指定幅に収まるまで文字を縮め、それでも入らなければ2行に折り返す。 */
  function fitText(ctx, text, maxW, baseSize, minSize) {
    ctx.save();
    ctx.font = font(baseSize, 700);
    var w = ctx.measureText(text).width;
    if (w <= maxW) { ctx.restore(); return { lines: [text], size: baseSize }; }

    var scaled = Math.max(minSize, baseSize * maxW / w);
    ctx.font = font(scaled, 700);
    if (ctx.measureText(text).width <= maxW) { ctx.restore(); return { lines: [text], size: scaled }; }

    // 読点か中央で2行に割る
    var cut = text.indexOf('、');
    if (cut < 0 || cut > text.length - 2) cut = Math.ceil(text.length / 2) - 1;
    var lines = [text.slice(0, cut + 1), text.slice(cut + 1)];
    var widest = Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width);
    var size = widest > maxW ? Math.max(minSize, scaled * maxW / widest) : scaled;
    ctx.restore();
    return { lines: lines, size: size };
  }

  /**
   * 折れ線グラフを描く。
   * @returns {object} 当たり判定に使うジオメトリ
   */
  function drawChart(ctx, box, spec) {
    var s = box.w / 1000;                       // 基準幅に対する縮尺
    var series = spec.series;
    var from = spec.yearFrom, to = spec.yearTo;
    var reveal = Math.min(spec.currentYear, to);

    /* --- 目盛りの範囲 --- */
    var maxV = 0, minV = Infinity;
    series.forEach(function (se) {
      se.points.forEach(function (p) {
        if (p.value === null) return;
        if (p.value > maxV) maxV = p.value;
        if (p.value < minV) minV = p.value;
      });
    });
    if (!isFinite(minV)) { minV = 0; maxV = 1; }
    var yMin = spec.metric === 'index' ? Math.min(0, Math.floor(minV / 20) * 20) : 0;
    var yMax = maxV * 1.08 || 1;
    var ticks = yTicks(yMin, yMax, 5);
    yMax = Math.max(yMax, ticks[ticks.length - 1]);

    /* --- 描画領域 --- */
    var labelW = 0;
    ctx.font = font(15 * s, 700);
    series.forEach(function (se) {
      var w = ctx.measureText(se.endLabel || '').width;
      if (w > labelW) labelW = w;
    });
    var padL = 78 * s, padR = labelW + 26 * s, padT = 26 * s, padB = 46 * s;
    var px = box.x + padL, py = box.y + padT;
    var pw = box.w - padL - padR, ph = box.h - padT - padB;

    var xAt = function (year) { return px + (year - from) / Math.max(1, to - from) * pw; };
    var yAt = function (v) { return py + ph - (v - yMin) / (yMax - yMin) * ph; };

    /* --- 未来ゾーン: 線と重ならない空きスペースを見つけて背景と「?」を置く --- */
    var boundary = spec.boundaryYear;
    var hasZone = spec.showFuture && to > boundary && boundary >= from;
    var zone = null;
    if (hasZone) {
      var hiV = -Infinity, loV = Infinity;
      series.forEach(function (se) {
        se.points.forEach(function (p) {
          if (p.value === null || p.year < boundary || p.year > reveal) return;
          if (p.value > hiV) hiV = p.value;
          if (p.value < loV) loV = p.value;
        });
      });
      var zx0 = xAt(boundary), zw0 = px + pw - zx0;
      var above = isFinite(hiV) ? yAt(hiV) - py : ph;
      var below = isFinite(loV) ? (py + ph) - yAt(loV) : 0;
      zone = above >= below
        ? { x: zx0, w: zw0, top: py, bottom: py + Math.max(above, 0) }
        : { x: zx0, w: zw0, top: py + ph - Math.max(below, 0), bottom: py + ph };

      ctx.fillStyle = FUTURE_BG;
      ctx.fillRect(zx0, py, zw0, ph);

      var bandH = zone.bottom - zone.top;
      zone.roomy = bandH > 120 * s;
      if (spec.showCallout && zone.roomy) {
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#DFDBDA';
        ctx.font = font(Math.min(zw0 * 0.5, bandH * 0.62, 140 * s), 700);
        ctx.fillText('?', zx0 + zw0 / 2, zone.top + bandH * 0.42);
        ctx.restore();
      }
    }

    /* --- 目盛り線 --- */
    ctx.strokeStyle = GRID;
    ctx.lineWidth = Math.max(1, 1 * s);
    ctx.fillStyle = INK2;
    ctx.font = font(13 * s, 400);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : ticks[0];
    ticks.forEach(function (t) {
      var y = yAt(t);
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke();
      ctx.fillText(spec.formatAxis(t, tickStep), px - 10 * s, y);
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xTicks(from, to, 9).forEach(function (t) {
      ctx.fillText(String(t), xAt(t), py + ph + 12 * s);
    });

    /* --- 縦軸のタイトル --- */
    ctx.save();
    ctx.translate(box.x + 20 * s, py + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK2; ctx.font = font(13 * s, 600);
    ctx.fillText(spec.axisTitle, 0, 0);
    ctx.restore();

    /* --- 実績と推計の境目 --- */
    if (spec.showFuture && to > boundary && boundary >= from) {
      var bxx = xAt(boundary);
      ctx.save();
      ctx.setLineDash([6 * s, 5 * s]);
      ctx.strokeStyle = '#9C9391';
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath(); ctx.moveTo(bxx, py - 6 * s); ctx.lineTo(bxx, py + ph); ctx.stroke();
      ctx.restore();

      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = INK; ctx.font = font(13 * s, 700);
      ctx.fillText('実績 ' + boundary + '年 ｜ この先は推計', bxx - 8 * s, py - 4 * s);
    }

    /* --- 折れ線 --- */
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    series.forEach(function (se) {
      var pts = se.points.filter(function (p) { return p.value !== null && p.year <= reveal; });
      if (!pts.length) return;

      // 実績と推計で線種を変える
      [['solid', function (p) { return p.year <= boundary; }],
       ['dash', function (p) { return p.year >= boundary; }]].forEach(function (part) {
        var sub = pts.filter(part[1]);
        if (sub.length < 2) return;
        ctx.save();
        ctx.strokeStyle = se.color;
        ctx.lineWidth = 2.2 * s;
        if (part[0] === 'dash') { ctx.setLineDash([7 * s, 5 * s]); ctx.globalAlpha = 0.92; }
        ctx.beginPath();
        sub.forEach(function (p, i) {
          var x = xAt(p.year), y = yAt(p.value);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      });

      // 実データのある年に丸印（5年刻みの日本モードで効く）
      if (spec.markerYears && spec.markerYears.length && spec.markerYears.length <= 40) {
        ctx.fillStyle = se.color;
        spec.markerYears.forEach(function (y0) {
          if (y0 > reveal) return;
          var p = pts.find(function (q) { return q.year === y0; });
          if (!p) return;
          ctx.beginPath();
          ctx.arc(xAt(p.year), yAt(p.value), 3.2 * s, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    /* --- 右端の値ラベル（重ならないよう押し広げる） --- */
    var labels = series.map(function (se) {
      var p = null;
      for (var i = se.points.length - 1; i >= 0; i--) {
        if (se.points[i].year <= reveal && se.points[i].value !== null) { p = se.points[i]; break; }
      }
      return p ? { color: se.color, text: se.endLabel, y: yAt(p.value), x: xAt(p.year) } : null;
    }).filter(Boolean);

    labels.sort(function (a, b) { return a.y - b.y; });
    var gap = 21 * s;
    for (var i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < gap) labels[i].y = labels[i - 1].y + gap;
    }
    var overflow = labels.length ? labels[labels.length - 1].y - (py + ph) : 0;
    if (overflow > 0) labels.forEach(function (l) { l.y -= overflow; });

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = font(15 * s, 700);
    labels.forEach(function (l) {
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, px + pw + 12 * s, l.y);
    });

    /* --- キャッチ文言（未来ゾーンの幅に収まるまで縮める／折り返す） --- */
    if (hasZone && spec.showCallout && spec.calloutText && zone) {
      var fitted = fitText(ctx, spec.calloutText, zone.w - 20 * s, 24 * s, 13 * s);
      var lineH = fitted.size * 1.45;
      var block = (fitted.lines.length - 1) * lineH;
      // 空きスペースの下寄せ。狭いときは中央に置く。
      var bh = zone.bottom - zone.top;
      var cy = zone.roomy
        ? zone.bottom - 16 * s - block - fitted.size * 0.3
        : zone.top + bh / 2 - block / 2;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font(fitted.size, 700);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.92)';   // 線と重なっても読めるように白フチ
      ctx.lineWidth = fitted.size * 0.3;
      fitted.lines.forEach(function (line, i) {
        ctx.strokeText(line, zone.x + zone.w / 2, cy + i * lineH);
      });
      ctx.fillStyle = GG_RED;
      fitted.lines.forEach(function (line, i) {
        ctx.fillText(line, zone.x + zone.w / 2, cy + i * lineH);
      });
      ctx.restore();
    }

    /* --- 凡例（左上） --- */
    if (series.length > 1) {
      var lx = px + 16 * s, ly = py + 16 * s, lh = 22 * s;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = font(14 * s, 600);
      series.forEach(function (se, i) {
        var y = ly + i * lh;
        ctx.strokeStyle = se.color;
        ctx.lineWidth = 2.4 * s;
        ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + 22 * s, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(lx + 11 * s, y, 3.6 * s, 0, Math.PI * 2);
        ctx.fillStyle = se.color; ctx.fill();
        ctx.fillStyle = INK;
        ctx.fillText(se.name, lx + 30 * s, y);
      });
    }

    /* --- 再生ヘッド --- */
    if (reveal < to) {
      var rx = xAt(reveal);
      ctx.save();
      ctx.strokeStyle = 'rgba(34,23,20,.28)';
      ctx.lineWidth = Math.max(1, 1 * s);
      ctx.beginPath(); ctx.moveTo(rx, py); ctx.lineTo(rx, py + ph); ctx.stroke();
      ctx.restore();
    }

    return { px: px, py: py, pw: pw, ph: ph, s: s, xAt: xAt, yAt: yAt, from: from, to: to };
  }

  /** 16:9 のスライドを1枚描く。 */
  function drawSlide(ctx, w, h, spec) {
    var s = w / 1920;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // 見出し
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = INK;
    ctx.font = font(58 * s, 700);
    ctx.fillText(spec.title, w / 2, 52 * s);

    if (spec.subtitle) {
      ctx.fillStyle = INK2;
      ctx.font = font(26 * s, 500);
      ctx.textBaseline = 'middle';
      var ty = 148 * s;
      var tw = ctx.measureText(spec.subtitle).width;
      ctx.fillText(spec.subtitle, w / 2, ty);
      ctx.strokeStyle = GG_RED;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(w / 2 - tw / 2 - 56 * s, ty); ctx.lineTo(w / 2 - tw / 2 - 18 * s, ty);
      ctx.moveTo(w / 2 + tw / 2 + 18 * s, ty); ctx.lineTo(w / 2 + tw / 2 + 56 * s, ty);
      ctx.stroke();
    }

    drawChart(ctx, { x: 40 * s, y: 190 * s, w: w - 80 * s, h: h - 190 * s - 76 * s }, spec);

    // 出典
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = INK2;
    ctx.font = font(19 * s, 400);
    ctx.fillText(spec.footnote, w / 2, h - 26 * s);
  }

  global.PopChart = { drawChart: drawChart, drawSlide: drawSlide, FONT: FONT, INK: INK, INK2: INK2, GG_RED: GG_RED };
})(window);
