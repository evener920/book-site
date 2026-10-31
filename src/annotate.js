// 阅读批注层：选中即高亮 / 划线 / 波浪线 / 备注。
// 设计：未登录也能用 —— 批注先存本地（localStorage），登录后自动镜像到 D1 实现跨设备同步。
// 这样“正文可以划线/波浪线/高亮”是即时的，不必先登录（之前必须先登录，会让正文弹出一个登录大框）。
(function () {
  const API = String(window.BOOK_API || '').replace(/\/+$/, '');
  const CTX = 20;            // 保存的上下文长度（用于跨会话/换排版定位）
  const HOST_ID = 'page';
  const LOCAL_KEY = 'book_anns_v1';

  let token = localStorage.getItem('book_token') || '';
  let user = localStorage.getItem('book_user') || '';
  let anns = [];             // 全部批注（本地 + 远端合并）
  let cur = null;            // 当前页信息
  let activeRange = null;    // 待保存的选区
  let activeId = null;       // 正在编辑的批注 id
  let loaded = false;        // 远端是否已加载/合并
  let curColor = 'mi';       // 当前配色：mi 米黄 / lv 浅绿 / fen 浅粉
  let authPanel, annBar, annPop;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function msg(t) { const m = $('ann-msg'); if (m) m.textContent = t || ''; }

  // 柔和阅读配色（与后台写书一致：米黄 / 浅绿 / 浅粉）
  const PALETTE = {
    mi:  { bg: 'rgba(247,236,201,.55)', line: '#cd9b3e', label: '米黄', solid: '#f7ecc9' },
    lv:  { bg: 'rgba(217,236,210,.55)', line: '#4f9e6b', label: '浅绿', solid: '#d9ecd2' },
    fen: { bg: 'rgba(248,220,230,.55)', line: '#d76b94', label: '浅粉', solid: '#f8dce6' }
  };
  // 旧账号遗留配色（D1 里可能存的是 gold/cinnabar/moss/indigo），保留以兼容历史批注
  const LEGACY = {
    gold:     { bg: 'rgba(214,164,60,.32)', line: '#d6a43c' },
    cinnabar: { bg: 'rgba(156,74,54,.22)', line: '#9c4a36' },
    moss:     { bg: 'rgba(94,122,96,.26)',  line: '#5e7a60' },
    indigo:   { bg: 'rgba(70,94,128,.22)', line: '#465e80' }
  };

  // ---------------- 本地存储 ----------------
  function loadLocal() {
    try { anns = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch (e) { anns = []; }
  }
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(anns)); } catch (e) { /* 隐私模式等忽略 */ }
  }
  function keyOf(a) { return [a.pageGlobal, a.quote, a.type, a.color].join('|'); }
  function findAnn(id) {
    for (let i = 0; i < anns.length; i++) if (String(anns[i].id) === String(id)) return anns[i];
    return null;
  }

  // ---------------- UI ----------------
  function buildUI() {
    const bar = $('toolbar');
    if (bar && !$('btn-auth')) {
      const b1 = mk('button', '', '');
      b1.id = 'btn-auth';
      b1.onclick = openAuth;
      bar.appendChild(b1);
    }
    updateAuthBtn();

    authPanel = document.createElement('div');
    authPanel.className = 'ann-panel hidden';
    authPanel.id = 'auth-panel';
    authPanel.innerHTML =
      '<div class="ann-card">' +
      '<h3>登录 / 注册</h3>' +
      '<input id="ann-username" placeholder="用户名（换设备用同一个）" autocomplete="username">' +
      '<input id="ann-password" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password">' +
      '<div class="ann-row">' +
      '<button id="ann-do-login">登录</button>' +
      '<button id="ann-do-register">注册并登录</button>' +
      '</div>' +
      '<p class="ann-hint">不登录也能划线/波浪线/高亮（存在本机）。登录后可在任意设备同步批注。</p>' +
      '<div class="ann-row"><button id="ann-close">关闭</button><button id="ann-logout">退出登录</button></div>' +
      '<p id="ann-msg" class="ann-msg"></p>' +
      '</div>';
    document.body.appendChild(authPanel);
    authPanel.querySelector('#ann-do-login').onclick = function () { authReq('/api/auth/login'); };
    authPanel.querySelector('#ann-do-register').onclick = function () { authReq('/api/auth/register'); };
    authPanel.querySelector('#ann-close').onclick = function () { authPanel.classList.add('hidden'); };
    authPanel.querySelector('#ann-logout').onclick = logout;

    annBar = document.createElement('div');
    annBar.className = 'ann-toolbar hidden';
    annBar.id = 'ann-toolbar';
    annBar.innerHTML =
      '<button data-act="highlight" title="高亮（文字加柔和底色）">🔆 高亮</button>' +
      '<button data-act="underline" title="划线（文字下方加直线）">▁ 划线</button>' +
      '<button data-act="wave" title="波浪线（文字下方加波浪线）">〰 波浪</button>' +
      '<button data-act="note" title="高亮并写备注">备注…</button>' +
      '<span class="ann-sep"></span>' +
      '<button data-color="mi" class="swatch on" title="米黄" style="background:#f7ecc9"></button>' +
      '<button data-color="lv" class="swatch" title="浅绿" style="background:#d9ecd2"></button>' +
      '<button data-color="fen" class="swatch" title="浅粉" style="background:#f8dce6"></button>' +
      '<span class="ann-sep"></span>' +
      '<button data-act="cancel">取消</button>';
    document.body.appendChild(annBar);
    annBar.addEventListener('click', onToolbarClick);

    annPop = document.createElement('div');
    annPop.className = 'ann-pop hidden';
    annPop.id = 'ann-pop';
    annPop.innerHTML =
      '<textarea id="ann-note" rows="3" placeholder="写下你的想法…"></textarea>' +
      '<div class="ann-row ann-colors">' +
      '<button data-color="mi" class="swatch on" title="米黄" style="background:#f7ecc9"></button>' +
      '<button data-color="lv" class="swatch" title="浅绿" style="background:#d9ecd2"></button>' +
      '<button data-color="fen" class="swatch" title="浅粉" style="background:#f8dce6"></button>' +
      '</div>' +
      '<div class="ann-row">' +
      '<button id="ann-save">保存</button>' +
      '<button id="ann-del">删除</button>' +
      '<button id="ann-pop-close">关闭</button>' +
      '</div>';
    document.body.appendChild(annPop);
    annPop.querySelector('#ann-save').onclick = saveNote;
    annPop.querySelector('#ann-del').onclick = deleteActive;
    annPop.querySelector('#ann-pop-close').onclick = function () { annPop.classList.add('hidden'); };
    annPop.querySelector('.ann-colors').addEventListener('click', function (e) {
      if (e.target && e.target.dataset && e.target.dataset.color) setColor(e.target.dataset.color);
    });
  }

  function updateAuthBtn() {
    const b = $('btn-auth');
    if (b) b.textContent = user ? ('已登录 ' + user) : '登录/同步';
  }

  function openAuth() {
    authPanel.classList.remove('hidden');
    const u = $('ann-username');
    if (u && user) u.value = user;
    msg('');
  }

  // ---------------- 账号 ----------------
  async function authReq(path) {
    if (!API) { msg('未配置 API 地址'); return; }
    const username = ($('ann-username').value || '').trim();
    const password = ($('ann-password').value || '');
    if (!username || !password) { msg('请填写用户名和密码'); return; }
    try {
      const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      const d = await r.json().catch(function () { return {}; });
      if (d && d.token) {
        token = d.token;
        user = d.username;
        localStorage.setItem('book_token', token);
        localStorage.setItem('book_user', user);
        updateAuthBtn();
        authPanel.classList.add('hidden');
        await syncAfterLogin();
      } else {
        msg((d && d.error) || '登录失败');
      }
    } catch (e) { msg('网络异常：' + e.message); }
  }

  async function logout() {
    token = ''; user = ''; loaded = false;
    localStorage.removeItem('book_token');
    localStorage.removeItem('book_user');
    updateAuthBtn();
    msg('已退出登录（本机批注仍保留）');
  }

  // ---------------- 远端（D1）同步 ----------------
  async function loadRemote() {
    if (!token || !API) return;
    try {
      const r = await fetch(API + '/api/annotations', { headers: { 'Authorization': 'Bearer ' + token } });
      const d = await r.json().catch(function () { return {}; });
      const list = (d && d.annotations) || [];
      mergeRemote(list);
      loaded = true;
    } catch (e) { /* 忽略 */ }
  }

  // 把远端批注并入本地：同 id 更新；同内容键则认领（标记已同步）；新远端则加入
  function mergeRemote(list) {
    let changed = false;
    list.forEach(function (r) {
      const existing = anns.find(function (a) { return String(a.id) === String(r.id); });
      if (existing) {
        existing.note = r.note; existing.color = r.color; existing.type = r.type; existing.synced = true;
        return;
      }
      const dup = anns.find(function (a) { return !a.synced && keyOf(a) === keyOf(r); });
      if (dup) { dup.id = r.id; dup.synced = true; changed = true; return; }
      anns.push({
        id: r.id, articleTitle: r.articleTitle, volume: r.volume, pageGlobal: r.pageGlobal,
        quote: r.quote, prefix: r.prefix, suffix: r.suffix, startOffset: r.startOffset,
        type: r.type, color: r.color, note: r.note || '', synced: true
      });
      changed = true;
    });
    if (changed) saveLocal();
  }

  // 登录后：拉取远端，并把本机未同步的批注推上去（实现跨设备）
  async function syncAfterLogin() {
    await loadRemote();
    const unsynced = anns.filter(function (a) { return !a.synced; });
    for (let i = 0; i < unsynced.length; i++) {
      await api('POST', '/api/annotations', toBody(unsynced[i])).then(function (d) {
        if (d && d.annotation) { unsynced[i].id = d.annotation.id; unsynced[i].synced = true; }
      }).catch(function () {});
    }
    saveLocal();
    if (cur) applyForPage();
  }

  function api(method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { 'Authorization': 'Bearer ' + token } : {}
      ),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function toBody(a) {
    return {
      articleTitle: a.articleTitle, volume: a.volume, pageGlobal: a.pageGlobal,
      quote: a.quote, prefix: a.prefix, suffix: a.suffix, startOffset: a.startOffset,
      type: a.type, color: a.color, note: a.note || ''
    };
  }

  // ---------------- 文本锚点 ----------------
  function collectTextNodes() {
    const host = $(HOST_ID);
    if (!host) return [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        let p = n.parentElement;
        while (p && p !== host) {
          if (p.classList && p.classList.contains('page-number')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let t;
    while ((t = walker.nextNode())) nodes.push(t);
    return nodes;
  }

  function fullText() {
    return collectTextNodes().map(function (n) { return n.nodeValue; }).join('');
  }

  function rangeStartIdx(range) {
    const host = $(HOST_ID);
    const pre = document.createRange();
    pre.selectNodeContents(host);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function locate(nodes, pos) {
    let sum = 0;
    for (let i = 0; i < nodes.length; i++) {
      const len = nodes[i].nodeValue.length;
      if (sum + len >= pos) return { node: nodes[i], offset: pos - sum };
      sum += len;
    }
    if (!nodes.length) return null;
    const last = nodes[nodes.length - 1];
    return { node: last, offset: last.nodeValue.length };
  }

  // 把一段 Range 包成批注元素（跨节点也会包，且不与已有批注嵌套）。
  // 用“全局偏移”定位，避免选区跨越被上一条批注切开的节点边界时，startOffset/endOffset
  // 被误当成当前节点内偏移而包出空片段（相邻批注重渲染失败的根因）。
  function wrap(range, ann) {
    const host = $(HOST_ID);
    const gStart = rangeStartIdx(range);
    const gEnd = gStart + range.toString().length;
    if (gEnd <= gStart) return false;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        let p = n.parentElement;
        while (p && p !== host) {
          if (p.classList && p.classList.contains('page-number')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let t;
    while ((t = walker.nextNode())) nodes.push(t);
    if (!nodes.length) return false;

    let sum = 0;
    let wrapped = false;
    nodes.forEach(function (node) {
      // 已经在别的批注里就跳过，避免嵌套/重复包裹
      let pp = node.parentElement;
      while (pp && pp !== host) { if (pp.classList && pp.classList.contains('ann')) return; pp = pp.parentElement; }
      const nodeStart = sum;
      const nodeEnd = sum + node.nodeValue.length;
      sum = nodeEnd;
      const s = Math.max(nodeStart, gStart);
      const e2 = Math.min(nodeEnd, gEnd);
      if (e2 <= s) return;
      let target = node;
      const localS = s - nodeStart;
      const localE = e2 - nodeStart;
      if (localS > 0) target = target.splitText(localS);
      if (localE - localS < target.nodeValue.length) target.splitText(localE - localS);
      const el = document.createElement((ann.type === 'underline' || ann.type === 'wave') ? 'span' : 'mark');
      el.className = 'ann ann-' + ann.type + ' ann-' + (ann.color || 'mi');
      el.setAttribute('data-ann-id', ann.id);
      target.parentNode.insertBefore(el, target);
      el.appendChild(target);
      wrapped = true;
    });
    return wrapped;
  }

  // 在“当前全文”中定位一条批注，返回 {start, end}（字符偏移，含 .ann 文本，与 rangeStartIdx 同一坐标系）
  function locateAnn(ann) {
    const nodes = collectTextNodes();
    if (!nodes.length) return null;
    const full = nodes.map(function (n) { return n.nodeValue; }).join('');
    let start = -1;
    const ctx = ann.prefix + ann.quote + ann.suffix;
    const idx = ctx ? full.indexOf(ctx) : -1;
    if (idx !== -1) {
      start = idx + ann.prefix.length;
    } else {
      // 上下文没匹配上（内容改版/排版变化）：退化为按引文找最接近的一处
      let from = 0, best = -1;
      while (true) {
        const i = full.indexOf(ann.quote, from);
        if (i === -1) break;
        if (best === -1 || Math.abs(i - ann.startOffset) < Math.abs(best - ann.startOffset)) best = i;
        from = i + 1;
      }
      if (best === -1) return null;
      start = best;
    }
    return { start: start, end: start + ann.quote.length };
  }

  // 把 [start,end) 这段文本包成批注元素（基于当前 DOM 重新定位，支持跨节点）
  function wrapSpan(start, end, ann) {
    const nodes = collectTextNodes();
    if (!nodes.length) return;
    const s = locate(nodes, start);
    const e = locate(nodes, end);
    if (!s || !e) return;
    const range = document.createRange();
    try {
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
    } catch (err) { return; }
    wrap(range, ann);
  }

  // 整页渲染：先清干净，再为所有批注计算区间、按边界切分、从后往前包裹。
  // 这样支持相邻/重叠批注，且不会产生重复包裹（旧逻辑逐条包 + walker 排斥 .ann 导致坐标系错位）。
  function applyForPage() {
    if (!cur) return;
    // 重绘会 splitText / normalize 文本节点，若不先清掉选区，浏览器会把选区边界
    // 吸附到合并后的节点边缘 —— 表现为“残留选区从上一条划线一直拉到这里”。
    clearSelection();
    clearAnnMarks();   // 清掉当前页已有的 .ann，从干净文本重新渲染
    const list = anns.filter(function (a) { return a.pageGlobal === cur.globalPage; });
    if (!list.length) return;

    const spans = [];
    list.forEach(function (ann) {
      const r = locateAnn(ann);
      if (r) spans.push({ start: r.start, end: r.end, ann: ann });
    });
    if (!spans.length) return;

    const bounds = {};
    spans.forEach(function (s) { bounds[s.start] = 1; bounds[s.end] = 1; });
    const pts = Object.keys(bounds).map(Number).sort(function (a, b) { return a - b; });

    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b <= a) continue;
      let chosen = null;
      for (let j = spans.length - 1; j >= 0; j--) {
        // 重叠时取“后做”的那条覆盖（视觉上以最新操作为准）
        if (spans[j].start <= a && spans[j].end >= b) { chosen = spans[j].ann; break; }
      }
      if (chosen) segs.push({ start: a, end: b, ann: chosen });
    }

    segs.sort(function (x, y) { return y.start - x.start; }); // 从后往前，避免 splitText 影响前面段的定位
    segs.forEach(function (seg) { wrapSpan(seg.start, seg.end, seg.ann); });
  }

  function clearSelection() {
    try {
      const s = window.getSelection();
      if (s && s.rangeCount) s.removeAllRanges();
    } catch (e) { /* 忽略 */ }
    activeRange = null;
  }

  function clearAnnMarks() {
    const host = $(HOST_ID);
    if (!host) return;
    const parents = [];
    Array.prototype.slice.call(host.querySelectorAll('.ann')).forEach(function (m) {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      if (parents.indexOf(p) === -1) parents.push(p);   // 同一段落只 normalize 一次
    });
    parents.forEach(function (p) {
      try { p.normalize(); } catch (e) { /* 忽略 */ }
    });
  }

  // ---------------- 交互 ----------------
  function showBar(rect) {
    annBar.classList.remove('hidden');
    const top = Math.max(8, rect.top - annBar.offsetHeight - 10);
    annBar.style.top = top + 'px';
    annBar.style.left = Math.max(8, Math.min(window.innerWidth - annBar.offsetWidth - 8, rect.left + rect.width / 2 - annBar.offsetWidth / 2)) + 'px';
  }

  document.addEventListener('mouseup', function (e) {
    if (!annBar) return;
    setTimeout(function () {
      if (annBar.contains(e.target) || annPop.contains(e.target)) return;
      const sel = window.getSelection();
      const host = $(HOST_ID);
      if (!sel || sel.isCollapsed || sel.toString().trim().length === 0 || !host || !host.contains(sel.anchorNode)) {
        annBar.classList.add('hidden');
        return;
      }
      const r0 = sel.getRangeAt(0);
      // 选区必须完整落在正文容器内，否则偏移计算会跨出容器（把页外文字也算进来）
      if (!host.contains(r0.startContainer) || !host.contains(r0.endContainer)) {
        annBar.classList.add('hidden');
        return;
      }
      activeRange = r0.cloneRange();
      showBar(activeRange.getBoundingClientRect());
    }, 10);
  });

  function onToolbarClick(e) {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.color) {
      // 切换配色，工具条保持打开
      curColor = t.dataset.color;
      annBar.querySelectorAll('.swatch').forEach(function (s) { s.classList.toggle('on', s.dataset.color === curColor); });
      return;
    }
    const act = t.dataset.act;
    if (!act) return;
    annBar.classList.add('hidden');
    if (act === 'cancel') return;
    if (act === 'note') createAnn('highlight', curColor, '').then(function (id) { if (id != null) openPop(id); });
    else createAnn(act, curColor, '');
  }

  async function createAnn(type, color, note) {
    if (!activeRange) return null;
    const quote = activeRange.toString();
    if (!quote.trim()) return null;
    const full = fullText();
    const start = rangeStartIdx(activeRange);
    const ann = {
      id: 'l_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      articleTitle: cur ? cur.articleTitle : '',
      volume: cur ? cur.volume : '',
      pageGlobal: cur ? cur.globalPage : 0,
      quote: quote,
      prefix: full.slice(Math.max(0, start - CTX), start),
      suffix: full.slice(start + quote.length, start + quote.length + CTX),
      startOffset: start,
      type: type,
      color: color,
      note: note || '',
      synced: false
    };
    anns.push(ann);
    saveLocal();
    applyForPage();   // 统一由 applyForPage 包裹（幂等：先清后包），避免 createAnn 直接包 + book:page 再包导致重复
    activeId = ann.id;
    if (token && API) {
      const d = await api('POST', '/api/annotations', toBody(ann)).catch(function () { return {}; });
      if (d && d.annotation) { ann.id = d.annotation.id; ann.synced = true; saveLocal(); }
    }
    return ann.id;
  }

  function openPop(id) {
    activeId = id;
    const a = findAnn(activeId);
    if (!a) return;
    $('ann-note').value = a.note || '';
    annPop.querySelectorAll('.ann-colors .swatch').forEach(function (s) { s.classList.toggle('on', s.dataset.color === (a.color || 'mi')); });
    annPop.classList.remove('hidden');
    annPop.style.top = '120px';
    annPop.style.left = Math.max(8, window.innerWidth / 2 - 150) + 'px';
  }

  async function saveNote() {
    if (activeId == null) return;
    const note = $('ann-note').value;
    const a = findAnn(activeId);
    if (a) { a.note = note; saveLocal(); if (token && API) await api('PATCH', '/api/annotations/' + a.id, { note: note }); }
    annPop.classList.add('hidden');
  }

  async function setColor(color) {
    if (activeId == null) return;
    curColor = color;
    const a = findAnn(activeId);
    if (!a) return;
    a.color = color; saveLocal();
    Array.prototype.slice.call($(HOST_ID).querySelectorAll('.ann[data-ann-id="' + activeId + '"]')).forEach(function (m) {
      m.className = 'ann ann-' + a.type + ' ann-' + color;
    });
    annPop.querySelectorAll('.ann-colors .swatch').forEach(function (s) { s.classList.toggle('on', s.dataset.color === color); });
    if (token && API) await api('PATCH', '/api/annotations/' + a.id, { color: color });
  }

  async function deleteActive() {
    if (activeId == null) return;
    const host = $(HOST_ID);
    clearSelection();   // 删除同样会 unwrap+normalize，先清选区避免选区被撑开
    anns = anns.filter(function (a) { return String(a.id) !== String(activeId); });
    saveLocal();
    Array.prototype.slice.call(host.querySelectorAll('.ann[data-ann-id="' + activeId + '"]')).forEach(function (m) {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
    if (token && API) await api('DELETE', '/api/annotations/' + activeId);
    annPop.classList.add('hidden');
    activeId = null;
  }

  document.addEventListener('click', function (e) {
    if (!annPop) return;
    const target = e.target && e.target.closest ? e.target.closest('.ann') : null;
    if (target && target.getAttribute('data-ann-id')) {
      openPop(target.getAttribute('data-ann-id'));
    } else if (!annPop.contains(e.target) && !annBar.contains(e.target)) {
      if (!annPop.classList.contains('hidden')) annPop.classList.add('hidden');
    }
  });

  // ---------------- 页切换 ----------------
  document.addEventListener('book:page', function (e) {
    cur = e.detail;
    applyForPage();                 // 先渲染本机批注（即时，无需登录）
    if (token && API && !loaded) {   // 登录则并行拉取云端批注
      loadRemote().then(applyForPage);
    }
  });

  function init() {
    if (!$(HOST_ID)) { setTimeout(init, 200); return; }
    loadLocal();
    buildUI();
    firstHint();
  }

  // 首次进入的轻提示：让评审/新读者一眼知道核心玩法（选中即批注）。
  // 挂在 body 上而非 #page 内 —— 进了 #page 会改变文本节点序列，破坏批注偏移坐标系。
  function firstHint() {
    let seen = false;
    try { seen = !!localStorage.getItem('book_ann_hint_v1'); } catch (e) {}
    if (seen) return;
    const tip = mk('div', 'ann-firsthint');
    tip.innerHTML = '<span>✦ 选中正文文字，即可划线 · 波浪 · 高亮；点击标记可写备注</span>';
    const ok = mk('button', '', '知道了');
    ok.onclick = function () {
      tip.classList.add('hidden');
      try { localStorage.setItem('book_ann_hint_v1', '1'); } catch (e) {}
    };
    tip.appendChild(ok);
    document.body.appendChild(tip);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
