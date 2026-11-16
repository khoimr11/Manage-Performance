/* B2C Team — collaboration: team chat, private chat, work board (projects, approvals, daily check-in), notifications.
 * Storage (encrypted, branch "data" of the repo):
 *   data/chat/team-YYYY-MM.enc.json           team chat, key S (whole team)
 *   data/chat/dm-<a>__<b>-YYYY-MM.enc.json    private chat, key derived by ECDH between the two people only
 *   data/work.enc.json                        work board, key S
 * New activity is detected by polling the latest commit with a conditional request (free when nothing changed).
 */
window.CCX = (() => {
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const vnNow = () => new Date(Date.now() + 7 * 36e5);
const today = () => vnNow().toISOString().slice(0, 10);
const ym = () => vnNow().toISOString().slice(0, 7);
const prevYm = () => { const d = vnNow(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const hhmm = ts => new Date(new Date(ts).getTime() + 7 * 36e5).toISOString().slice(11, 16);
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '–';
const ago = ts => { if (!ts) return '–'; const m = (Date.now() - Date.parse(ts)) / 6e4; return m < 1 ? 'vừa xong' : m < 60 ? Math.round(m) + ' phút trước' : m < 1440 ? Math.round(m / 60) + ' giờ trước' : Math.round(m / 1440) + ' ngày trước'; };
const daysTo = iso => iso ? Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 864e5) : null;

let H = null, root = null;
const X = { team: { msgs: [] }, dms: {}, work: { items: [] }, thread: 'team', wf: { ch: 'all', pic: 'all', q: '', view: 'board', mine: false }, polling: null, lastWorkSeen: null, ready: false };
const store = { get: k => { try { return localStorage.getItem('b2c-' + H.me.id + '-' + k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem('b2c-' + H.me.id + '-' + k, v); } catch (e) {} } };
const person = id => H.team.find(p => p.id === id) || { id, name: id || 'Chưa giao', short: id || 'Chưa giao' };
const initials = id => { const n = person(id).name || id || '?'; const w = n.trim().split(/\s+/); return (w.length > 1 ? w[w.length - 2][0] + w[w.length - 1][0] : n.slice(0, 2)).toUpperCase(); };
const AV_COL = ['#a34a28', '#6e4c8c', '#4f7a3a', '#b0751a', '#2f6f8a'];
const avatar = (id, sz = 28) => `<span class="av" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .38)}px;background:${id ? AV_COL[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_COL.length] : 'var(--muted)'}" title="${esc(person(id).name)}">${id ? esc(initials(id)) : '?'}</span>`;
const isMgr = () => H.me.role === 'manager';
const CH = { team: 'Chung', global: 'Global', local: 'Kệ 3 tầng', nikon: 'Nikon', sabi: 'Sabi Lab' };
const CH_COL = { team: 'var(--muted)', global: 'var(--s1)', local: 'var(--s4)', nikon: '#d9a400', sabi: 'var(--s3)' };
const ST = { todo: 'Cần làm', doing: 'Đang làm', blocked: 'Đang vướng', review: 'Chờ duyệt', done: 'Hoàn thành' };
const PRI = { P0: 'Khẩn', P1: 'Cao', P2: 'Vừa', P3: 'Thấp' };

/* ============================ storage ============================ */
const teamPath = m => `data/chat/team-${m}.enc.json`;
const dmPair = other => [H.me.id, other].sort().join('__');
const dmPath = (other, m) => `data/chat/dm-${dmPair(other)}-${m}.enc.json`;
async function readThread(kind, other) {
  const months = [prevYm(), ym()], out = [];
  for (const m of months) {
    if (H.isDemo) { out.push(...JSON.parse(localStorage.getItem('b2c-demo-' + (kind === 'team' ? 'team-' + m : 'dm-' + dmPair(other) + '-' + m)) || '{"msgs":[]}').msgs); continue; }
    const key = kind === 'team' ? H.keys.S : await H.dmKey(other); if (!key) return null;
    const d = await H.ST.readEnc(kind === 'team' ? teamPath(m) : dmPath(other, m), key, { msgs: [] }); out.push(...(d.msgs || []));
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}
async function sendMsg(kind, other, text) {
  const m = ym(), msg = { id: uid('m'), ts: H.now(), from: H.me.id, text: text.slice(0, 4000) };
  if (H.isDemo) { const k = 'b2c-demo-' + (kind === 'team' ? 'team-' + m : 'dm-' + dmPair(other) + '-' + m), d = JSON.parse(localStorage.getItem(k) || '{"msgs":[]}'); d.msgs.push(msg); localStorage.setItem(k, JSON.stringify(d)); return msg; }
  const key = kind === 'team' ? H.keys.S : await H.dmKey(other); if (!key) throw new Error('Người nhận chưa bật chat riêng (cần đăng nhập lại bản mới một lần)');
  await H.ST.updateEnc(kind === 'team' ? teamPath(m) : dmPath(other, m), key, d => { d.msgs = d.msgs || []; d.msgs.push(msg); if (d.msgs.length > 3000) d.msgs = d.msgs.slice(-3000); return d; }, `chat: ${H.me.id} ${kind === 'team' ? '→ team' : '→ ' + other}`, { msgs: [] });
  return msg;
}
async function readWork() {
  if (H.isDemo) return JSON.parse(localStorage.getItem('b2c-demo-work') || '{"items":[]}');
  return H.ST.readEnc('data/work.enc.json', H.keys.S, { items: [] });
}
/** apply one operation to the freshest copy, so two people editing at once never overwrite each other */
async function workOp(label, fn) {
  const apply = d => { d.items = d.items || []; fn(d); return d; };
  try {
    if (H.isDemo) { const d = apply(JSON.parse(localStorage.getItem('b2c-demo-work') || '{"items":[]}')); localStorage.setItem('b2c-demo-work', JSON.stringify(d)); X.work = d; }
    else X.work = await H.ST.updateEnc('data/work.enc.json', H.keys.S, apply, 'work: ' + H.me.id + ' ' + label, { items: [] });
    X.lastWorkSeen = new Date().toISOString(); store.set('workSeen', X.lastWorkSeen); paint(); return true;
  } catch (e) { H.toast('Lỗi lưu: ' + (e.message || e)); return false; }
}
const logTo = (it, text, extra = {}) => { it.log = it.log || []; it.log.push({ ts: H.now(), by: H.me.id, text, ...extra }); it.updatedAt = H.now(); };
const progress = it => it.steps && it.steps.length ? Math.round(it.steps.filter(s => s.done).length / it.steps.length * 100) : (it.progress || (it.status === 'done' ? 100 : 0));
const nextStep = it => (it.steps || []).find(s => !s.done);
const lastUpdate = it => (it.log || []).filter(l => l.kind === 'update').pop();
function health(it) {
  if (it.status === 'done') return { k: 'done', t: 'Hoàn thành', c: 'good' };
  const d = daysTo(it.due), p = progress(it), lu = lastUpdate(it), silent = (Date.now() - Date.parse((lu && lu.ts) || it.createdAt)) / 36e5;
  if (d != null && d < 0) return { k: 'over', t: `Trễ ${-d} ngày`, c: 'bad' };
  if (it.status === 'blocked') return { k: 'block', t: 'Đang vướng', c: 'bad' };
  if (it.status === 'review') return { k: 'review', t: 'Chờ duyệt', c: 'warn' };
  if (silent > 48 && it.status !== 'todo') return { k: 'silent', t: `Im lặng ${Math.floor(silent / 24)} ngày`, c: 'warn' };
  if (d != null && d <= 3 && p < 70) return { k: 'risk', t: 'Có rủi ro trễ', c: 'warn' };
  return { k: 'ok', t: 'Đúng tiến độ', c: 'good' };
}

/* ============================ templates ============================ */
const TPL = {
  blank: { title: '', ch: 'team', steps: [] },
  sabi: { title: 'Mở tài khoản bán hàng cho pháp nhân mới Sabi Lab', ch: 'sabi', priority: 'P1', desc: 'Bán Nikon trên Nikon Việt Nam khó có giá tốt vì đại lý phản đối → mở pháp nhân mới Sabi Lab để bán với giá cạnh tranh. (Các bước là gợi ý — chỉnh theo thực tế.)',
    steps: ['Chốt mô hình & tên pháp nhân Sabi Lab', 'Đăng ký kinh doanh / mã số thuế', 'Mở tài khoản ngân hàng doanh nghiệp', 'Đăng ký hoá đơn điện tử', 'Thoả thuận nguồn hàng / uỷ quyền phân phối Nikon cho Sabi Lab', 'Tạo tài khoản Shopee Seller cho Sabi Lab', 'Xác minh pháp nhân & liên kết ngân hàng trên Shopee', 'Cài đặt vận chuyển, kho, chính sách giá', 'Đăng sản phẩm & nội dung', 'Go-live & đơn đầu tiên'] },
  mall: { title: 'Đưa shop Nikon Việt Nam lên Shopee Mall', ch: 'nikon', priority: 'P1', desc: 'Theo dõi hồ sơ đăng ký Shopee Mall: đang ở bước nào, vướng ở đâu, Shopee yêu cầu bổ sung gì. (Các bước là gợi ý — chỉnh theo yêu cầu thực tế của Shopee.)',
    steps: ['Kiểm tra điều kiện Mall với Shopee (account manager / Seller Centre)', 'Chuẩn bị giấy phép kinh doanh', 'Chuẩn bị giấy tờ thương hiệu / thư uỷ quyền của Nikon', 'Chuẩn bị chứng từ nguồn gốc hàng hoá', 'Nộp hồ sơ trên Seller Centre', 'Shopee thẩm định / bổ sung hồ sơ', 'Ký thoả thuận Shopee Mall', 'Thiết kế lại gian hàng Mall (banner, decor)', 'Go-live Shopee Mall'] },
  launch: { title: 'Ra mắt sản phẩm mới', ch: 'team', steps: ['Chốt giá & giá sàn', 'Ảnh / video / nội dung', 'Tạo listing', 'Cài khuyến mãi / Flash Sale', 'Chạy Ads tuần đầu', 'Review kết quả sau 7 ngày'] },
  campaign: { title: 'Chuẩn bị campaign (12.12 / Tết)', ch: 'team', steps: ['Chốt mục tiêu doanh số & ngân sách', 'Đăng ký campaign sàn', 'Cài voucher / combo', 'Chuẩn bị tồn kho', 'Lên lịch Ads & livestream', 'Tổng kết sau campaign'] }
};
function newItem(o) {
  return { id: 'W' + Date.now().toString(36).toUpperCase().slice(-5), title: o.title || 'Việc mới', desc: o.desc || '', ch: o.ch || 'team', pic: o.pic || null, priority: o.priority || 'P2', due: o.due || '', status: 'todo',
    steps: (o.steps || []).map(t => ({ id: uid('s'), t, done: false })), createdBy: H.me.id, createdAt: H.now(), updatedAt: H.now(), log: [{ ts: H.now(), by: H.me.id, text: 'Tạo việc' }], approval: o.approval || null, kind: o.kind || 'task' };
}

/* ============================ notifications ============================ */
function notify(title, body, tab) {
  H.toast(title + (body ? ' — ' + body.slice(0, 80) : ''));
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const opt = { body, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: 'b2c-' + (tab || 'x'), renotify: true };
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, opt)); else new Notification(title, opt);
    }
  } catch (e) {}
}
function unreadOf(thread, msgs) { const last = store.get('read-' + thread) || ''; return (msgs || []).filter(m => m.from !== H.me.id && m.ts > last).length; }
function chatUnread() { let n = unreadOf('team', X.team.msgs); for (const [o, t] of Object.entries(X.dms)) n += unreadOf('dm-' + o, t.msgs); return n; }
function myWorkBadge() {
  const it = X.work.items || [];
  if (isMgr()) return it.filter(i => i.status === 'review' || (i.approval && i.approval.state === 'pending')).length;
  return it.filter(i => i.pic === H.me.id && i.status !== 'done' && (!lastUpdate(i) || lastUpdate(i).ts.slice(0, 10) < today())).length;
}
function diffNotify(oldMsgs, newMsgs, thread, label) {
  const seen = new Set((oldMsgs || []).map(m => m.id));
  for (const m of newMsgs) if (!seen.has(m.id) && m.from !== H.me.id && X.ready) {
    const mention = new RegExp('@(' + [H.me.id, H.me.username, (H.me.name || '').split(' ').pop()].filter(Boolean).join('|') + ')', 'i').test(m.text);
    if (H.tab() !== 'chat' || X.thread !== thread || document.hidden) notify((mention ? '🔔 ' : '') + person(m.from).short + (label ? ' · ' + label : ''), m.text, 'chat');
  }
}
function workNotify(oldW, newW) {
  if (!X.ready) return; const om = new Map((oldW.items || []).map(i => [i.id, i]));
  for (const it of newW.items || []) {
    const o = om.get(it.id), newLogs = (it.log || []).filter(l => l.by !== H.me.id && (!o || !(o.log || []).some(x => x.ts === l.ts && x.by === l.by)));
    for (const l of newLogs) {
      const mine = it.pic === H.me.id || it.createdBy === H.me.id || isMgr();
      if (!mine) continue;
      if (l.kind === 'assign' && it.pic === H.me.id) notify('📌 Việc mới giao cho bạn', it.title, 'work');
      else if (l.kind === 'approval' && isMgr()) notify('🟡 Cần duyệt: ' + it.title, person(l.by).short + ': ' + (l.text || ''), 'work');
      else if (l.kind === 'decision' && it.pic === H.me.id) notify(l.ok ? '✅ Đã duyệt' : '↩ Chưa duyệt', it.title + (l.note ? ' — ' + l.note : ''), 'work');
      else if (l.kind === 'update') notify('↻ ' + person(l.by).short + ' cập nhật', it.title + ': ' + (l.text || ''), 'work');
      else if (l.kind === 'blocked' && isMgr()) notify('⛔ Đang vướng: ' + it.title, l.text || '', 'work');
    }
  }
}
async function refresh(all) {
  try {
    const oldTeam = X.team.msgs, oldWork = X.work;
    const t = await readThread('team'); if (t) { diffNotify(oldTeam, t, 'team', 'Cả team'); X.team.msgs = t; }
    for (const p of H.team.filter(p => p.id !== H.me.id)) {
      const old = (X.dms[p.id] || {}).msgs || [];
      const msgs = await readThread('dm', p.id).catch(() => null);
      X.dms[p.id] = { msgs: msgs || [], locked: msgs == null };
      if (msgs) diffNotify(old, msgs, 'dm-' + p.id, 'nhắn riêng');
    }
    const w = await readWork(); workNotify(oldWork, w); X.work = w;
  } catch (e) { /* offline or token missing: keep last state */ }
  H.onBadge({ chat: chatUnread(), work: myWorkBadge() });
  if (root) paint(true);
}
function startPolling() {
  clearInterval(X.polling);
  X.polling = setInterval(async () => {
    if (H.isDemo) return;
    const p = await H.ST.poll();
    if (p.changed) refresh();
  }, document.hidden ? 30000 : 12000);
  document.addEventListener('visibilitychange', () => startPolling(), { once: true });
}

/* ============================ rendering ============================ */
function paint(keep) {
  if (!root) return;
  if (root.dataset.view === 'chat') return paintChat(keep);
  if (root.dataset.view === 'work') return paintWork(keep);
}
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/@([\p{L}\d_.]+)/gu, '<b class="mention">@$1</b>').replace(/#(W[0-9A-Z]{3,6})\b/g, '<a href="#" data-openw="$1" class="wlink">#$1</a>').replace(/\n/g, '<br>');

function paintChat(keep) {
  const others = H.team.filter(p => p.id !== H.me.id);
  const threads = [{ id: 'team', label: '# Cả team B2C', sub: `${H.team.length} thành viên`, msgs: X.team.msgs }, ...others.map(p => ({ id: 'dm-' + p.id, label: p.name, sub: p.role === 'manager' ? 'Quản lý' : (p.channel === 'global' ? 'Global' : 'Local · Nikon'), msgs: (X.dms[p.id] || {}).msgs || [], who: p.id, locked: (X.dms[p.id] || {}).locked }))];
  const cur = threads.find(t => t.id === X.thread) || threads[0];
  store.set('read-' + cur.id, (cur.msgs[cur.msgs.length - 1] || {}).ts || store.get('read-' + cur.id) || '');
  H.onBadge({ chat: chatUnread(), work: myWorkBadge() });
  const list = root.querySelector('.cx-msgs'), atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80, draft = root.querySelector('#cxIn') ? root.querySelector('#cxIn').value : '';
  let lastDay = '', lastFrom = '';
  const msgsHtml = cur.msgs.map(m => {
    const day = new Date(new Date(m.ts).getTime() + 7 * 36e5).toISOString().slice(0, 10), mine = m.from === H.me.id, cont = day === lastDay && lastFrom === m.from;
    const sep = day !== lastDay ? `<div class="cx-day"><span>${day === today() ? 'Hôm nay' : dmy(day) + '/' + day.slice(0, 4)}</span></div>` : '';
    lastDay = day; lastFrom = m.from;
    return `${sep}<div class="cx-m ${mine ? 'me' : ''} ${cont && !sep ? 'cont' : ''}">${!mine && (!cont || sep) ? avatar(m.from, 30) : '<span class="av-sp"></span>'}<div class="cx-b">${!mine && (!cont || sep) ? `<div class="cx-n">${esc(person(m.from).short)}</div>` : ''}<div class="cx-t">${linkify(m.text)}</div><div class="cx-ts">${hhmm(m.ts)}</div></div></div>`;
  }).join('');
  root.innerHTML = `<div class="cx glass">
    <aside class="cx-side"><div class="cx-sh">Tin nhắn ${('Notification' in window) && Notification.permission !== 'granted' ? '<button class="btn ghost cx-bell" id="cxBell" title="Bật thông báo trên máy">🔔 Bật thông báo</button>' : ''}</div>
      ${threads.map(t => { const u = unreadOf(t.id, t.msgs), last = t.msgs[t.msgs.length - 1]; return `<button class="cx-th" data-th="${t.id}" aria-pressed="${t.id === cur.id}">${t.who ? avatar(t.who, 36) : '<span class="av team" style="width:36px;height:36px">#</span>'}<span class="cx-thb"><b>${esc(t.label)}</b><small>${last ? esc((last.from === H.me.id ? 'Bạn: ' : person(last.from).short + ': ') + last.text.slice(0, 40)) : esc(t.sub)}</small></span>${u ? `<i class="cx-u">${u}</i>` : ''}</button>`; }).join('')}
    </aside>
    <section class="cx-main"><header class="cx-hd">${cur.who ? avatar(cur.who, 34) : '<span class="av team" style="width:34px;height:34px">#</span>'}<div><b>${esc(cur.label)}</b><small>${cur.who ? 'Chat riêng · mã hoá đầu-cuối, chỉ 2 người đọc được' : 'Kênh chung của team · gõ @tên để nhắc, #W… để gắn việc'}</small></div></header>
      <div class="cx-msgs">${cur.locked ? `<div class="empty2">Chưa mở được chat riêng với ${esc(person(cur.who).short)}: cần cả hai người đăng nhập lại bản mới một lần (bật khoá chat riêng).</div>` : msgsHtml || '<div class="empty2">Chưa có tin nhắn. Bắt đầu cuộc trò chuyện 👋</div>'}</div>
      <form class="cx-in" id="cxForm"><textarea id="cxIn" rows="1" placeholder="${cur.who ? 'Nhắn riêng cho ' + esc(person(cur.who).short) : 'Nhắn cho cả team'}… (Enter để gửi, Shift+Enter xuống dòng)" ${cur.locked || !H.canWrite() ? 'disabled' : ''}></textarea><button class="btn pri" ${cur.locked || !H.canWrite() ? 'disabled' : ''}>Gửi</button></form>
    </section></div>`;
  const nl = root.querySelector('.cx-msgs'); if (atBottom || !keep) nl.scrollTop = nl.scrollHeight;
  const ta = root.querySelector('#cxIn'); ta.value = draft;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }; grow();
  if (!keep) setTimeout(() => ta.focus(), 30);
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); root.querySelector('#cxForm').requestSubmit(); } });
  root.querySelector('#cxForm').onsubmit = async e => {
    e.preventDefault(); const t = ta.value.trim(); if (!t) return; ta.value = ''; grow();
    const kind = cur.id === 'team' ? 'team' : 'dm', other = cur.who;
    const tmp = { id: 'tmp', ts: new Date().toISOString(), from: H.me.id, text: t }; cur.msgs.push(tmp); paintChat(true);
    try { const m = await sendMsg(kind, other, t); const arr = kind === 'team' ? X.team.msgs : X.dms[other].msgs; const i = arr.indexOf(tmp); if (i >= 0) arr[i] = m; store.set('read-' + cur.id, m.ts); }
    catch (er) { H.toast(er.message || 'Không gửi được'); const arr = kind === 'team' ? X.team.msgs : X.dms[other].msgs; arr.splice(arr.indexOf(tmp), 1); ta.value = t; }
    paintChat(true);
  };
  root.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { X.thread = b.dataset.th; paintChat(); });
  const bell = root.querySelector('#cxBell'); if (bell) bell.onclick = () => Notification.requestPermission().then(() => paintChat(true));
  root.querySelectorAll('[data-openw]').forEach(a => a.onclick = e => { e.preventDefault(); H.goto('work'); setTimeout(() => openItem(a.dataset.openw), 50); });
}

