(function () {
  // 与 reader.css 中 .page 的内容区一致：700 - 左右padding(70*2)=560 宽；990 - 上下padding(64*2)=862 高
  const PAGE_W = 560;      // 版心内容区宽（700 - 左右 padding 70×2）
  const PAGE_H = 862;      // 版心内容区高（990 - 上下 padding 64×2）
  const PAGE_W_FULL = 700; // 书页整体宽（显示与缩放用）
  const PAGE_H_FULL = 990; // 书页整体高

  let pages = []; // pages[i] = { items:[DOM], volume, volumePage, globalPage }
  let current = 0;
  let numbering = 'global'; // 'global' 全站连续 | 'per-volume' 卷内
  const articleStart = {}; // title -> 起始页 index

  const params = new URLSearchParams(location.search);
  const FORCE_MEASURE = params.get('measure') === '1'; // 构建测量模式

  const pageEl = document.getElementById('page');
  const indicator = document.getElementById('page-indicator');
  const tocList = document.getElementById('toc-list');

  // 书页自适应视口：版心设计尺寸固定 700×990（分页基准不变），按可用空间整体缩放，
  // 避免窗口装不下时上下被裁切（缩放只影响显示，不影响分页结果）
  function fitPage() {
    const stage = document.getElementById('stage');
    if (!stage || !pageEl) return;
    const style = window.getComputedStyle(stage);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = stage.clientWidth - padX;
    const availH = stage.clientHeight - padY;
    if (availW <= 0 || availH <= 0) return;
    const s = Math.min(1, availW / PAGE_W_FULL, availH / PAGE_H_FULL);
    const scale = Math.max(0.45, s); // 太小就让它滚动，不再缩小

    // 优先用 zoom（会重排，居中自然）；不支持的浏览器退化为 transform + 负 margin 抵消占位
    pageEl.style.zoom = scale;
    const h = pageEl.getBoundingClientRect().height;
    if (Math.abs(h - PAGE_H_FULL * scale) > 4) {
      pageEl.style.zoom = '';
      pageEl.style.transformOrigin = 'center center';
      pageEl.style.transform = 'scale(' + scale + ')';
      pageEl.style.margin = (PAGE_H_FULL * (scale - 1) / 2) + 'px ' + (PAGE_W_FULL * (scale - 1) / 2) + 'px';
    }
  }

  // 给静态资源加版本戳，避免浏览器/CDN 缓存旧版（新增按钮、改样式后立刻生效）
  function v(url) {
    const ver = window.BOOK_VERSION;
    if (!ver) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(ver);
  }

  function htmlToNodes(html) {
    const t = document.createElement('div');
    t.innerHTML = html || '';
    return Array.prototype.slice.call(t.children);
  }

  async function load() {
    let manifest;
    try {
      manifest = await fetch(v('./manifest.json')).then(function (r) { return r.json(); });
    } catch (e) {
      pageEl.innerHTML = '<p style="color:#9c4a36">加载 manifest.json 失败，请先运行 node build.js 生成。</p>';
      return;
    }
    numbering = params.get('numbering') || manifest.numbering || 'global';

    let prebuilt = false;
    if (!FORCE_MEASURE) {
      try {
        const res = await fetch(v('./pages.json'));
        if (res.ok) {
          const data = await res.json();
          if (data && data.pages && data.pages.length) {
            pages = data.pages.map(function (p) {
              return {
                items: htmlToNodes(p.html),
                volume: p.volume || '',
                volumePage: p.volumePage || 0,
                globalPage: p.globalPage || 0
              };
            });
            // 从预构建页恢复篇章起始页
            pages.forEach(function (p, i) {
              const first = p.items[0];
              const t = first && first.getAttribute ? first.getAttribute('data-title') : '';
              if (t && articleStart[t] == null) articleStart[t] = i;
            });
            prebuilt = true;
          }
        }
      } catch (e) { /* 无 pages.json 则回退运行时测量 */ }
    }

    if (!prebuilt) {
      await buildFromMeasure(manifest);
    }

    buildToc(manifest);
    current = parseInt(localStorage.getItem('book-page') || '0', 10) || 0;
    showPage(current);
    bindEvents();

    // 就绪钩子（自动化 / 调试）
    window.__bookReady = true;
    window.__bookPages = pages.length;
    window.__bookStart = articleStart;
    window.__bookNumbering = numbering;
    window.__bookPrebuilt = prebuilt;

    // 构建测量模式下导出分页结果，供 build 写 pages.json
    if (FORCE_MEASURE) {
      window.__bookPagesHtml = pages.map(function (p) {
        const first = p.items[0];
        return {
          html: p.items.map(function (el) { return el.outerHTML; }).join(''),
          volume: p.volume || '',
          volumePage: p.volumePage || 0,
          globalPage: p.globalPage || 0,
          firstTitle: (first && first.getAttribute) ? (first.getAttribute('data-title') || '') : ''
        };
      });
    }
  }

  async function buildFromMeasure(manifest) {
    const measure = document.createElement('div');
    measure.id = 'measure';
    measure.style.cssText =
      'position:absolute;left:-99999px;top:0;width:' + PAGE_W + 'px;' +
      'padding:64px 70px;font-family:var(--serif);font-size:17px;line-height:2.0;' +
      'color:#2f3b34;background:#f3ecdb;box-sizing:border-box;';
    document.body.appendChild(measure);

    for (let i = 0; i < manifest.articles.length; i++) {
      const a = manifest.articles[i];
      const raw = await fetch(v(encodeURI('./content/' + a.file))).then(function (r) { return r.text(); });
      const html = (window.marked ? marked.parse(raw) : '<pre>' + raw + '</pre>');
      const section = document.createElement('section');
      section.setAttribute('data-title', a.title);
      section.setAttribute('data-volume', a.volume || '');
      section.innerHTML =
        '<div class="meta">' + (a.volume ? a.volume + ' · ' : '') + a.title + '</div>' + html;
      measure.appendChild(section);
    }

    await new Promise(function (r) { setTimeout(r, 400); }); // 等字体/图片布局稳定
    paginate(measure);
    document.body.removeChild(measure);
  }

  // 块级感知分页：以 section 为整体不截断；新卷强制另起一页（卷边界 = 稳定边界）
  function paginate(measure) {
    pages = [];
    let cur = null;
    let h = 0;
    const volCounter = {};
    const blocks = Array.prototype.slice.call(measure.children);

    function newPage() {
      cur = { items: [], volume: '', volumePage: 0, globalPage: pages.length + 1 };
      pages.push(cur);
      h = 0;
    }
    newPage();

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bh = b.offsetHeight;
      const vol = b.getAttribute('data-volume') || '';
      const title = b.getAttribute('data-title') || '';

      // 换页条件：超出版心，或遇到新卷（卷边界强制分页）
      const needNew = (h + bh > PAGE_H && h > 0) || (cur.items.length > 0 && cur.volume !== vol);
      if (needNew) newPage();

      if (!cur.volume) cur.volume = vol;
      if (title && articleStart[title] == null) articleStart[title] = pages.length - 1;
      cur.items.push(b.cloneNode(true));
      h += bh;
    }

    // 回填卷内页码
    pages.forEach(function (p) {
      if (!p.volume) return;
      volCounter[p.volume] = (volCounter[p.volume] || 0) + 1;
      p.volumePage = volCounter[p.volume];
    });
    if (pages.length === 0) newPage();
  }

  function pageLabel(p) {
    if (numbering === 'per-volume' && p.volume) return p.volume + ' · 第 ' + p.volumePage + ' 页';
    return '第 ' + p.globalPage + ' 页';
  }

  function indicatorText(i) {
    const p = pages[i];
    if (numbering === 'per-volume' && p.volume) {
      const total = pages.filter(function (x) { return x.volume === p.volume; }).length;
      return p.volume + ' · 第 ' + p.volumePage + ' / ' + total + ' 页';
    }
    return '第 ' + (i + 1) + ' / ' + pages.length + ' 页';
  }

  function showPage(i) {
    current = Math.max(0, Math.min(i, pages.length - 1));
    pageEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    // 用克隆渲染：源 items 保持干净，批注包裹不会污染原内容
    pages[current].items.forEach(function (el) { frag.appendChild(el.cloneNode(true)); });
    pageEl.appendChild(frag);
    const pgNum = document.createElement('div');
    pgNum.className = 'page-number';
    pgNum.textContent = pageLabel(pages[current]);
    pageEl.appendChild(pgNum);
    indicator.textContent = indicatorText(current);
    localStorage.setItem('book-page', String(current));

    // 通知批注层：当前页已渲染（批注据此重绘）
    try {
      var firstItem = pages[current].items[0];
      document.dispatchEvent(new CustomEvent('book:page', {
        detail: {
          index: current,
          globalPage: pages[current].globalPage,
          volume: pages[current].volume || '',
          articleTitle: (firstItem && firstItem.getAttribute) ? (firstItem.getAttribute('data-title') || '') : ''
        }
      }));
    } catch (e) { /* 批注层未加载时忽略 */ }

    fitPage();
  }

  function buildToc(manifest) {
    tocList.innerHTML = '';
    const articles = manifest.articles;
    const volumes = manifest.volumes || [];

    function addItem(a) {
      const li = document.createElement('li');
      li.className = 'toc-item';
      li.textContent = a.title;
      li.onclick = function () {
        closeToc();
        showPage(articleStart[a.title] != null ? articleStart[a.title] : 0);
      };
      tocList.appendChild(li);
    }

    // 按卷分组
    volumes.forEach(function (v) {
      const h = document.createElement('li');
      h.className = 'toc-vol';
      h.textContent = v;
      tocList.appendChild(h);
      articles.filter(function (a) { return a.volume === v; }).forEach(addItem);
    });
    // 未分卷的文章
    const rest = articles.filter(function (a) { return !a.volume; });
    if (rest.length) {
      if (volumes.length) {
        const h = document.createElement('li');
        h.className = 'toc-vol';
        h.textContent = '未分卷';
        tocList.appendChild(h);
      }
      rest.forEach(addItem);
    }
  }

  function bindEvents() {
    document.getElementById('btn-prev').onclick = function () { showPage(current - 1); };
    document.getElementById('btn-next').onclick = function () { showPage(current + 1); };
    document.getElementById('btn-toc').onclick = openToc;
    document.getElementById('btn-print').onclick = function () { buildPrintBook(); window.print(); };
    const pdfBtn = document.getElementById('btn-pdf');
    if (pdfBtn) pdfBtn.onclick = function () { window.location.href = './book.pdf'; };
    const adminBtn = document.getElementById('btn-admin');
    // Pages 会把 /admin.html 308 跳到 /admin，直接指过去省一次跳转
    if (adminBtn) adminBtn.onclick = function () { window.location.href = v('./admin'); };
    document.getElementById('toc-mask').onclick = closeToc;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') showPage(current - 1);
      else if (e.key === 'ArrowRight') showPage(current + 1);
      else if (e.key === 'Escape') closeToc();
    });
    window.addEventListener('resize', fitPage);
  }

  function openToc() {
    document.getElementById('toc').classList.add('open');
    document.getElementById('toc-mask').classList.remove('hidden');
  }
  function closeToc() {
    document.getElementById('toc').classList.remove('open');
    document.getElementById('toc-mask').classList.add('hidden');
  }

  // 构建整本打印 DOM（供浏览器打印与 Playwright 导出 PDF 共用）
  function buildPrintBook() {
    let pb = document.getElementById('print-book');
    if (!pb) {
      pb = document.createElement('div');
      pb.id = 'print-book';
      document.body.appendChild(pb);
    }
    pb.innerHTML = '';
    pages.forEach(function (p) {
      const d = document.createElement('div');
      d.className = 'page-print';
      p.items.forEach(function (el) { d.appendChild(el.cloneNode(true)); });
      const pn = document.createElement('div');
      pn.className = 'page-number';
      pn.textContent = pageLabel(p);
      d.appendChild(pn);
      pb.appendChild(d);
    });
    return pb;
  }
  window.__buildPrintBook = buildPrintBook;

  load();
})();
