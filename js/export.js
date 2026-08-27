/* PNG と PowerPoint の書き出し。
   スライドの見た目は画面プレビューと同じ描画関数を使うので、必ず一致する。 */
(function (global) {
  'use strict';

  var W = 1920, H = 1080;

  function renderSlideCanvas(spec) {
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    PopChart.drawSlide(ctx, W, H, spec);
    return canvas;
  }

  function renderMapCanvas(spec) {
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    // ホバーの強調は書き出しには不要
    var clean = Object.assign({}, spec, { highlightId: null });
    PopMap.drawMapSlide(ctx, W, H, clean);
    return canvas;
  }

  function download(blobOrUrl, filename) {
    var url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    if (typeof blobOrUrl !== 'string') setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function png(spec, base) {
    var canvas = renderSlideCanvas(spec);
    canvas.toBlob(function (blob) {
      download(blob, base + '.png');
      if (global.popToast) global.popToast('PNG を保存しました');
    }, 'image/png');
  }

  function mapPng(spec, base) {
    renderMapCanvas(spec).toBlob(function (blob) {
      download(blob, base + '.png');
      if (global.popToast) global.popToast('地図の PNG を保存しました');
    }, 'image/png');
  }

  function pptx(spec, rows, base, info) {
    if (typeof PptxGenJS === 'undefined') {
      if (global.popToast) global.popToast('PowerPoint の生成ライブラリを読み込めませんでした');
      return;
    }
    var btn = document.getElementById('dlPptx');
    btn.disabled = true;
    btn.textContent = '作成中…';

    var RED = 'CA1139', BLACK = '221714', GRAY = '6B6462', BORDER = 'E5E1E0';
    var pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';           // 10 × 5.625 インチ
    pptx.author = 'Population Trends';
    pptx.title = spec.title;

    /* --- 1枚目: 表紙 --- */
    var s1 = pptx.addSlide();
    s1.background = { color: 'FFFFFF' };
    s1.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.7, w: 0.14, h: 1.5, fill: { color: RED } });
    s1.addText(spec.title, {
      x: 0.95, y: 1.7, w: 8.4, h: 1.0,
      fontSize: 34, bold: true, color: BLACK, valign: 'middle'
    });
    s1.addText(spec.subtitle, {
      x: 0.95, y: 2.75, w: 8.4, h: 0.5,
      fontSize: 18, color: GRAY, valign: 'middle'
    });
    s1.addText(spec.footnote, {
      x: 0.6, y: 4.75, w: 8.8, h: 0.6,
      fontSize: 10, color: GRAY, valign: 'top'
    });

    /* --- 2枚目: グラフ（プレビューと同じ画像） --- */
    var s2 = pptx.addSlide();
    s2.background = { color: 'FFFFFF' };
    s2.addImage({ data: renderSlideCanvas(spec).toDataURL('image/png'), x: 0, y: 0, w: 10, h: 5.625 });

    /* --- 世界モードのみ: 地図のスライド --- */
    if (info.mapSpec) {
      var sMap = pptx.addSlide();
      sMap.background = { color: 'FFFFFF' };
      sMap.addImage({ data: renderMapCanvas(info.mapSpec).toDataURL('image/png'), x: 0, y: 0, w: 10, h: 5.625 });
    }

    /* --- ランキング表 --- */
    var s3 = pptx.addSlide();
    s3.background = { color: 'FFFFFF' };
    s3.addText(info.year + '年' + (info.isFuture ? '（推計）' : '') + 'の人口ランキング', {
      x: 0.6, y: 0.35, w: 8.8, h: 0.5, fontSize: 24, bold: true, color: BLACK
    });

    var head = [
      { text: '順位', options: { bold: true, color: 'FFFFFF', fill: { color: BLACK }, align: 'center' } },
      { text: info.mode === 'world' ? '国・地域' : '都道府県', options: { bold: true, color: 'FFFFFF', fill: { color: BLACK } } },
      { text: '人口', options: { bold: true, color: 'FFFFFF', fill: { color: BLACK }, align: 'right' } }
    ];
    var body = rows.map(function (r, i) {
      return [
        { text: String(i + 1), options: { align: 'center', color: GRAY } },
        { text: r.name, options: { color: BLACK, bold: i < 3 } },
        { text: PopData.formatValue(r.value, info.mode, 'abs'), options: { align: 'right', color: BLACK } }
      ];
    });
    s3.addTable([head].concat(body), {
      x: 0.6, y: 0.95, w: 8.8,
      colW: [1.0, 5.3, 2.5],
      fontSize: rows.length > 12 ? 11 : 13,
      rowH: rows.length > 12 ? 0.26 : 0.32,
      border: { type: 'solid', pt: 0.5, color: BORDER },
      valign: 'middle'
    });

    /* --- 4枚目: 出典 --- */
    var s4 = pptx.addSlide();
    s4.background = { color: 'FFFFFF' };
    s4.addText('データの出典', { x: 0.6, y: 0.45, w: 8.8, h: 0.5, fontSize: 24, bold: true, color: BLACK });
    var lines = [];
    info.sources.forEach(function (src) {
      lines.push({ text: src.period, options: { fontSize: 13, bold: true, color: BLACK, breakLine: true, paraSpaceBefore: 8 } });
      lines.push({ text: src.name, options: { fontSize: 13, color: BLACK, breakLine: true } });
      lines.push({ text: src.url, options: { fontSize: 10, color: RED, breakLine: true, hyperlink: { url: src.url } } });
    });
    s4.addText(lines, { x: 0.6, y: 1.15, w: 8.8, h: 3.6, valign: 'top' });
    s4.addText('本資料のグラフは上記の公開データをもとに作成しています。', {
      x: 0.6, y: 4.85, w: 8.8, h: 0.4, fontSize: 10, color: GRAY
    });

    pptx.writeFile({ fileName: base + '.pptx' }).then(function () {
      btn.disabled = false;
      btn.textContent = 'PowerPoint（.pptx）';
      if (global.popToast) global.popToast('PowerPoint を保存しました（' + (info.mapSpec ? 5 : 4) + '枚）');
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'PowerPoint（.pptx）';
      console.error(err);
      if (global.popToast) global.popToast('PowerPoint の作成に失敗しました');
    });
  }

  global.PopExport = { png: png, mapPng: mapPng, pptx: pptx };
})(window);