/* ---------------- work board ---------------- */
function filtered() {
  const f = X.wf, q = f.q.trim().toLowerCase();
  return (X.work.items || []).filter(it => (f.ch === 'all' || it.ch === f.ch) && (f.pic === 'all' || (f.pic === 'none' ? !it.pic : it.pic === f.pic)) && (!f.mine || it.pic === H.me.id || it.createdBy === H.me.id) && (!q || (it.title + ' ' + it.desc + ' ' + (it.steps || []).map(s => s.t).join(' ')).toLowerCase().includes(q)));
}
function cardHtml(it) {
  const p = progress(it), h = health(it), ns = nextStep(it), lu = lastUpdate(it), d = daysTo(it.due);
  return `<article class="wk-card ${h.k}" data-open="${esc(it.id)}" draggable="${canEdit(it)}" data-id="${esc(it.id)}">
    <div class="wk-top"><span class="wk-ch" style="--c:${CH_COL[it.ch] || 'var(--muted)'}">${esc(CH[it.ch] || it.ch)}</span><span class="wk-pri ${it.priority}">${PRI[it.priority] || ''}</span><span class="wk-id">${esc(it.id)}</span></div>
    <h4>${esc(it.title)}</h4>
    ${it.status === 'blocked' && it.blocker ? `<div class="wk-block">⛔ ${esc(it.blocker)}</div>` : ''}
    ${ns && it.status !== 'done' ? `<div class="wk-next">→ Bước tiếp: ${esc(ns.t)}</div>` : ''}
    <div class="wk-prog"><i style="width:${p}%"></i></div>
    <div class="wk-meta">${avatar(it.pic, 22)}<span>${esc(it.pic ? person(it.pic).short : 'Chưa giao')}</span><span class="dot">·</span><span>${it.steps && it.steps.length ? it.steps.filter(s => s.done).length + '/' + it.steps.length + ' bước' : p + '%'}</span>${it.due ? `<span class="dot">·</span><span class="${d != null && d < 0 && it.status !== 'done' ? 'bad' : ''}">hạn ${dmy(it.due)}</span>` : ''}</div>
    <div class="wk-foot"><span class="tag ${h.c}">${h.t}</span><span class="sub">${lu ? '↻ ' + ago(lu.ts) : 'chưa cập nhật'}</span></div></article>`;
}
const canEdit = it => isMgr() || it.pic === H.me.id || it.createdBy === H.me.id;
function paintWork(keep) {
  const items = X.work.items || [], f = X.wf, mgr = isMgr(), list = filtered();
  const act = items.filter(i => i.status !== 'done');
  const chips = [
    ['review', 'Cần duyệt', act.filter(i => i.status === 'review').length, 'warn'],
    ['blocked', 'Đang vướng', act.filter(i => i.status === 'blocked').length, 'bad'],
    ['over', 'Quá hạn', act.filter(i => health(i).k === 'over').length, 'bad'],
    ['silent', 'Im lặng > 2 ngày', act.filter(i => health(i).k === 'silent').length, 'warn'],
    ['none', 'Chưa giao', act.filter(i => !i.pic).length, ''],
    ['done7', 'Xong 7 ngày qua', items.filter(i => i.status === 'done' && i.doneAt && Date.now() - Date.parse(i.doneAt) < 7 * 864e5).length, 'good']];
  const cols = ['todo', 'doing', 'blocked', 'review', 'done'];
  const smart = smartLines(items);
  root.innerHTML = `<div class="page-head"><div><h1>Công việc</h1><p>Giao việc, theo dõi tiến độ từng bước, PIC tự cập nhật & đẩy việc cần duyệt · lưu mã hoá, ai sửa gì đều có nhật ký</p></div>
    <div class="fresh"><button class="btn" id="wkDaily">${mgr ? '☀ Tóm tắt hôm nay' : '☀ Cập nhật hôm nay'}</button><button class="btn pri" id="wkNew" ${H.canWrite() ? '' : 'disabled'}>+ ${mgr ? 'Giao việc / dự án' : 'Thêm việc / đề xuất cần duyệt'}</button></div></div>
  ${smart.length ? `<section class="card glass wk-smart"><h3>Điểm cần chú ý</h3><ul>${smart.map(x => `<li>${x}</li>`).join('')}</ul></section>` : ''}
  <div class="wk-chips">${chips.map(([k, l, n, c]) => `<button class="wk-chip ${c}" data-quick="${k}"><b>${n}</b><span>${l}</span></button>`).join('')}</div>
  <div class="toolbar wk-tools">
    <div class="seg" data-wf="ch">${[['all', 'Tất cả'], ...Object.entries(CH)].map(([k, l]) => `<button data-v="${k}" aria-pressed="${f.ch === k}">${l}</button>`).join('')}</div>
    <select class="ss" id="wkPic"><option value="all">Mọi PIC</option>${H.team.map(p => `<option value="${p.id}" ${f.pic === p.id ? 'selected' : ''}>${esc(p.short)}</option>`).join('')}<option value="none" ${f.pic === 'none' ? 'selected' : ''}>Chưa giao</option></select>
    <button class="chip" id="wkMine" aria-pressed="${f.mine}">Việc của tôi</button>
    <input class="sf" id="wkQ" placeholder="Tìm việc…" value="${esc(f.q)}">
    <div class="seg" data-wf="view" style="margin-left:auto"><button data-v="board" aria-pressed="${f.view === 'board'}">Bảng</button><button data-v="list" aria-pressed="${f.view === 'list'}">Danh sách</button><button data-v="time" aria-pressed="${f.view === 'time'}">Timeline</button></div>
  </div>
  ${f.view === 'board' ? `<div class="wk-board">${cols.map(c => { const l = list.filter(i => i.status === c).sort((a, b) => (a.priority || 'P2').localeCompare(b.priority || 'P2') || String(a.due || '9').localeCompare(String(b.due || '9'))); return `<div class="wk-col glass" data-drop="${c}"><h3><span>${ST[c]}</span><span>${l.length}</span></h3>${l.map(cardHtml).join('') || '<div class="empty2" style="padding:14px">—</div>'}</div>`; }).join('')}</div>`
  : f.view === 'list' ? `<section class="card glass"><div class="tw"><table class="t wk-tbl"><tr><th>Việc</th><th>Kênh</th><th>PIC</th><th>Trạng thái</th><th class="r">Tiến độ</th><th>Hạn</th><th>Cập nhật</th></tr>${list.sort((a, b) => cols.indexOf(a.status) - cols.indexOf(b.status)).map(it => { const h = health(it), lu = lastUpdate(it); return `<tr data-open="${esc(it.id)}" style="cursor:pointer"><td><b>${esc(it.title)}</b>${nextStep(it) && it.status !== 'done' ? `<br><span class="sub">→ ${esc(nextStep(it).t)}</span>` : ''}</td><td>${esc(CH[it.ch] || '')}</td><td>${esc(it.pic ? person(it.pic).short : 'Chưa giao')}</td><td><span class="tag ${h.c}">${ST[it.status]}</span></td><td class="r">${progress(it)}%</td><td>${it.due ? dmy(it.due) : '–'}</td><td class="sub">${lu ? ago(lu.ts) : '–'}</td></tr>`; }).join('')}</table></div></section>`
  : timeline(list)}`;
  bindWork();
}
function smartLines(items) {
  const out = [], act = items.filter(i => i.status !== 'done');
  for (const i of act.filter(i => i.status === 'blocked')) out.push(`⛔ <b>${esc(i.title)}</b> đang vướng: ${esc(i.blocker || 'chưa ghi lý do')} · ${esc(i.pic ? person(i.pic).short : 'chưa giao')} <a href="#" data-openw="${i.id}">mở</a>`);
  for (const i of act.filter(i => i.status === 'review')) out.push(`🟡 <b>${esc(i.title)}</b> chờ ${isMgr() ? 'bạn' : 'quản lý'} duyệt${i.approval && i.approval.note ? ': ' + esc(i.approval.note) : ''} <a href="#" data-openw="${i.id}">mở</a>`);
  for (const i of act.filter(i => health(i).k === 'over')) out.push(`⏰ <b>${esc(i.title)}</b> trễ hạn ${-daysTo(i.due)} ngày, tiến độ ${progress(i)}% <a href="#" data-openw="${i.id}">mở</a>`);
  for (const i of act.filter(i => health(i).k === 'silent')) out.push(`🔕 <b>${esc(i.title)}</b>: ${esc(person(i.pic).short)} chưa cập nhật ${health(i).t.replace('Im lặng ', '')} <a href="#" data-openw="${i.id}">mở</a>`);
  for (const i of act.filter(i => !i.pic)) out.push(`👤 <b>${esc(i.title)}</b> chưa có PIC <a href="#" data-openw="${i.id}">giao</a>`);
  return out.slice(0, 8);
}
function timeline(list) {
  const withDue = list.filter(i => i.due).sort((a, b) => a.due.localeCompare(b.due)); if (!withDue.length) return '<section class="card glass"><div class="empty2">Chưa có việc nào đặt hạn</div></section>';
  const start = [today(), ...withDue.map(i => (i.createdAt || '').slice(0, 10))].sort()[0], end = withDue[withDue.length - 1].due > today() ? withDue[withDue.length - 1].due : today();
  const span = Math.max(7, (Date.parse(end) - Date.parse(start)) / 864e5 + 3), x = iso => Math.max(0, (Date.parse(iso) - Date.parse(start)) / 864e5 / span * 100);
  return `<section class="card glass"><div class="tl"><div class="tl-now" style="left:${x(today())}%"><span>Hôm nay</span></div>${withDue.map(i => { const a = x((i.createdAt || today()).slice(0, 10)), b = x(i.due), p = progress(i), h = health(i); return `<div class="tl-row" data-open="${esc(i.id)}"><span class="tl-l">${esc(i.title)}</span><div class="tl-t"><div class="tl-bar ${h.c}" style="left:${a}%;width:${Math.max(2, b - a)}%"><i style="width:${p}%"></i></div></div><span class="tl-d">${dmy(i.due)}</span></div>`; }).join('')}</div></section>`;
}
function bindWork() {
  root.querySelector('#wkNew').onclick = () => editModal(null);
  root.querySelector('#wkDaily').onclick = () => daily(true);
  root.querySelectorAll('[data-wf] button').forEach(b => b.onclick = () => { X.wf[b.closest('[data-wf]').dataset.wf] = b.dataset.v; paintWork(); });
  root.querySelector('#wkPic').onchange = e => { X.wf.pic = e.target.value; paintWork(); };
  root.querySelector('#wkMine').onclick = () => { X.wf.mine = !X.wf.mine; paintWork(); };
  const q = root.querySelector('#wkQ'); q.oninput = () => { X.wf.q = q.value; const pos = q.selectionStart; paintWork(); const n = root.querySelector('#wkQ'); n.focus(); n.setSelectionRange(pos, pos); };
  root.querySelectorAll('[data-open]').forEach(el => el.onclick = e => { if (e.target.closest('a')) return; openItem(el.dataset.open); });
  root.querySelectorAll('[data-openw]').forEach(a => a.onclick = e => { e.preventDefault(); openItem(a.dataset.openw); });
  root.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => { const k = b.dataset.quick; X.wf.view = 'list'; X.wf.q = ''; if (k === 'none') X.wf.pic = 'none'; paintWork(); const map = { review: 'review', blocked: 'blocked' }; if (map[k]) { X.wf.view = 'board'; paintWork(); root.querySelector(`[data-drop="${map[k]}"]`).scrollIntoView({ behavior: 'smooth', inline: 'center' }); } });
  // drag & drop between columns
  root.querySelectorAll('.wk-card[draggable="true"]').forEach(c => c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('drag'); }));
  root.querySelectorAll('[data-drop]').forEach(col => { col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); }); col.addEventListener('dragleave', () => col.classList.remove('over')); col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); setStatus(id, col.dataset.drop); }); });
}
function setStatus(id, st) {
  const it = (X.work.items || []).find(i => i.id === id); if (!it || it.status === st || !canEdit(it)) return;
  if (st === 'done' && !isMgr() && it.approval && it.approval.required) { H.toast('Việc này cần quản lý duyệt — gửi "Đề xuất duyệt" trong chi tiết'); return; }
  if (st === 'blocked') { const r = prompt('Đang vướng ở đâu?'); if (r == null) return; return workOp('vướng ' + id, d => { const x = d.items.find(i => i.id === id); x.status = 'blocked'; x.blocker = r; logTo(x, 'Đang vướng: ' + r, { kind: 'blocked' }); }); }
  if (st === 'review') return approvalModal(it);
  workOp(st + ' ' + id, d => { const x = d.items.find(i => i.id === id); x.status = st; if (st === 'done') { x.doneAt = H.now(); (x.steps || []).forEach(s => { if (!s.done) { s.done = true; s.doneAt = H.now(); s.by = H.me.id; } }); } if (st !== 'blocked') x.blocker = ''; logTo(x, 'Chuyển sang ' + ST[st], { kind: 'status' }); });
}

