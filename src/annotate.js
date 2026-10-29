// 阅读批注层：选中即高亮/划线/写备注，登录后与 Worker + D1 同步（换设备同一账号即可见）
(function () {
  const API = String(window.BOOK_API || '').replace(/\/+$/, '');
  const CTX = 20;            // 保存的上下文长度（用于跨会话定位）
  const HOST_ID = 'page';

  let token = localStorage.getItem('book_token') || '';
  let user = localStorage.getItem('book_user') || '';
  let anns = [];             // 服务端批注列表
  let cur = null;            // 当前页信息
  let activeRange = null;    // 待保存的选区
  let activeId = null;       // 正在编辑的批注 id
  let loaded = false;
  let authPanel, annBar, annPop;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function msg(t) { const m = $('ann-msg'); if (m) m.textContent = t || ''; }

  // ---------------- UI ----------------
  function buildUI() {
    const bar = $('toolbar');
    if (bar && !$('btn-auth')) {
      const b1 = mk('button', '', '');
      b1.id = 'btn-auth';
      b1.onclick = openAuth;
      bar.appendChild(b1);
      const b2 = mk('button', '', '导出批注');
      b2.id = 'btn-export';
      b2.onclick = exportMd;
      bar.appendChild(b2);
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
      '<p class="ann-hint">同一账号在任意设备登录，批注都会同步过来。</p>' +
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
      '<button data-act="highlight" data-color="gold">高亮</button>' +
      '<button data-act="underline" data-color="cinnabar">划线</button>' +
      '<button data-act="note">备注…</button>' +
      '<button data-act="cancel">取消</button>';
    document.body.appendChild(annBar);
    annBar.addEventListener('click', onToolbarClick);

    annPop = document.createElement('div');
    annPop.className = 'ann-pop hidden';
    annPop.id = 'ann-pop';
    annPop.innerHTML =
      '<textarea id="ann-note" rows="3" placeholder="写下你的想法…"></textarea>' +
      '<div class="ann-row ann-colors">' +
      '<button data-color="gold">藤黄</button>' +
      '<button data-color="cinnabar">朱砂</button>' +
      '<button data-color="moss">松绿</button>' +
      '<button data-color="indigo">靛青</button>' +
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
    if (b) b.textContent = user ? ('已登录 ' + user) : '登录';
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
    const password = $('ann-password').value || '';
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
        loaded = false;
        await loadAnns();
        applyAll();
      } else {
        msg((d && d.error) || '登录失败');
      }
    } catch (e) { msg('网络异常：' + e.message); }
  }

  function logout() {
    token = ''; user = ''; loaded = false;
    localStorage.removeItem('book_token');
    localStorage.removeItem('book_user');
    anns = [];
    clearAnnMarks();
    updateAuthBtn();
    msg('已退出登录');
  }

  // ---------------- 批注数据 ----------------
  async function loadAnns() {
    if (!token || !API) { anns = []; return; }
    try {
      const r = await fetch(API + '/api/annotations', { headers: { 'Authorization': 'Bearer ' + token } });
      const d = await r.json().catch(function () { return {}; });
      anns = (d && d.annotations) || [];
      loaded = true;
    } catch (e) { anns = []; }
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

  // 把一段 Range 包成批注元素（跨节点也会包，且不与已有批注嵌套）
  function wrap(range, ann) {
    const host = $(HOST_ID);
    const nodes = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        let p = n.parentElement;
        while (p && p !== host) {
          if (p.classList && p.classList.contains('ann')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let t;
    while ((t = walker.nextNode())) nodes.push(t);
    if (!nodes.length) return false;

    nodes.forEach(function (node, i) {
      let s = (i === 0) ? range.startOffset : 0;
      let e2 = (i === nodes.length - 1) ? range.endOffset : node.nodeValue.length;
      if (s < 0) s = 0;
      if (e2 > node.nodeValue.length) e2 = node.nodeValue.length;
      if (e2 <= s) return;
      let target = node;
      if (s > 0) target = target.splitText(s);
      if (e2 - s < target.nodeValue.length) target.splitText(e2 - s);
      const el = document.createElement(ann.type === 'underline' ? 'span' : 'mark');
      el.className = 'ann ann-' + ann.type + ' ann-' + (ann.color || 'gold');
      el.setAttribute('data-ann-id', ann.id);
      target.parentNode.insertBefore(el, target);
      el.appendChild(target);
    });
    return true;
  }

  function applyOne(ann) {
    const nodes = collectTextNodes();
    if (!nodes.length) return false;
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
      if (best === -1) return false;
      start = best;
    }
    const end = start + ann.quote.length;
    const s = locate(nodes, start);
    const e = locate(nodes, end);
    if (!s || !e) return false;
    const range = document.createRange();
    try {
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
    } catch (err) { return false; }
    return wrap(range, ann);
  }

  function applyAll() {
    if (!cur) return;
    const list = anns.filter(function (a) { return a.pageGlobal === cur.globalPage; });
    list.forEach(applyOne);
  }

  function clearAnnMarks() {
    const host = $(HOST_ID);
    if (!host) return;
    Array.prototype.slice.call(host.querySelectorAll('.ann')).forEach(function (m) {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
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
      activeRange = sel.getRangeAt(0).cloneRange();
      showBar(activeRange.getBoundingClientRect());
    }, 10);
  });

  function onToolbarClick(e) {
    const act = e.target && e.target.dataset ? e.target.dataset.act : null;
    if (!act) return;
    annBar.classList.add('hidden');
    if (act === 'cancel') return;
    if (!token) { openAuth(); msg('请先登录再标注'); return; }
    const color = (e.target.dataset.color) || 'gold';
    if (act === 'note') createAnn('highlight', 'gold', '').then(function (id) {
      if (id != null) openPop(id);
    });
    else createAnn(act, color, '');
  }

  async function createAnn(type, color, note) {
    if (!activeRange) return null;
    const quote = activeRange.toString();
    if (!quote.trim()) return null;
    if (!API || !token) return null;

    const full = fullText();
    const start = rangeStartIdx(activeRange);
    const body = {
      articleTitle: cur ? cur.articleTitle : '',
      volume: cur ? cur.volume : '',
      pageGlobal: cur ? cur.globalPage : 0,
      quote: quote,
      prefix: full.slice(Math.max(0, start - CTX), start),
      suffix: full.slice(start + quote.length, start + quote.length + CTX),
      startOffset: start,
      type: type,
      color: color,
      note: note || ''
    };
    try {
      const d = await api('POST', '/api/annotations', body);
      if (d && d.annotation) {
        anns.push(d.annotation);
        wrap(activeRange, d.annotation);
        activeId = d.annotation.id;
        return d.annotation.id;
      }
    } catch (err) { /* 静默失败 */ }
    return null;
  }

  function findAnn(id) {
    for (let i = 0; i < anns.length; i++) if (anns[i].id === Number(id)) return anns[i];
    return null;
  }

  function openPop(id) {
    activeId = Number(id);
    const a = findAnn(activeId);
    if (!a) return;
    $('ann-note').value = a.note || '';
    annPop.classList.remove('hidden');
    annPop.style.top = '120px';
    annPop.style.left = Math.max(8, window.innerWidth / 2 - 150) + 'px';
  }

  async function saveNote() {
    if (activeId == null) return;
    const note = $('ann-note').value;
    const d = await api('PATCH', '/api/annotations/' + activeId, { note: note });
    if (d && d.changed) {
      const a = findAnn(activeId);
      if (a) a.note = note;
      annPop.classList.add('hidden');
    }
  }

  async function setColor(color) {
    if (activeId == null) return;
    const d = await api('PATCH', '/api/annotations/' + activeId, { color: color });
    if (d && d.changed) {
      const a = findAnn(activeId);
      if (a) {
        a.color = color;
        // 重绘该批注的颜色
        Array.prototype.slice.call($(HOST_ID).querySelectorAll('.ann[data-ann-id="' + activeId + '"]')).forEach(function (m) {
          m.className = 'ann ann-' + a.type + ' ann-' + color;
        });
      }
    }
  }

  async function deleteActive() {
    if (activeId == null) return;
    const host = $(HOST_ID);
    const d = await api('DELETE', '/api/annotations/' + activeId);
    if (d && d.changed) {
      Array.prototype.slice.call(host.querySelectorAll('.ann[data-ann-id="' + activeId + '"]')).forEach(function (m) {
        const p = m.parentNode;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m);
        p.normalize();
      });
      anns = anns.filter(function (a) { return a.id !== activeId; });
      annPop.classList.add('hidden');
      activeId = null;
    }
  }

  document.addEventListener('click', function (e) {
    if (!annPop) return;
    const target = e.target && e.target.closest ? e.target.closest('.ann') : null;
    if (target && target.getAttribute('data-ann-id')) {
      openPop(target.getAttribute('data-ann-id'));
    } else if (!annPop.contains(e.target) && !annBar.contains(e.target)) {
      // 点空白处收起弹层（点工具条除外）
      if (!annPop.classList.contains('hidden')) annPop.classList.add('hidden');
    }
  });

  // ---------------- 导出 ----------------
  function exportMd() {
    if (!anns.length) { alert('还没有批注可导出'); return; }
    const lines = ['# 我的批注', ''];
    anns.forEach(function (a) {
      lines.push('> ' + String(a.quote).replace(/\n/g, ' '));
      lines.push('>');
      lines.push('> ——《' + (a.articleTitle || '未命名') + '》' + (a.volume ? ' · ' + a.volume : '') + ' · 第 ' + a.pageGlobal + ' 页');
      if (a.note) { lines.push(''); lines.push('**批注**：' + a.note); }
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '批注-' + new Date().toISOString().slice(0, 10) + '.md';
    a.click();
  }

  // ---------------- 页切换 ----------------
  document.addEventListener('book:page', function (e) {
    cur = e.detail;
    if (token && API && !loaded) {
      loadAnns().then(applyAll);
    } else {
      applyAll();
    }
  });

  function init() {
    if (!$(HOST_ID)) { setTimeout(init, 200); return; }
    buildUI();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
