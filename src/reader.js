(function () {
  // 与 reader.css 中 .page / .page-print 的内容区一致：700 - 左右padding(70*2)=560 宽；
  // 内容预算设为 840（< 版心 862），给 A4 零边距留余量：840 + 上下padding(64*2)=968 < A4 可装 994px，杜绝溢出劈页
  const PAGE_W = 560;      // 版心内容区宽（700 - 左右 padding 70×2）
  const PAGE_H = 840;      // 版心内容区高（预算上限，实测含 margin 的精确总高 ≤ 此值）
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
  const zoomIndicator = document.getElementById('zoom-indicator');

  // 仅书页缩放：zoom 作用在 #page 上，左侧目录与顶部工具栏是独立兄弟元素，不受影响。
  // 用 CSS zoom（布局级缩放、矢量重排）而非 transform，避免文字发虚；不与浏览器 ⌘+ 叠加糊字。
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let pageZoom = (function () {
    const z = parseFloat(localStorage.getItem('book-zoom'));
    return isFinite(z) ? z : 1;
  })();
  function applyZoom() {
    if (pageEl) pageEl.style.zoom = String(pageZoom);
    if (zoomIndicator) zoomIndicator.textContent = Math.round(pageZoom * 100) + '%';
    localStorage.setItem('book-zoom', String(pageZoom));
  }
  function zoomBy(dir) {
    let i = ZOOM_STEPS.indexOf(pageZoom);
    if (i < 0) {
      // 落在非预设档位时，就近吸附到最近的档
      let best = 0, bestD = Infinity;
      ZOOM_STEPS.forEach(function (s, k) { const d = Math.abs(s - pageZoom); if (d < bestD) { bestD = d; best = k; } });
      i = best;
    }
    i = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir));
    pageZoom = ZOOM_STEPS[i];
    applyZoom();
  }

  // 检测线上是否已有新版本：比较 version.json.version 与当前 BOOK_VERSION。
  // 书会持续生长（后台发文 → 重新部署），读者若一直开着旧标签页，会读到缓存旧版，
  // 因此周期性检查，发现版本落后就在顶部弹出提示条，点击即刷新。
  function checkUpdate() {
    function probe() {
      fetch(v('./version.json') + '&t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.version && d.version !== window.BOOK_VERSION) {
            var bar = document.getElementById('update-bar');
            if (bar) bar.classList.remove('hidden');
            var rl = document.getElementById('update-reload');
            if (rl) rl.onclick = function (e) { e.preventDefault(); location.reload(true); };
          }
        })
        .catch(function () { /* 离线或网络抖动时忽略 */ });
    }
    probe();
    setInterval(probe, 90 * 1000); // 每 90 秒复查一次
  }

  // 不再对书页做 CSS 缩放：缩放会抵消浏览器自身的放大，且两次缩放叠加会让文字发虚。
  // 现在版心固定 700px 宽、高度随内容自然伸展，装不下就滚动 —— 放大即真放大，始终清晰。
  function fitPage() { /* 保留调用点，当前无需缩放 */ }

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

  // 自动大纲化（第 1 步）：把正文里的“编号式条目”（1. / 1.1 / 2.3.1 …）识别为大纲标题，
  // 按编号段数映射为 Markdown 标题层级（1 → #、1.1 → ##、1.1.2 → ### …），其余正文原样保留。
  // 这样作者无需手写 # 也能得到清晰大纲。同时把“看起来像正文句子、却以 # 开头”的误标题
  // （如讲解代码注释的 “# 后面是注释。”）转义成普通段落，避免污染大纲。
  function outlineMarkdown(raw) {
    const lines = raw.split(/\r?\n/);
    const out = [];
    let inFence = false; // 跳过围栏代码块（``` / ~~~），块内行不当作大纲
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; out.push(line); continue; }
      if (inFence) { out.push(line); continue; }

      // 作者用 # 显式写的标题：
      //   · 单 # 起头 → 本库里几乎都是“未加围栏代码块里的命令行注释”，一律转义成普通段落，
      //     避免变成巨号标题（正文小节请用 ## / ###，自动大纲的 N. 会被转成 #/## 也是真标题）。
      //   · ## / ### 起头 → 真实标题，直接保留；但若内容“像正文句子 / 编号 shell 注释”也转义。
      const hm = line.match(/^(\s{0,3})(#{1,6})\s+(\S.*)$/);
      if (hm) {
        const hashes = hm[2];
        const text = hm[3];
        const looksLikeSentence = /[，,]/.test(text) || /[。！？]$/.test(text) || /^\d+[)、]/.test(text);
        if (hashes.length === 1 || looksLikeSentence) {
          out.push(hm[1] + '\\' + hashes + ' ' + text);
        } else {
          out.push(line);
        }
        continue;
      }

      // 编号式大纲条目：N. 或 N.M 或 N.M.K（必须含“.”才认作大纲，避免把“2026 年”这类普通数字句误判）。
      // 顿号 N、 也支持。
      const om = line.match(/^(\s*)(\d+(?:\.\d+)+|\d+\.|\d+、)\s*(\S.*)$/);
      if (om) {
        // 取编号段数定层级：1.→1 段(h1)，1.1→2 段(h2)，1.1.2→3 段(h3)……
        const num = om[2].replace(/[、.]$/, ''); // 去掉末尾顿号/点，得到纯编号
        const depth = Math.min(num.split('.').length, 6);
        out.push('#'.repeat(depth) + ' ' + line.trim());
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  // 自动大纲化（第 2 步）：把一篇正文里实际出现的最小标题层级平移到 h1，
  // 保证“一级标题永远最大”，无论作者用的是 # 还是 ## 起步。
  function normalizeHeadings(root) {
    const hs = [];
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(function (el) { hs.push(el); });
    if (!hs.length) return;
    let min = 6;
    hs.forEach(function (el) {
      const lv = parseInt(el.tagName.charAt(1), 10);
      if (lv < min) min = lv;
    });
    if (min === 1) return;
    const shift = min - 1;
    hs.forEach(function (el) {
      const lv = parseInt(el.tagName.charAt(1), 10);
      const newLv = Math.min(6, lv - shift);
      const n = document.createElement('h' + newLv);
      n.innerHTML = el.innerHTML;
      if (el.className) n.className = el.className;
      if (el.id) n.id = el.id;
      el.parentNode.replaceChild(n, el);
    });
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

    initToc();
    buildToc(manifest);
    current = parseInt(localStorage.getItem('book-page') || '0', 10) || 0;
    showPage(current);
    applyZoom(); // 首屏按记忆恢复书页缩放（目录/工具栏不变）
    bindEvents();
    checkUpdate(); // 检测线上是否已有新版本，提示读者刷新（避免读到缓存旧版）

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
    // 复用 .page 版式（宽 700 / padding 64×70 / 字体字号与线上书页完全一致），
    // 保证“构建时测量的分页” == “屏幕上显示的分页” == “打印 PDF 的每一页”，三处页码统一。
    measure.className = 'page';
    measure.style.cssText = 'position:absolute;left:-99999px;top:0;';
    document.body.appendChild(measure);

    for (let i = 0; i < manifest.articles.length; i++) {
      const a = manifest.articles[i];
      const raw = await fetch(v(encodeURI('./content/' + a.file))).then(function (r) { return r.text(); });
      const outlined = outlineMarkdown(raw);
      const html = (window.marked ? marked.parse(outlined, { html: true }) : '<pre>' + outlined + '</pre>');
      const section = document.createElement('section');
      section.setAttribute('data-title', a.title);
      section.setAttribute('data-volume', a.volume || '');
      section.innerHTML =
        '<div class="meta">' + (a.volume ? a.volume + ' · ' : '') + a.title + '</div>' + html;
      normalizeHeadings(section); // 自动大纲化：把正文各级标题归一为“一级最大”的清晰层级
      measure.appendChild(section);
    }

    await new Promise(function (r) { setTimeout(r, 400); }); // 等字体/图片布局稳定
    paginate(measure);
    document.body.removeChild(measure);
  }

  // 真实分页：把每篇文章拆成“块”（meta / 标题 / 段落 / 列表项……），逐块装入固定版心。
  // 关键：用“真实 .page 容器 + scrollHeight”测量含段落 margin 的精确总高，避免只量 offsetHeight（不含 margin）
  // 导致预算少算几十~上百像素，长文章的多段落页在 A4 里溢出被劈成两页。
  function paginate(measure) {
    pages = [];
    let cur = null;       // { items, volume, volumePage, globalPage }
    let curEl = null;     // 当前页的真实容器，用于精确量含 margin 的总高
    let h = 0;
    const volCounter = {};
    const blocks = [];

    // 展平：section -> 其子元素；遇到 ul/ol 再展平成各个 li（列表项独立成块，可逐条分页）
    Array.prototype.slice.call(measure.children).forEach(function (section) {
      if (!section.getAttribute) return;
      const vol = section.getAttribute('data-volume') || '';
      const title = section.getAttribute('data-title') || '';
      Array.prototype.slice.call(section.children).forEach(function (kid, ki) {
        if (kid.tagName === 'UL' || kid.tagName === 'OL') {
          Array.prototype.slice.call(kid.children).forEach(function (li) {
            blocks.push({ el: li, volume: vol, title: title, first: false });
          });
        } else {
          blocks.push({ el: kid, volume: vol, title: title, first: ki === 0 });
        }
      });
    });

    function newPage() {
      cur = { items: [], volume: '', volumePage: 0, globalPage: pages.length + 1 };
      pages.push(cur);
      // 与 .page / .page-print 相同的内容盒（宽 700，padding 64/70，box-border → 内容 560），
      // 但不设 min-height（否则每页虚高 990），用离屏容器精确测量。
      curEl = document.createElement('div');
      curEl.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;width:700px;min-height:0;padding:64px 70px;box-sizing:border-box;';
      measure.appendChild(curEl);
      h = 0;
    }

    // 当前页“内容区”真实总高（含段落 margin 与折叠），减去上下 padding 128
    function pageH() { return Math.max(0, curEl.scrollHeight - 128); }

    // 把节点放入当前页：先接入量高度，超预算则另起一页（保证每页真实高度 ≤ PAGE_H）
    function pushToPage(node, b) {
      if (!cur) newPage();
      curEl.appendChild(node);
      const newH = pageH();
      if (cur.items.length > 0 && newH > PAGE_H) {
        curEl.removeChild(node);
        newPage();
        curEl.appendChild(node);
      }
      if (!cur.volume) cur.volume = b.volume;
      if (b.first) { node.setAttribute('data-title', b.title); b.first = false; }
      cur.items.push(node);
      h = pageH();
    }

    // 在 maxH 内容预算内最多容纳多少字符（二分），并尽量在句末标点处断开
    function fitChars(el, text, maxH) {
      if (maxH <= 0) return 0;
      const probe = el.cloneNode(false);
      measure.appendChild(probe);
      if (probe.offsetHeight <= maxH) { measure.removeChild(probe); return text.length; }
      let lo = 1, hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        probe.textContent = text.slice(0, mid);
        if (probe.offsetHeight <= maxH) lo = mid; else hi = mid - 1;
      }
      measure.removeChild(probe);
      let cut = lo;
      const back = Math.min(cut, 24);
      for (let k = cut; k > cut - back && k > 0; k--) {
        const ch = text.charAt(k - 1);
        if (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '，' || ch === '、' || ch === '\n') { cut = k; break; }
      }
      return Math.max(1, cut);
    }

    function pushLeaf(b, text) {
      const node = b.el.cloneNode(false);
      node.textContent = text;
      pushToPage(node, b);
    }

    // 超长块（> 一整页）：先填当前页剩余空间，再逐页铺满
    function addLeaf(b, text) {
      if (!text) return;
      if (cur && cur.items.length > 0) {
        const avail = PAGE_H - h;
        if (avail > 0) {
          const n = fitChars(b.el, text, avail);
          if (n >= text.length) { pushLeaf(b, text); return; }
          pushLeaf(b, text.slice(0, n));
          text = text.slice(n);
        }
      }
      while (text.length) {
        if (!cur) newPage();
        else if (cur.items.length > 0) newPage();
        const n = fitChars(b.el, text, PAGE_H);
        pushLeaf(b, text.slice(0, n));
        text = text.slice(n);
      }
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      // 决定是否需要另起一页：卷边界，或新文章起始（仿线装书，每篇自起一页）
      let needNew = false;
      if (cur && cur.items.length > 0) {
        if (cur.volume !== b.volume) needNew = true;
        else if (b.first) needNew = true;
      }
      if (needNew) newPage();

      const el = b.el;
      const bh = el.offsetHeight; // 块已在 measure(.page) 内，可直接量其 intrinsic 高度
      if (bh <= PAGE_H) {
        pushToPage(el.cloneNode(true), b);
      } else {
        addLeaf(b, el.textContent); // 单块超一页：按字符切分
      }
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

    syncTocCurrent();
    fitPage();
  }

  function buildToc(manifest) {
    tocList.innerHTML = '';
    const articles = manifest.articles;
    const volumes = manifest.volumes || [];

    function addItem(a) {
      const li = document.createElement('li');
      li.className = 'toc-item';
      li.dataset.title = a.title;
      const span = document.createElement('span');
      span.textContent = a.title;
      li.appendChild(span);
      const pn = document.createElement('span');
      pn.className = 'toc-page';
      const st = articleStart[a.title];
      pn.textContent = st != null ? ('p' + (st + 1)) : '';
      li.appendChild(pn);
      li.onclick = function () {
        if (isNarrow()) closeToc();
        showPage(st != null ? st : 0);
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

    const cnt = document.getElementById('toc-count');
    if (cnt) cnt.textContent = '共 ' + articles.length + ' 篇 · ' + pages.length + ' 页';
    syncTocCurrent();
  }

  // 左侧目录：高亮当前所在篇
  function syncTocCurrent() {
    if (!tocList) return;
    let curTitle = null;
    Object.keys(articleStart).forEach(function (t) {
      const st = articleStart[t];
      if (st == null || st > current) return;
      if (curTitle == null || articleStart[curTitle] <= st) curTitle = t;
    });
    const items = tocList.querySelectorAll('.toc-item');
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('cur', items[i].dataset.title === curTitle);
    }
  }

  function isNarrow() { return window.innerWidth < 900; }

  function toggleToc() {
    const toc = document.getElementById('toc');
    if (!toc) return;
    if (isNarrow()) {
      const open = toc.classList.toggle('open');
      document.getElementById('toc-mask').classList.toggle('hidden', !open);
    } else {
      const collapsed = toc.classList.toggle('collapsed');
      localStorage.setItem('book-toc', collapsed ? '0' : '1');
    }
    fitPage();
  }

  function closeToc() {
    const toc = document.getElementById('toc');
    if (!toc) return;
    if (isNarrow()) {
      toc.classList.remove('open');
      document.getElementById('toc-mask').classList.add('hidden');
    } else {
      toc.classList.add('collapsed');
      localStorage.setItem('book-toc', '0');
    }
    fitPage();
  }

  function initToc() {
    const toc = document.getElementById('toc');
    if (toc && !isNarrow() && localStorage.getItem('book-toc') === '0') toc.classList.add('collapsed');
  }

  function bindEvents() {
    document.getElementById('btn-prev').onclick = function () { showPage(current - 1); };
    document.getElementById('btn-next').onclick = function () { showPage(current + 1); };
    const zoomOut = document.getElementById('btn-zoom-out');
    const zoomIn = document.getElementById('btn-zoom-in');
    if (zoomOut) zoomOut.onclick = function () { zoomBy(-1); };
    if (zoomIn) zoomIn.onclick = function () { zoomBy(1); };
    document.getElementById('btn-toc').onclick = toggleToc;
    document.getElementById('btn-print').onclick = function () { buildPrintBook(); window.print(); };
    const pdfBtn = document.getElementById('btn-pdf');
    if (pdfBtn) pdfBtn.onclick = function () { window.location.href = v('./book.pdf'); };
    const adminBtn = document.getElementById('btn-admin');
    // Pages 会把 /admin.html 308 跳到 /admin，直接指过去省一次跳转
    if (adminBtn) adminBtn.onclick = function () { window.location.href = v('./admin'); };
    // 插入新页面：在中间插书页的设计入口
    const insertBtn = document.getElementById('btn-insert');
    if (insertBtn) insertBtn.onclick = openInsert;
    const insClose = document.getElementById('ins-close');
    if (insClose) insClose.onclick = closeInsert;
    const insGen = document.getElementById('ins-gen');
    if (insGen) insGen.onclick = genInsert;
    const insModal = document.getElementById('insert-modal');
    if (insModal) insModal.addEventListener('click', function (e) { if (e.target === insModal) closeInsert(); });
    document.getElementById('toc-mask').onclick = closeToc;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') showPage(current - 1);
      else if (e.key === 'ArrowRight') showPage(current + 1);
      else if (e.key === 'Escape' && isNarrow()) closeToc();
    });
    window.addEventListener('resize', function () { initToc(); fitPage(); });
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

  // ---------------- 插入新页面 ----------------
  let articleList = [];
  function openInsert() {
    const modal = document.getElementById('insert-modal');
    if (!modal) return;
    const sel = document.getElementById('ins-after');
    const msg = document.getElementById('ins-msg');
    if (msg) msg.textContent = '';
    if (sel) {
      sel.innerHTML = '';
      fetch(v('./manifest.json') + '?t=' + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (m) {
          articleList = (m && m.articles) || [];
          articleList.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (a) {
            const o = document.createElement('option');
            o.value = String(a.order);
            o.textContent = a.title + '（order ' + a.order + '）';
            sel.appendChild(o);
          });
          const end = document.createElement('option');
          end.value = '__END__';
          end.textContent = '（书末）';
          sel.appendChild(end);
        })
        .catch(function () { /* 忽略 */ });
    }
    modal.classList.remove('hidden');
  }
  function closeInsert() {
    const modal = document.getElementById('insert-modal');
    if (modal) modal.classList.add('hidden');
  }
  function genInsert() {
    const title = (document.getElementById('ins-title').value || '').trim();
    const volume = (document.getElementById('ins-volume').value || '').trim();
    const body = document.getElementById('ins-body').value || '';
    const after = document.getElementById('ins-after').value;
    const msg = document.getElementById('ins-msg');
    if (!title) { if (msg) msg.textContent = '请填写标题'; return; }
    const sorted = articleList.map(function (a) { return a.order; }).slice().sort(function (a, b) { return a - b; });
    let newOrder;
    if (after === '__END__' || sorted.length === 0) {
      newOrder = (sorted.length ? sorted[sorted.length - 1] : 0) + 1;
    } else {
      const o = parseFloat(after);
      let next = null;
      for (let i = 0; i < sorted.length; i++) { if (sorted[i] > o + 1e-9) { next = sorted[i]; break; } }
      newOrder = next == null ? o + 1 : (o + next) / 2;
      newOrder = Math.round(newOrder * 100) / 100;
    }
    // 卷：用户填了用用户的；否则取插入位置的卷
    let vol = volume;
    if (!vol && after !== '__END__') {
      const hit = articleList.find(function (a) { return String(a.order) === String(after); });
      if (hit) vol = hit.volume || '';
    }
    const slug = title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || ('page-' + Date.now());
    const fm = ['---', 'order: ' + newOrder, 'title: ' + title, 'volume: ' + vol, '---', '', body].join('\n');
    const fname = slug + '.md';
    const blob = new Blob([fm], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    if (msg) {
      msg.textContent = '已生成 ' + fname + '（order: ' + newOrder + '，volume: ' + (vol || '（空）') +
        '）。把它放进 content/ 下对应卷的文件夹，git push 即上线，新页会自动落在“' +
        (after === '__END__' ? '书末' : '所选页面之后') + '”。';
    }
  }

  // 字体/样式就绪前先隐藏内容，避免刷新瞬间中文未就绪被渲染成方块（tofu）一闪而过；
  // 待 document.fonts.ready（系统中文就绪）后再淡入显示
  function markReady() { var a = document.getElementById('app'); if (a) a.classList.add('ready'); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(markReady);
  setTimeout(markReady, 1500); // 兜底：字体 API 异常时也确保内容可显示
})();