/* ---------------- item detail ---------------- */
function openItem(id) {
  const it = (X.work.items || []).find(i => i.id === id); if (!it) return H.toast('Không tìm thấy việc ' + id);
  const ed = canEdit(it), mgr = isMgr(), p = progress(it), h = health(it);
  H.modal(`<div class="wk-detail">
    <div class="wk-top"><span class="wk-ch" style="--c:${CH_COL[it.ch]}">${esc(CH[it.ch] || it.ch)}</span><span class="wk-id">${esc(it.id)}</span><span class="tag ${h.c}">${h.t}</span></div>
    <h3 ${ed ? 'contenteditable="true" spellcheck="false"' : ''} id="wdTitle">${esc(it.title)}</h3>
    <div class="wd-grid">
      <label>PIC<select id="wdPic" ${mgr || it.createdBy === H.me.id ? '' : 'disabled'}><option value="">Chưa giao</option>${H.team.map(x => `<option value="${x.id}" ${it.pic === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label>Kênh<select id="wdCh" ${ed ? '' : 'disabled'}>${Object.entries(CH).map(([k, l]) => `<option value="${k}" ${it.ch === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Hạn<input type="date" id="wdDue" value="${esc(it.due || '')}" ${ed ? '' : 'disabled'}></label>
      <label>Ưu tiên<select id="wdPri" ${ed ? '' : 'disabled'}>${Object.entries(PRI).map(([k, l]) => `<option value="${k}" ${it.priority === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Trạng thái<select id="wdSt" ${ed ? '' : 'disabled'}>${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${it.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="wd-ap"><input type="checkbox" id="wdReq" ${it.approval && it.approval.required ? 'checked' : ''} ${mgr ? '' : 'disabled'}> Phải được quản lý duyệt mới xong</label>
    </div>
    <label>Mô tả / bối cảnh<textarea id="wdDesc" ${ed ? '' : 'readonly'} rows="3">${esc(it.desc || '')}</textarea></label>
    ${it.status === 'blocked' || it.blocker ? `<label>Đang vướng<input id="wdBlock" value="${esc(it.blocker || '')}" ${ed ? '' : 'readonly'}></label>` : ''}
    <div class="wd-steps"><div class="wd-sh"><b>Các bước</b><span>${p}% · ${(it.steps || []).filter(s => s.done).length}/${(it.steps || []).length}</span></div><div class="wk-prog big"><i style="width:${p}%"></i></div>
      ${(it.steps || []).map(s => `<div class="wd-step ${s.done ? 'done' : ''}"><input type="checkbox" data-step="${s.id}" ${s.done ? 'checked' : ''} ${ed ? '' : 'disabled'}><span>${esc(s.t)}</span>${s.done && s.doneAt ? `<small>${esc(person(s.by).short)} · ${dmy(new Date(Date.parse(s.doneAt) + 7 * 36e5).toISOString().slice(0, 10))}</small>` : ''}${ed ? `<button class="x" data-delstep="${s.id}" title="Xoá bước">×</button>` : ''}</div>`).join('')}
      ${ed ? `<form class="wd-add" id="wdAdd"><input id="wdStep" placeholder="+ Thêm bước"><button class="btn ghost">Thêm</button></form>` : ''}</div>
    ${it.approval && it.approval.state === 'pending' ? `<div class="wd-approval"><b>🟡 Đang chờ duyệt</b><p>${esc(person(it.approval.by).short)}: ${esc(it.approval.note || '')}</p>${mgr ? `<div class="foot" style="justify-content:flex-start"><button class="btn pri" id="wdOk">Duyệt</button><button class="btn danger" id="wdNo">Chưa duyệt / yêu cầu sửa</button></div>` : ''}</div>` : ''}
    <div class="wd-upd"><b>Cập nhật tiến độ</b>${ed || mgr ? `<form id="wdU"><textarea id="wdUText" rows="2" placeholder="${mgr && it.pic !== H.me.id ? 'Nhận xét / chỉ đạo…' : 'Hôm nay đã làm gì, kết quả, vướng gì…'}"></textarea><div class="wd-ua"><label><input type="checkbox" id="wdUBlock"> Đang vướng</label>${ed && !mgr ? '<button type="button" class="btn ghost" id="wdAsk">Đề xuất duyệt</button>' : ''}<button class="btn pri">Gửi cập nhật</button></div></form>` : ''}
      <ol class="wd-log">${[...(it.log || [])].reverse().map(l => `<li>${avatar(l.by, 22)}<div><b>${esc(person(l.by).short)}</b> <span class="sub">${ago(l.ts)}</span><br>${linkify(l.text || '')}</div></li>`).join('')}</ol></div>
    <div class="foot">${mgr ? '<button class="btn danger" id="wdDel">Xoá</button>' : ''}<button class="btn ghost" data-close>Đóng</button>${ed ? '<button class="btn pri" id="wdSave">Lưu thay đổi</button>' : ''}</div></div>`, m => {
    const q = s => m.querySelector(s);
    m.querySelector('.box').classList.add('wide');
    if (q('#wdSave')) q('#wdSave').onclick = () => {
      const f = { title: q('#wdTitle').textContent.trim() || it.title, pic: q('#wdPic').value || null, ch: q('#wdCh').value, due: q('#wdDue').value, priority: q('#wdPri').value, status: q('#wdSt').value, desc: q('#wdDesc').value, blocker: q('#wdBlock') ? q('#wdBlock').value : it.blocker, req: q('#wdReq').checked };
      H.closeModal();
      workOp('sửa ' + it.id, d => { const x = d.items.find(i => i.id === it.id); if (!x) return; const ch = [];
        if (f.pic !== x.pic) { ch.push('giao cho ' + (f.pic ? person(f.pic).short : 'chưa giao')); x.pic = f.pic; logTo(x, 'Giao việc cho ' + (f.pic ? person(f.pic).name : '—'), { kind: 'assign' }); }
        for (const k of ['title', 'ch', 'due', 'priority', 'desc']) if (f[k] !== x[k]) { ch.push(k === 'due' ? 'hạn ' + dmy(f.due) : k === 'priority' ? 'ưu tiên ' + PRI[f.priority] : k === 'ch' ? 'kênh ' + CH[f.ch] : k === 'title' ? 'tên' : 'mô tả'); x[k] = f[k]; }
        if (f.status !== x.status) { ch.push(ST[f.status]); x.status = f.status; if (f.status === 'done') x.doneAt = H.now(); }
        if ((f.blocker || '') !== (x.blocker || '')) { x.blocker = f.blocker; if (f.blocker) logTo(x, 'Đang vướng: ' + f.blocker, { kind: 'blocked' }); }
        if (isMgr()) x.approval = { ...(x.approval || {}), required: f.req };
        if (ch.length) logTo(x, 'Cập nhật: ' + ch.join(', '), { kind: 'edit' }); });
    };
    m.querySelectorAll('[data-step]').forEach(c => c.onchange = () => workOp('bước ' + it.id, d => { const x = d.items.find(i => i.id === it.id), s = x.steps.find(s => s.id === c.dataset.step); s.done = c.checked; s.doneAt = c.checked ? H.now() : null; s.by = H.me.id; logTo(x, (c.checked ? '✓ Xong bước: ' : '↺ Mở lại bước: ') + s.t, { kind: 'update' }); if (x.status === 'todo' && c.checked) x.status = 'doing'; }).then(() => openItem(it.id)));
    m.querySelectorAll('[data-delstep]').forEach(b => b.onclick = () => workOp('xoá bước ' + it.id, d => { const x = d.items.find(i => i.id === it.id); const s = x.steps.find(s => s.id === b.dataset.delstep); x.steps = x.steps.filter(z => z !== s); logTo(x, 'Xoá bước: ' + (s && s.t), { kind: 'edit' }); }).then(() => openItem(it.id)));
    if (q('#wdAdd')) q('#wdAdd').onsubmit = e => { e.preventDefault(); const t = q('#wdStep').value.trim(); if (!t) return; workOp('thêm bước ' + it.id, d => { const x = d.items.find(i => i.id === it.id); x.steps = x.steps || []; x.steps.push({ id: uid('s'), t, done: false }); logTo(x, 'Thêm bước: ' + t, { kind: 'edit' }); }).then(() => openItem(it.id)); };
    if (q('#wdU')) q('#wdU').onsubmit = e => { e.preventDefault(); const t = q('#wdUText').value.trim(), bl = q('#wdUBlock').checked; if (!t) return H.toast('Nhập nội dung cập nhật'); workOp('cập nhật ' + it.id, d => { const x = d.items.find(i => i.id === it.id); if (bl) { x.status = 'blocked'; x.blocker = t; logTo(x, 'Đang vướng: ' + t, { kind: 'blocked' }); } else { if (x.status === 'todo' || x.status === 'blocked') { x.status = 'doing'; x.blocker = ''; } logTo(x, t, { kind: 'update' }); } }).then(() => openItem(it.id)); };
    if (q('#wdAsk')) q('#wdAsk').onclick = () => { H.closeModal(); approvalModal(it); };
    if (q('#wdOk')) q('#wdOk').onclick = () => decide(it, true);
    if (q('#wdNo')) q('#wdNo').onclick = () => decide(it, false);
    if (q('#wdDel')) q('#wdDel').onclick = () => { if (!confirm('Xoá việc "' + it.title + '"? (vẫn còn trong lịch sử repo)')) return; H.closeModal(); workOp('xoá ' + it.id, d => { d.items = d.items.filter(i => i.id !== it.id); }); };
  });
}
function approvalModal(it) {
  H.modal(`<h3>Đề xuất quản lý duyệt</h3><p class="sub">${esc(it.title)}</p><label>Cần duyệt nội dung gì? (giá, ngân sách, hồ sơ, kết quả…)<textarea id="apN" rows="3"></textarea></label><div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="apGo">Gửi duyệt</button></div>`, m => {
    m.querySelector('#apGo').onclick = () => { const n = m.querySelector('#apN').value.trim(); if (!n) return H.toast('Ghi rõ nội dung cần duyệt'); H.closeModal(); workOp('đề xuất duyệt ' + it.id, d => { const x = d.items.find(i => i.id === it.id); x.status = 'review'; x.approval = { ...(x.approval || {}), state: 'pending', by: H.me.id, at: H.now(), note: n }; logTo(x, 'Đề xuất duyệt: ' + n, { kind: 'approval' }); }); };
  });
}
function decide(it, ok) {
  const note = ok ? (prompt('Ghi chú khi duyệt (không bắt buộc):') || '') : prompt('Lý do chưa duyệt / cần sửa gì?'); if (!ok && !note) return;
  H.closeModal();
  workOp((ok ? 'duyệt ' : 'không duyệt ') + it.id, d => { const x = d.items.find(i => i.id === it.id); x.approval = { ...(x.approval || {}), state: ok ? 'approved' : 'rejected', decidedBy: H.me.id, decidedAt: H.now(), decision: note }; x.status = ok ? (x.steps && x.steps.some(s => !s.done) ? 'doing' : 'done') : 'doing'; if (x.status === 'done') x.doneAt = H.now(); logTo(x, (ok ? '✅ Đã duyệt' : '↩ Chưa duyệt') + (note ? ': ' + note : ''), { kind: 'decision', ok, note }); });
}
function editModal() {
  const mgr = isMgr();
  H.modal(`<h3>${mgr ? 'Giao việc / tạo dự án' : 'Thêm việc hoặc đề xuất cần duyệt'}</h3>
    <label>Bắt đầu từ mẫu<select id="nwT"><option value="blank">Trống</option><option value="sabi">Mở account pháp nhân mới Sabi Lab</option><option value="mall">Đưa Nikon Việt Nam lên Shopee Mall</option><option value="launch">Ra mắt sản phẩm mới</option><option value="campaign">Chuẩn bị campaign</option></select></label>
    <label>Tên việc<input id="nwTitle" placeholder="Ví dụ: Submit hồ sơ Shopee Mall"></label>
    <div class="wd-grid"><label>PIC<select id="nwPic"><option value="">Chưa giao</option>${H.team.map(x => `<option value="${x.id}" ${!mgr && x.id === H.me.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label>Kênh<select id="nwCh">${Object.entries(CH).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label>Hạn<input type="date" id="nwDue"></label><label>Ưu tiên<select id="nwPri">${Object.entries(PRI).map(([k, l]) => `<option value="${k}" ${k === 'P2' ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label>Mô tả<textarea id="nwDesc" rows="3"></textarea></label>
    <label>Các bước (mỗi dòng một bước — tiến độ tự tính theo bước đã xong)<textarea id="nwSteps" rows="5"></textarea></label>
    ${mgr ? '<label class="wd-ap"><input type="checkbox" id="nwReq"> Phải được tôi duyệt mới tính là xong</label>' : '<label class="wd-ap"><input type="checkbox" id="nwAsk"> Đây là việc cần quản lý duyệt (gửi duyệt ngay)</label><label id="nwNoteL" hidden>Cần duyệt nội dung gì?<textarea id="nwNote" rows="2"></textarea></label>'}
    <div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="nwGo">Tạo</button></div>`, m => {
    const q = s => m.querySelector(s);
    q('#nwT').onchange = () => { const t = TPL[q('#nwT').value]; q('#nwTitle').value = t.title; q('#nwCh').value = t.ch; q('#nwDesc').value = t.desc || ''; q('#nwSteps').value = (t.steps || []).join('\n'); if (t.priority) q('#nwPri').value = t.priority; };
    if (q('#nwAsk')) q('#nwAsk').onchange = () => { q('#nwNoteL').hidden = !q('#nwAsk').checked; };
    q('#nwGo').onclick = () => {
      const title = q('#nwTitle').value.trim(); if (!title) return H.toast('Nhập tên việc');
      const it = newItem({ title, ch: q('#nwCh').value, pic: q('#nwPic').value || null, due: q('#nwDue').value, priority: q('#nwPri').value, desc: q('#nwDesc').value, steps: q('#nwSteps').value.split('\n').map(s => s.trim()).filter(Boolean) });
      if (mgr && q('#nwReq').checked) it.approval = { required: true };
      if (it.pic && it.pic !== H.me.id) it.log.push({ ts: H.now(), by: H.me.id, text: 'Giao việc cho ' + person(it.pic).name, kind: 'assign' });
      if (!mgr && q('#nwAsk').checked) { const n = q('#nwNote').value.trim() || title; it.status = 'review'; it.approval = { required: true, state: 'pending', by: H.me.id, at: H.now(), note: n }; it.log.push({ ts: H.now(), by: H.me.id, text: 'Đề xuất duyệt: ' + n, kind: 'approval' }); }
      H.closeModal(); workOp('tạo ' + it.id, d => { d.items.push(it); });
    };
  });
}

/* ---------------- daily popup ("Hôm nay") ---------------- */
function daily(force) {
  const key = 'daily-' + today(); if (!force && store.get(key)) return; store.set(key, '1');
  const items = X.work.items || [], mgr = isMgr(), act = items.filter(i => i.status !== 'done');
  const since = Date.now() - 24 * 36e5, recent = items.flatMap(i => (i.log || []).filter(l => Date.parse(l.ts) > since && l.by !== H.me.id).map(l => ({ i, l }))).sort((a, b) => b.l.ts.localeCompare(a.l.ts));
  const unread = chatUnread();
  if (mgr) {
    const sec = (t, arr, f) => arr.length ? `<h4>${t} <span class="sub">${arr.length}</span></h4><ul class="dl">${arr.slice(0, 6).map(f).join('')}</ul>` : '';
    H.modal(`<div class="daily"><h3>☀ Hôm nay của team · ${dmy(today())}</h3><p class="sub">${act.length} việc đang chạy · ${recent.length} cập nhật trong 24 giờ · ${unread} tin nhắn chưa đọc</p>
      ${sec('🟡 Chờ bạn duyệt', act.filter(i => i.status === 'review'), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — ${esc(person(i.approval && i.approval.by).short)}: ${esc((i.approval && i.approval.note) || '')}</li>`)}
      ${sec('⛔ Đang vướng', act.filter(i => i.status === 'blocked'), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — ${esc(i.blocker || '')} (${esc(person(i.pic).short)})</li>`)}
      ${sec('⏰ Trễ hạn / có rủi ro', act.filter(i => ['over', 'risk'].includes(health(i).k)), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — ${health(i).t}, ${progress(i)}%</li>`)}
      ${sec('🔕 Chưa cập nhật > 2 ngày', act.filter(i => health(i).k === 'silent'), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — ${esc(person(i.pic).short)}</li>`)}
      ${sec('↻ Cập nhật mới', recent, x => `<li><b>${esc(person(x.l.by).short)}</b> · <a href="#" data-openw="${x.i.id}">${esc(x.i.title)}</a>: ${esc(x.l.text)}</li>`)}
      ${!act.length ? '<p>Chưa có việc nào. Bấm "+ Giao việc / dự án" để bắt đầu — có sẵn mẫu Sabi Lab và Shopee Mall.</p>' : ''}
      <div class="foot"><button class="btn ghost" data-close>Đóng</button><button class="btn pri" id="dlGo">Mở Công việc</button></div></div>`, m => {
      m.querySelector('#dlGo').onclick = () => { H.closeModal(); H.goto('work'); };
      m.querySelectorAll('[data-openw]').forEach(a => a.onclick = e => { e.preventDefault(); H.closeModal(); H.goto('work'); setTimeout(() => openItem(a.dataset.openw), 60); });
    });
  } else {
    const mine = act.filter(i => i.pic === H.me.id);
    H.modal(`<div class="daily"><h3>☀ Cập nhật hôm nay · ${dmy(today())}</h3><p class="sub">Mỗi việc 1–2 dòng: hôm nay làm gì, đến bước nào, vướng gì. Quản lý sẽ thấy ngay.</p>
      ${mine.map(i => { const ns = nextStep(i); return `<div class="dc" data-id="${i.id}"><div class="dc-h"><b>${esc(i.title)}</b><span class="sub">${progress(i)}% · ${health(i).t}</span></div>${ns ? `<label class="dc-ns"><input type="checkbox" data-tick="${ns.id}"> Đã xong bước: ${esc(ns.t)}</label>` : ''}<textarea rows="2" placeholder="Hôm nay…"></textarea><label class="dc-bl"><input type="checkbox" data-bl> Đang vướng (ghi lý do ở trên)</label></div>`; }).join('') || '<p>Bạn chưa có việc nào đang chạy.</p>'}
      ${recent.length ? `<h4>↻ Mới từ team</h4><ul class="dl">${recent.slice(0, 5).map(x => `<li><b>${esc(person(x.l.by).short)}</b> · ${esc(x.i.title)}: ${esc(x.l.text)}</li>`).join('')}</ul>` : ''}
      <div class="foot"><button class="btn ghost" data-close>Để sau</button>${mine.length ? '<button class="btn pri" id="dcGo">Gửi cập nhật</button>' : ''}</div></div>`, m => {
      const go = m.querySelector('#dcGo'); if (!go) return;
      go.onclick = () => {
        const ups = [...m.querySelectorAll('.dc')].map(el => ({ id: el.dataset.id, text: el.querySelector('textarea').value.trim(), tick: el.querySelector('[data-tick]') && el.querySelector('[data-tick]').checked ? el.querySelector('[data-tick]').dataset.tick : null, bl: el.querySelector('[data-bl]').checked })).filter(u => u.text || u.tick);
        if (!ups.length) return H.toast('Nhập ít nhất một cập nhật');
        H.closeModal();
        workOp('cập nhật hằng ngày', d => { for (const u of ups) { const x = d.items.find(i => i.id === u.id); if (!x) continue; if (u.tick) { const s = x.steps.find(s => s.id === u.tick); if (s && !s.done) { s.done = true; s.doneAt = H.now(); s.by = H.me.id; logTo(x, '✓ Xong bước: ' + s.t, { kind: 'update' }); } }
          if (u.text) { if (u.bl) { x.status = 'blocked'; x.blocker = u.text; logTo(x, 'Đang vướng: ' + u.text, { kind: 'blocked' }); } else { if (x.status === 'todo' || x.status === 'blocked') { x.status = 'doing'; x.blocker = ''; } logTo(x, u.text, { kind: 'update' }); } } } })
          .then(ok => ok && H.toast('Đã gửi cập nhật hôm nay ✓'));
      };
    });
  }
}

/* ---------------- seed the two projects the manager asked to track ---------------- */
async function seed() {
  if (!isMgr() || (X.work.items || []).length || store.get('seeded') || !H.canWrite()) return;
  store.set('seeded', '1');
  await workOp('tạo dự án mẫu', d => { if (d.items.length) return; d.items.push(newItem({ ...TPL.sabi, steps: TPL.sabi.steps }), newItem({ ...TPL.mall, steps: TPL.mall.steps })); d.items[1].id = 'W' + (Date.now() + 7).toString(36).toUpperCase().slice(-5); });
}

return {
  async init(host) {
    H = host; X.ready = false; X.lastWorkSeen = store.get('workSeen');
    await refresh(true); X.ready = true; startPolling();
    await seed();
    setTimeout(() => daily(false), 900);
  },
  mount(el, view) { root = el; root.dataset.view = view; paint(); },
  unmount() { root = null; },
  refresh, openItem, daily,
  badges: () => ({ chat: H ? chatUnread() : 0, work: H ? myWorkBadge() : 0 })
};
})();
