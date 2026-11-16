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
const person = id => (H ? H.team : ((window.CC_CONFIG || {}).TEAM || [])).find(p => p.id === id) || { id, name: id || 'Chưa giao', short: id || 'Chưa giao' };
const initials = id => { const n = person(id).name || id || '?'; const w = n.trim().split(/\s+/); return (w.length > 1 ? w[w.length - 2][0] + w[w.length - 1][0] : n.slice(0, 2)).toUpperCase(); };
const AV_COL = ['#a34a28', '#6e4c8c', '#4f7a3a', '#b0751a', '#2f6f8a'];
const AVS = {};
const avatar = (id, sz = 28) => id && AVS[id] ? `<span class="av img" style="width:${sz}px;height:${sz}px" title="${esc(person(id).name)}"><img src="${AVS[id]}" alt=""></span>` : `<span class="av" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .38)}px;background:${id ? AV_COL[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_COL.length] : 'var(--muted)'}" title="${esc(person(id).name)}">${id ? esc(initials(id)) : '?'}</span>`;
const isMgr = () => H.me.role === 'manager';
const CH = { team: 'Chung', global: 'Global', local: 'Kệ 3 tầng', nikon: 'Nikon', sabi: 'Sabi Lab' };
const CH_COL = { team: 'var(--muted)', global: 'var(--s1)', local: 'var(--s4)', nikon: '#d9a400', sabi: 'var(--s3)' };
const ST = { todo: 'Cần làm', doing: 'Đang làm', blocked: 'Đang vướng', review: 'Chờ duyệt', done: 'Hoàn thành' };
const PRI = { P0: 'Khẩn', P1: 'Cao', P2: 'Vừa', P3: 'Thấp' };

/* ============================ storage ============================ */
const teamPath = m => `data/chat/team-${m}.enc.json`;
const dmPair = other => [H.me.id, other].sort().join('__');
const dmPath = (other, m) => `data/chat/dm-${dmPair(other)}-${m}.enc.json`;
const demoKey = (kind, other, m) => 'b2c-demo-' + (kind === 'team' ? 'team-' + m : 'dm-' + dmPair(other) + '-' + m);
async function readThread(kind, other) {
  const months = [prevYm(), ym()], out = [];
  for (const m of months) {
    let msgs;
    if (H.isDemo) msgs = JSON.parse(localStorage.getItem(demoKey(kind, other, m)) || '{"msgs":[]}').msgs;
    else { const key = kind === 'team' ? H.keys.S : await H.dmKey(other); if (!key) return null; msgs = (await H.ST.readEnc(kind === 'team' ? teamPath(m) : dmPath(other, m), key, { msgs: [] })).msgs || []; }
    msgs.forEach(x => { x._m = m; }); out.push(...msgs);
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}
/** mutate one month file of a thread on the freshest copy (send, react) */
async function threadOp(kind, other, m, label, fn) {
  if (H.isDemo) { const k = demoKey(kind, other, m), d = JSON.parse(localStorage.getItem(k) || '{"msgs":[]}'); fn(d); localStorage.setItem(k, JSON.stringify(d)); return; }
  const key = kind === 'team' ? H.keys.S : await H.dmKey(other); if (!key) throw new Error('Người nhận chưa bật chat riêng (cần đăng xuất & đăng nhập lại bản mới một lần)');
  await H.ST.updateEnc(kind === 'team' ? teamPath(m) : dmPath(other, m), key, d => { d.msgs = d.msgs || []; fn(d); if (d.msgs.length > 3000) d.msgs = d.msgs.slice(-3000); return d; }, label, { msgs: [] });
}
async function sendMsg(kind, other, body) {
  const m = ym(), msg = { id: uid('m'), ts: H.now(), from: H.me.id, ...body };
  if (msg.text) msg.text = msg.text.slice(0, 4000);
  await threadOp(kind, other, m, `chat: ${H.me.id} ${kind === 'team' ? '→ team' : '→ ' + other}`, d => d.msgs.push(msg));
  msg._m = m; return msg;
}
async function reactMsg(kind, other, msg, emoji) {
  await threadOp(kind, other, msg._m || ym(), `chat: ${H.me.id} react`, d => { const x = d.msgs.find(z => z.id === msg.id); if (!x) return; x.r = x.r || {}; const arr = x.r[emoji] || []; const i = arr.indexOf(H.me.id); if (i >= 0) arr.splice(i, 1); else { for (const k in x.r) x.r[k] = x.r[k].filter(u => u !== H.me.id); arr.push(H.me.id); } x.r[emoji] = arr; for (const k in x.r) if (!x.r[k].length) delete x.r[k]; });
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
  if (it.pic && !(it.steps || []).length && it.status !== 'done') return { k: 'split', t: 'Chờ PIC chia bước', c: 'warn' };
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
function unreadOf(thread, msgs) {
  if (!H) return 0; const last = store.get('read-' + thread) || ''; return (msgs || []).filter(m => m.from !== H.me.id && m.ts > last).length; }
function chatUnread() { let n = unreadOf('team', X.team.msgs); for (const [o, t] of Object.entries(X.dms)) n += unreadOf('dm-' + o, t.msgs); return n; }
function myWorkBadge() {
  const it = X.work.items || [];
  if (isMgr()) return it.filter(i => i.status === 'review' || (i.approval && i.approval.state === 'pending')).length;
  return it.filter(i => i.pic === H.me.id && i.status !== 'done' && (!lastUpdate(i) || lastUpdate(i).ts.slice(0, 10) < today())).length;
}
function diffNotify(oldMsgs, newMsgs, thread, label) {
  const seen = new Set((oldMsgs || []).map(m => m.id));
  for (const m of newMsgs) if (!seen.has(m.id) && m.from !== H.me.id && X.ready) {
    const mention = new RegExp('@(' + [H.me.id, H.me.username, (H.me.name || '').split(' ').pop()].filter(Boolean).join('|') + ')', 'i').test(m.text || '');
    if (H.tab() !== 'chat' || X.thread !== thread || !C.open || document.hidden) notify((mention ? '🔔 ' : '') + person(m.from).short + (label ? ' · ' + label : ''), preview(m), 'chat');
  }
}
const mentionsMe = t => !!t && new RegExp('@(' + [H.me.id, H.me.username, (H.me.name || '').split(' ').pop(), person(H.me.id).short].filter(Boolean).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'iu').test(t);
function reactNotify(oldMsgs, newMsgs, label) {
  if (!X.ready) return; const om = new Map((oldMsgs || []).map(m => [m.id, m]));
  for (const m of newMsgs) { if (m.from !== H.me.id || !m.r) continue; const o = om.get(m.id); if (!o) continue;
    for (const [e, us] of Object.entries(m.r)) for (const u of us) if (u !== H.me.id && !((o.r || {})[e] || []).includes(u)) notify(person(u).short + ' đã thả ' + e, (label ? label + ' · ' : '') + preview(m).slice(0, 60), 'chat'); }
}
function workNotify(oldW, newW) {
  if (!X.ready) return; const om = new Map((oldW.items || []).map(i => [i.id, i]));
  for (const it of newW.items || []) {
    const o = om.get(it.id), newLogs = (it.log || []).filter(l => l.by !== H.me.id && (!o || !(o.log || []).some(x => x.ts === l.ts && x.by === l.by)));
    for (const l of newLogs) {
      const mine = it.pic === H.me.id || it.createdBy === H.me.id || isMgr() || (it.steps || []).some(s => s.pic === H.me.id) || mentionsMe(l.text);
      if (!mine) continue;
      if (l.kind === 'assign' && it.pic === H.me.id) notify('📌 Việc mới giao cho bạn', it.title, 'work');
      else if (l.kind === 'approval' && isMgr()) notify('🟡 Cần duyệt: ' + it.title, person(l.by).short + ': ' + (l.text || ''), 'work');
      else if (l.kind === 'decision' && it.pic === H.me.id) notify(l.ok ? '✅ Đã duyệt' : '↩ Chưa duyệt', it.title + (l.note ? ' — ' + l.note : ''), 'work');
      else if (mentionsMe(l.text)) notify('🔔 ' + person(l.by).short + ' nhắc bạn', it.title + ': ' + (l.text || ''), 'work');
      else if (l.kind === 'update') notify('↻ ' + person(l.by).short + ' cập nhật', it.title + ': ' + (l.text || ''), 'work');
      else if (l.kind === 'blocked' && isMgr()) notify('⛔ Đang vướng: ' + it.title, l.text || '', 'work');
    }
  }
}
async function loadAvatars() {
  try {
    const d = H.isDemo ? JSON.parse(localStorage.getItem('b2c-demo-av') || '{}') : await H.ST.readEnc('data/avatars.enc.json', H.keys.S, {});
    const ch = JSON.stringify(d) !== JSON.stringify(AVS); for (const k in AVS) delete AVS[k]; Object.assign(AVS, d || {}); if (ch && H.onAvatars) H.onAvatars();
  } catch (e) {}
}
async function setAvatar(url) {
  if (url && url.length > 60000) throw new Error('Ảnh quá lớn');
  const fn = d => { d = d || {}; if (url) d[H.me.id] = url; else delete d[H.me.id]; return d; };
  if (H.isDemo) { const d = fn(JSON.parse(localStorage.getItem('b2c-demo-av') || '{}')); localStorage.setItem('b2c-demo-av', JSON.stringify(d)); }
  else { if (!H.canWrite()) throw new Error('Chưa có GitHub token — quản lý cần nhập token trong Cài đặt'); await H.ST.updateEnc('data/avatars.enc.json', H.keys.S, fn, 'avatar: ' + H.me.id, {}); }
  await loadAvatars(); if (root) paint(true);
}
async function refresh(all) {
  try {
    const oldTeam = X.team.msgs, oldWork = X.work;
    const t = await readThread('team'); if (t) { diffNotify(oldTeam, t, 'team', 'Cả team'); reactNotify(oldTeam, t, 'Cả team'); X.team.msgs = t; }
    for (const p of H.team.filter(p => p.id !== H.me.id)) {
      const old = (X.dms[p.id] || {}).msgs || [];
      const msgs = await readThread('dm', p.id).catch(() => null);
      X.dms[p.id] = { msgs: msgs || [], locked: msgs == null };
      if (msgs) { diffNotify(old, msgs, 'dm-' + p.id, 'nhắn riêng'); reactNotify(old, msgs, 'nhắn riêng'); }
    }
    const w = await readWork(); workNotify(oldWork, w); X.work = w;
    await loadAvatars();
  } catch (e) { /* offline or token missing: keep last state */ }
  H.onBadge({ chat: chatUnread(), work: myWorkBadge() });
  if (root && X.loaded) paint(true);
}
function startPolling() {
  clearInterval(X.polling);
  X.polling = setInterval(async () => {
    if (H.isDemo) return;
    const p = await H.ST.poll();
    if (p.changed) refresh();
  }, document.hidden ? 30000 : (H.tab() === 'chat' ? 6000 : 12000));
  document.addEventListener('visibilitychange', () => startPolling(), { once: true });
  addEventListener('cc-tab', () => startPolling(), { once: true });
}

/* ============================ rendering ============================ */
function paint(keep) {
  if (!root) return;
  if (!H || !X.ready && !X.loaded) { root.innerHTML = '<div class="empty2">Đang tải…</div>'; return; }
  if (root.dataset.view === 'chat') return paintChat(keep);
  if (root.dataset.view === 'work') return paintWork(keep);
}
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/@([\p{L}\d_.]+)/gu, '<b class="mention">@$1</b>').replace(/#(W[0-9A-Z]{3,6})\b/g, '<a href="#" data-openw="$1" class="wlink">#$1</a>').replace(/\n/g, '<br>');

/* ---------------- chat (Instagram-style) ---------------- */
const REACTS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const EMOJI = ['😀','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','😅','😭','😢','😤','😡','🤔','🙄','😴','🤯','😱','🙏','👍','👎','👏','🙌','💪','🤝','👌','✌️','👀','❤️','🧡','💛','💚','💜','🔥','✨','💯','🎉','✅','❌','⚠️','⏳','📌','📦','🛒','💰','📈','📉','📅','☕','🍜','🚀','💡'];
const STICK_E = ['😂','😍','🥳','🔥','👍','🙏','💯','😭','😎','🤝','✅','🎉','😅','🤔','💪','❤️'];
const STICK_T = [['Nhận', '👌'], ['Đã nhận', '📥'], ['Đang xử lý', '🛠️'], ['Đã xong', '✅'], ['Duyệt', '👍'], ['Cần duyệt', '📝'], ['Cần kiểm tra', '👀'], ['Chờ phản hồi', '⏳'], ['Gấp', '🔥'], ['Đã chốt', '🛒'], ['Họp', '📅'], ['Cảm ơn', '🙏'], ['Tuyệt vời', '🎉'], ['Đã gửi', '📤'], ['Nghỉ trưa', '🍜']];
const stickerHtml = st => { if (!st) return ''; if (st.startsWith('e:')) return `<div class="stk e">${esc(st.slice(2))}</div>`; const t = STICK_T[+st.slice(2)] || ['?', '']; return `<div class="stk t"><span>${esc(t[1])}</span>${esc(t[0])}</div>`; };
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const C = { open: false, reply: null, picker: null, react: null };
function threadsList() {
  const others = H.team.filter(p => p.id !== H.me.id);
  return [{ id: 'team', label: 'Cả team B2C', sub: `${H.team.length} thành viên`, msgs: X.team.msgs, kind: 'team' },
    ...others.map(p => ({ id: 'dm-' + p.id, label: p.name, short: p.short, sub: p.role === 'manager' ? 'Quản lý' : (p.channel === 'global' ? 'Global' : 'Local · Nikon'), msgs: (X.dms[p.id] || {}).msgs || [], who: p.id, locked: (X.dms[p.id] || {}).locked, kind: 'dm' }))];
}
const teamAv = sz => `<span class="av team" style="width:${sz}px;height:${sz}px"><img src="assets/logo.svg" alt=""></span>`;
const preview = m => m ? (m.sticker ? (m.sticker.startsWith('e:') ? m.sticker.slice(2) + ' Sticker' : '🏷 ' + (STICK_T[+m.sticker.slice(2)] || [''])[0]) : m.text) : '';
function msgHtml(cur, m, prev, next) {
  const mine = m.from === H.me.id, sameP = prev && prev.from === m.from && dayOf(prev) === dayOf(m) && Date.parse(m.ts) - Date.parse(prev.ts) < 5 * 6e4, sameN = next && next.from === m.from && dayOf(next) === dayOf(m) && Date.parse(next.ts) - Date.parse(m.ts) < 5 * 6e4;
  const reacts = m.r ? Object.entries(m.r).filter(([, u]) => u.length) : [];
  const pos = sameP && sameN ? 'mid' : sameP ? 'end' : sameN ? 'start' : 'solo';
  return `<div class="cm ${mine ? 'me' : ''} ${pos} ${m.sticker ? 'sticker' : ''} ${m.id === 'tmp' ? 'sending' : ''}" data-mid="${esc(m.id)}">
    ${!mine ? (sameN ? '<span class="av-sp"></span>' : avatar(m.from, 28)) : ''}
    <div class="cm-col">${!mine && cur.kind === 'team' && !sameP ? `<div class="cm-n">${esc(person(m.from).short)}</div>` : ''}
      ${m.reply ? `<div class="cm-q"><b>${esc(m.reply.from === H.me.id ? 'Bạn' : person(m.reply.from).short)}</b>${esc((m.reply.text || '').slice(0, 90))}</div>` : ''}
      <div class="cm-row">${m.sticker ? stickerHtml(m.sticker) : `<div class="cm-b">${linkify(m.text || '')}</div>`}
        <div class="cm-tools"><button data-act="react" title="Thả cảm xúc">☺</button><button data-act="reply" title="Trả lời">↩</button></div></div>
      ${reacts.length ? `<div class="cm-r">${reacts.map(([e, u]) => `<button data-toggle="${e}" class="${u.includes(H.me.id) ? 'on' : ''}" title="${esc(u.map(x => person(x).short).join(', '))}">${e}${u.length > 1 ? `<i>${u.length}</i>` : ''}</button>`).join('')}</div>` : ''}
      ${!sameN ? `<div class="cm-ts">${hhmm(m.ts)}</div>` : ''}</div></div>`;
}
const dayOf = m => new Date(new Date(m.ts).getTime() + 7 * 36e5).toISOString().slice(0, 10);
function paintChat(keep) {
  const threads = threadsList(), cur = threads.find(t => t.id === X.thread) || threads[0], mob = isMobile();
  if (!mob) C.open = true;
  const lastRead = store.get('read-' + cur.id) || '';
  if (C.open) store.set('read-' + cur.id, (cur.msgs[cur.msgs.length - 1] || {}).ts || lastRead);
  H.onBadge({ chat: chatUnread(), work: myWorkBadge() });
  document.body.classList.toggle('cx-full', mob && C.open);
  const old = root.querySelector('.cx-msgs'), atBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 120, oldTop = old ? old.scrollTop : 0;
  const draft = root.querySelector('#cxIn') ? root.querySelector('#cxIn').value : (C.draft || '');
  let html = '', lastDay = '', newShown = false;
  cur.msgs.forEach((m, i) => {
    const d = dayOf(m);
    if (d !== lastDay) { html += `<div class="cx-day"><span>${d === today() ? 'Hôm nay' : d === new Date(Date.now() - 864e5 + 7 * 36e5).toISOString().slice(0, 10) ? 'Hôm qua' : dmy(d) + '/' + d.slice(0, 4)}</span></div>`; lastDay = d; }
    if (!newShown && lastRead && m.ts > lastRead && m.from !== H.me.id && keep !== 'sent') { html += '<div class="cx-new"><span>Tin nhắn mới</span></div>'; newShown = true; }
    html += msgHtml(cur, m, cur.msgs[i - 1], cur.msgs[i + 1]);
  });
  const canSend = !cur.locked && H.canWrite();
  root.innerHTML = `<div class="cx glass ${C.open ? 'is-open' : ''}">
    <aside class="cx-side"><div class="cx-sh"><b>Tin nhắn</b>${('Notification' in window) && Notification.permission === 'default' ? '<button class="btn ghost cx-bell" id="cxBell">🔔 Bật thông báo</button>' : ''}</div>
      <div class="cx-list">${threads.map(t => { const u = unreadOf(t.id, t.msgs), last = t.msgs[t.msgs.length - 1]; return `<button class="cx-th ${u ? 'unread' : ''}" data-th="${t.id}" aria-pressed="${t.id === cur.id && C.open}">${t.who ? avatar(t.who, 50) : teamAv(50)}<span class="cx-thb"><b>${esc(t.label)}</b><small>${last ? esc((last.from === H.me.id ? 'Bạn: ' : (t.kind === 'team' ? person(last.from).short + ': ' : '')) + preview(last).slice(0, 48)) + ' · ' + ago(last.ts).replace(' trước', '') : esc(t.sub)}</small></span>${u ? `<i class="cx-u">${u}</i>` : ''}</button>`; }).join('')}</div>
    </aside>
    <section class="cx-main">
      <header class="cx-hd"><button class="cx-back" id="cxBack" aria-label="Quay lại">‹</button>${cur.who ? avatar(cur.who, 38) : teamAv(38)}<div class="cx-hdt"><b>${esc(cur.label)}</b><small>${cur.who ? '🔒 Mã hoá đầu-cuối · chỉ 2 người đọc được' : `${H.team.map(p => esc(p.short)).join(', ')}`}</small></div></header>
      <div class="cx-msgs" id="cxMsgs">${cur.locked ? `<div class="cx-empty">🔒<p>Chưa mở được chat riêng với ${esc(person(cur.who).short)}.<br>Cả hai cần đăng xuất & đăng nhập lại bản mới một lần.</p></div>` : html || `<div class="cx-empty">${cur.who ? avatar(cur.who, 72) : teamAv(72)}<p><b>${esc(cur.label)}</b><br>Gửi lời chào hoặc một sticker 👋</p></div>`}</div>
      ${C.reply ? `<div class="cx-reply"><div><b>Đang trả lời ${esc(C.reply.from === H.me.id ? 'chính bạn' : person(C.reply.from).short)}</b><span>${esc(preview(C.reply).slice(0, 80))}</span></div><button id="cxRx" aria-label="Huỷ trả lời">×</button></div>` : ''}
      <div class="cx-picker" id="cxPicker" ${C.picker ? '' : 'hidden'}>${C.picker ? pickerHtml() : ''}</div>
      <form class="cx-in" id="cxForm"><button type="button" class="cx-ib" id="cxEmo" aria-label="Sticker & emoji" ${canSend ? '' : 'disabled'}>☺</button>
        <textarea id="cxIn" rows="1" enterkeyhint="send" placeholder="${canSend ? 'Nhắn tin…' : 'Không gửi được'}" ${canSend ? '' : 'disabled'}></textarea>
        <button class="cx-send" id="cxSend" ${canSend ? '' : 'disabled'} aria-label="Gửi">${draft.trim() ? '➤' : '❤️'}</button></form>
    </section></div>`;
  const list = root.querySelector('#cxMsgs');
  if (!keep || keep === 'sent' || atBottom) list.scrollTop = list.scrollHeight; else list.scrollTop = oldTop;
  const ta = root.querySelector('#cxIn'), send = root.querySelector('#cxSend'); ta.value = draft;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; send.textContent = ta.value.trim() ? '➤' : '❤️'; send.classList.toggle('txt', !!ta.value.trim()); C.draft = ta.value; };
  grow();
  if ((!keep || keep === 'sent') && C.open && !mob) setTimeout(() => ta.focus(), 30);
  ta.addEventListener('input', grow);
  ta.addEventListener('focus', () => { C.picker = null; const p = root.querySelector('#cxPicker'); if (p) p.hidden = true; setTimeout(() => { list.scrollTop = list.scrollHeight; }, 250); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mob) { e.preventDefault(); root.querySelector('#cxForm').requestSubmit(); } });
  root.querySelector('#cxForm').onsubmit = e => { e.preventDefault(); const t = ta.value.trim(); if (t) doSend(cur, { text: t }); else doSend(cur, { sticker: 'e:❤️' }); };
  root.querySelector('#cxEmo').onclick = () => { C.picker = C.picker ? null : 'sticker'; paintChat(true); };
  root.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { X.thread = b.dataset.th; C.open = true; C.reply = null; C.picker = null; C.draft = ''; paintChat(); });
  root.querySelector('#cxBack').onclick = () => { C.open = false; C.picker = null; paintChat(); };
  const rx = root.querySelector('#cxRx'); if (rx) rx.onclick = () => { C.reply = null; paintChat(true); };
  const bell = root.querySelector('#cxBell'); if (bell) bell.onclick = () => Notification.requestPermission().then(() => paintChat(true));
  bindPicker(cur, ta);
  // message interactions: hover tools (desktop), long-press (mobile), double-tap = ❤️
  list.querySelectorAll('[data-openw]').forEach(a => a.onclick = e => { e.preventDefault(); H.goto('work'); setTimeout(() => openItem(a.dataset.openw), 60); });
  list.querySelectorAll('.cm').forEach(el => {
    const msg = cur.msgs.find(x => x.id === el.dataset.mid); if (!msg || msg.id === 'tmp') return;
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = e => { e.stopPropagation(); if (b.dataset.act === 'reply') { C.reply = msg; paintChat(true); root.querySelector('#cxIn').focus(); } else reactBar(cur, msg, el); });
    el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = e => { e.stopPropagation(); doReact(cur, msg, b.dataset.toggle); });
    let lastTap = 0, timer = null;
    const body = el.querySelector('.cm-b, .stk');
    if (!body) return;
    body.addEventListener('dblclick', () => doReact(cur, msg, '❤️'));
    body.addEventListener('touchstart', () => { timer = setTimeout(() => { timer = null; navigator.vibrate && navigator.vibrate(12); reactBar(cur, msg, el); }, 420); }, { passive: true });
    body.addEventListener('touchend', e => { if (timer) { clearTimeout(timer); const n = Date.now(); if (n - lastTap < 300) { e.preventDefault(); doReact(cur, msg, '❤️'); } lastTap = n; } });
    body.addEventListener('touchmove', () => { clearTimeout(timer); timer = null; }, { passive: true });
  });
}
function pickerHtml() {
  return `<div class="pk-tabs"><button data-pk="sticker" aria-pressed="${C.picker === 'sticker'}">Sticker</button><button data-pk="emoji" aria-pressed="${C.picker === 'emoji'}">Emoji</button></div>
    ${C.picker === 'emoji' ? `<div class="pk-emoji">${EMOJI.map(e => `<button data-emo="${e}">${e}</button>`).join('')}</div>`
    : `<div class="pk-stk">${STICK_T.map((t, i) => `<button data-stk="t:${i}" class="stk t"><span>${t[1]}</span>${esc(t[0])}</button>`).join('')}${STICK_E.map(e => `<button data-stk="e:${e}" class="stk e">${e}</button>`).join('')}</div>`}`;
}
function bindPicker(cur, ta) {
  const p = root.querySelector('#cxPicker'); if (!p || p.hidden) return;
  p.querySelectorAll('[data-pk]').forEach(b => b.onclick = () => { C.picker = b.dataset.pk; paintChat(true); });
  p.querySelectorAll('[data-emo]').forEach(b => b.onclick = () => { const s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + b.dataset.emo + ta.value.slice(s); C.draft = ta.value; ta.dispatchEvent(new Event('input')); });
  p.querySelectorAll('[data-stk]').forEach(b => b.onclick = () => { C.picker = null; doSend(cur, { sticker: b.dataset.stk }); });
}
function reactBar(cur, msg, el) {
  root.querySelectorAll('.cx-rbar').forEach(x => x.remove());
  const bar = document.createElement('div'); bar.className = 'cx-rbar';
  bar.innerHTML = REACTS.map(e => `<button data-e="${e}" class="${msg.r && msg.r[e] && msg.r[e].includes(H.me.id) ? 'on' : ''}">${e}</button>`).join('') + '<button data-rp title="Trả lời">↩</button>';
  el.querySelector('.cm-col').appendChild(bar);
  bar.querySelectorAll('[data-e]').forEach(b => b.onclick = e => { e.stopPropagation(); bar.remove(); doReact(cur, msg, b.dataset.e); });
  bar.querySelector('[data-rp]').onclick = e => { e.stopPropagation(); bar.remove(); C.reply = msg; paintChat(true); root.querySelector('#cxIn').focus(); };
  setTimeout(() => document.addEventListener('click', () => bar.remove(), { once: true }), 0);
}
async function doSend(cur, body) {
  if (cur.locked || !H.canWrite()) return;
  const kind = cur.kind, other = cur.who, arr = kind === 'team' ? X.team.msgs : X.dms[other].msgs;
  if (C.reply) body.reply = { id: C.reply.id, from: C.reply.from, text: preview(C.reply).slice(0, 140) };
  const tmp = { id: 'tmp', ts: new Date().toISOString(), from: H.me.id, ...body }; arr.push(tmp);
  C.reply = null; C.draft = ''; const ta = root.querySelector('#cxIn'); if (ta) ta.value = '';
  paintChat('sent');
  try { const m = await sendMsg(kind, other, body); const i = arr.indexOf(tmp); if (i >= 0) arr[i] = m; store.set('read-' + cur.id, m.ts); }
  catch (er) { H.toast(er.message || 'Không gửi được'); arr.splice(arr.indexOf(tmp), 1); if (body.text) C.draft = body.text; }
  if (root && root.dataset.view === 'chat') paintChat('sent');
}
async function doReact(cur, msg, emoji) {
  msg.r = msg.r || {}; const arr = msg.r[emoji] || [], had = arr.includes(H.me.id);
  for (const k in msg.r) msg.r[k] = msg.r[k].filter(u => u !== H.me.id);
  if (!had) msg.r[emoji] = (msg.r[emoji] || []).concat(H.me.id);
  for (const k in msg.r) if (!msg.r[k].length) delete msg.r[k];
  paintChat(true);
  try { await reactMsg(cur.kind, cur.who, msg, emoji); } catch (e) { H.toast(e.message || 'Không thả cảm xúc được'); }
}

/* ---------------- work board ---------------- */
function filtered() {
  const f = X.wf, q = f.q.trim().toLowerCase();
  return (X.work.items || []).filter(it => (f.ch === 'all' || it.ch === f.ch) && (f.pic === 'all' || (f.pic === 'none' ? !it.pic : it.pic === f.pic)) && (!f.mine || it.pic === H.me.id || it.createdBy === H.me.id || myStep(it)) && (!q || (it.title + ' ' + it.desc + ' ' + (it.steps || []).map(s => s.t).join(' ')).toLowerCase().includes(q)));
}
function cardHtml(it) {
  const p = progress(it), h = health(it), ns = nextStep(it), lu = lastUpdate(it), d = daysTo(it.due);
  return `<article class="wk-card ${h.k}" data-open="${esc(it.id)}" draggable="${canEdit(it)}" data-id="${esc(it.id)}">
    <div class="wk-top"><span class="wk-ch" style="--c:${CH_COL[it.ch] || 'var(--muted)'}">${esc(CH[it.ch] || it.ch)}</span><span class="wk-pri ${it.priority}">${PRI[it.priority] || ''}</span><span class="wk-id">${esc(it.id)}</span></div>
    <h4>${esc(it.title)}</h4>
    ${it.status === 'blocked' && it.blocker ? `<div class="wk-block">⛔ ${esc(it.blocker)}</div>` : ''}
    ${ns && it.status !== 'done' ? `<div class="wk-next">→ ${esc(ns.t)}${ns.pic && ns.pic !== it.pic ? ' · ' + esc(person(ns.pic).short) : ''}${ns.due ? ' · ' + dmy(ns.due) : ''}</div>` : ''}${!(it.steps || []).length && it.status !== 'done' ? `<div class="wk-next warn">✎ Chưa có bước — ${it.pic === H.me.id ? 'bấm để tự chia bước' : 'chờ PIC chia bước'}</div>` : ''}
    <div class="wk-prog"><i style="width:${p}%"></i></div>
    <div class="wk-meta">${avatar(it.pic, 22)}<span>${esc(it.pic ? person(it.pic).short : 'Chưa giao')}</span><span class="dot">·</span><span>${it.steps && it.steps.length ? it.steps.filter(s => s.done).length + '/' + it.steps.length + ' bước' : p + '%'}</span>${it.due ? `<span class="dot">·</span><span class="${d != null && d < 0 && it.status !== 'done' ? 'bad' : ''}">hạn ${dmy(it.due)}</span>` : ''}</div>
    <div class="wk-foot"><span class="tag ${h.c}">${h.t}</span><span class="sub">${lu ? '↻ ' + ago(lu.ts) : 'chưa cập nhật'}</span></div></article>`;
}
const canEdit = it => isMgr() || it.pic === H.me.id || it.createdBy === H.me.id;
const myStep = it => (it.steps || []).some(s => s.pic === H.me.id && !s.done);
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
    <div class="fresh"><button class="btn ghost" id="wkWeek">📝 Báo cáo tuần</button><button class="btn" id="wkDaily">${mgr ? '☀ Tóm tắt hôm nay' : '☀ Cập nhật hôm nay'}</button><button class="btn pri" id="wkNew" ${H.canWrite() ? '' : 'disabled'}>+ ${mgr ? 'Giao việc / dự án' : 'Thêm việc / đề xuất cần duyệt'}</button></div></div>
  ${smart.length ? `<section class="card glass wk-smart"><h3>Điểm cần chú ý</h3><ul>${smart.map(x => `<li>${x}</li>`).join('')}</ul></section>` : ''}
  <div class="wk-chips">${chips.map(([k, l, n, c]) => `<button class="wk-chip ${c}" data-quick="${k}"><b>${n}</b><span>${l}</span></button>`).join('')}</div>
  <div class="toolbar wk-tools">
    <div class="seg" data-wf="ch">${[['all', 'Tất cả'], ...Object.entries(CH)].map(([k, l]) => `<button data-v="${k}" aria-pressed="${f.ch === k}">${l}</button>`).join('')}</div>
    <select class="ss" id="wkPic"><option value="all">Mọi PIC</option>${H.team.map(p => `<option value="${p.id}" ${f.pic === p.id ? 'selected' : ''}>${esc(p.short)}</option>`).join('')}<option value="none" ${f.pic === 'none' ? 'selected' : ''}>Chưa giao</option></select>
    <button class="chip" id="wkMine" aria-pressed="${f.mine}">Việc của tôi</button>
    <input class="sf" id="wkQ" placeholder="Tìm việc…" value="${esc(f.q)}">
    <div class="seg" data-wf="view" style="margin-left:auto"><button data-v="board" aria-pressed="${f.view === 'board'}">Bảng</button><button data-v="list" aria-pressed="${f.view === 'list'}">Danh sách</button><button data-v="time" aria-pressed="${f.view === 'time'}">Timeline</button><button data-v="people" aria-pressed="${f.view === 'people'}">Đội ngũ</button></div>
  </div>
  ${f.view === 'board' ? `<div class="wk-board">${cols.map(c => { const l = list.filter(i => i.status === c).sort((a, b) => (a.priority || 'P2').localeCompare(b.priority || 'P2') || String(a.due || '9').localeCompare(String(b.due || '9'))); return `<div class="wk-col glass" data-drop="${c}"><h3><span>${ST[c]}</span><span>${l.length}</span></h3>${l.map(cardHtml).join('') || '<div class="empty2" style="padding:14px">—</div>'}</div>`; }).join('')}</div>`
  : f.view === 'list' ? `<section class="card glass"><div class="tw"><table class="t wk-tbl"><tr><th>Việc</th><th>Kênh</th><th>PIC</th><th>Trạng thái</th><th class="r">Tiến độ</th><th>Hạn</th><th>Cập nhật</th></tr>${list.sort((a, b) => cols.indexOf(a.status) - cols.indexOf(b.status)).map(it => { const h = health(it), lu = lastUpdate(it); return `<tr data-open="${esc(it.id)}" style="cursor:pointer"><td><b>${esc(it.title)}</b>${nextStep(it) && it.status !== 'done' ? `<br><span class="sub">→ ${esc(nextStep(it).t)}</span>` : ''}</td><td>${esc(CH[it.ch] || '')}</td><td>${esc(it.pic ? person(it.pic).short : 'Chưa giao')}</td><td><span class="tag ${h.c}">${ST[it.status]}</span></td><td class="r">${progress(it)}%</td><td>${it.due ? dmy(it.due) : '–'}</td><td class="sub">${lu ? ago(lu.ts) : '–'}</td></tr>`; }).join('')}</table></div></section>`
  : f.view === 'people' ? teamView(items) : timeline(list)}`;
  bindWork();
}
/* metrics per person: load, delivery, speed, responsiveness */
function personStats(id, items) {
  const mine = items.filter(i => i.pic === id), act = mine.filter(i => i.status !== 'done'), wk = Date.now() - 7 * 864e5;
  const done = mine.filter(i => i.status === 'done' && i.doneAt), done7 = done.filter(i => Date.parse(i.doneAt) > wk);
  const onTime = done.filter(i => !i.due || i.doneAt.slice(0, 10) <= i.due), cyc = done.map(i => (Date.parse(i.doneAt) - Date.parse(i.createdAt)) / 864e5);
  const ups = items.flatMap(i => (i.log || []).filter(l => l.by === id && l.kind === 'update')), up7 = ups.filter(l => Date.parse(l.ts) > wk);
  const stepsMine = items.flatMap(i => (i.steps || []).filter(s => s.pic === id || (!s.pic && i.pic === id)));
  const lastUp = ups.map(l => l.ts).sort().pop();
  return { act: act.length, over: act.filter(i => health(i).k === 'over').length, blocked: act.filter(i => i.status === 'blocked').length, review: act.filter(i => i.status === 'review').length, silent: act.filter(i => health(i).k === 'silent').length,
    done7: done7.length, onTime: done.length ? onTime.length / done.length : null, cycle: cyc.length ? cyc.reduce((a, b) => a + b, 0) / cyc.length : null, up7: up7.length, lastUp,
    steps: stepsMine.length, stepsDone: stepsMine.filter(s => s.done).length, avgProg: act.length ? Math.round(act.reduce((a, i) => a + progress(i), 0) / act.length) : null };
}
function teamView(items) {
  const pct = v => v == null ? '–' : Math.round(v * 100) + '%';
  return `<div class="wk-team">${H.team.map(p => { const st = personStats(p.id, items), load = st.act >= 8 ? 'Quá tải' : st.act >= 5 ? 'Nhiều việc' : st.act ? 'Vừa sức' : 'Trống việc';
    return `<section class="card glass wk-pp"><div class="wk-pph">${avatar(p.id, 46)}<div><b>${esc(p.name)}</b><small>${p.role === 'manager' ? 'Quản lý' : p.channel === 'global' ? 'Global' : 'Local · Nikon'} · cập nhật gần nhất ${st.lastUp ? ago(st.lastUp) : 'chưa có'}</small></div><span class="tag ${st.act >= 8 ? 'bad' : st.act >= 5 ? 'warn' : 'good'}">${load}</span></div>
      <div class="wk-ppg"><div><b>${st.act}</b><span>Đang mở</span></div><div class="${st.over ? 'bad' : ''}"><b>${st.over}</b><span>Trễ hạn</span></div><div class="${st.blocked ? 'bad' : ''}"><b>${st.blocked}</b><span>Đang vướng</span></div><div class="${st.silent ? 'warn' : ''}"><b>${st.silent}</b><span>Im lặng</span></div>
        <div><b>${st.done7}</b><span>Xong 7 ngày</span></div><div><b>${pct(st.onTime)}</b><span>Đúng hạn</span></div><div><b>${st.cycle == null ? '–' : st.cycle.toFixed(1) + 'd'}</b><span>TB hoàn thành</span></div><div><b>${st.up7}</b><span>Cập nhật 7 ngày</span></div></div>
      ${st.avgProg != null ? `<div class="wk-ppbar"><span>Tiến độ TB việc đang mở ${st.avgProg}% · bước ${st.stepsDone}/${st.steps}</span><div class="wk-prog"><i style="width:${st.avgProg}%"></i></div></div>` : ''}
      <ul class="wk-ppl">${items.filter(i => i.pic === p.id && i.status !== 'done').slice(0, 5).map(i => `<li data-open="${esc(i.id)}"><span class="tag ${health(i).c}">${health(i).t}</span>${esc(i.title)}<em>${progress(i)}%</em></li>`).join('') || '<li class="sub">Không có việc đang mở</li>'}</ul></section>`; }).join('')}</div>`;
}
function weekly() {
  const items = X.work.items || [], wk = Date.now() - 7 * 864e5, d = today();
  const done = items.filter(i => i.status === 'done' && i.doneAt && Date.parse(i.doneAt) > wk), act = items.filter(i => i.status !== 'done');
  const next = act.filter(i => i.due && daysTo(i.due) >= 0 && daysTo(i.due) <= 7);
  const line = i => `- ${i.title} (${i.pic ? person(i.pic).short : 'chưa giao'}${i.due ? ', hạn ' + dmy(i.due) : ''}) — ${progress(i)}%`;
  const txt = [`📝 BÁO CÁO TUẦN B2C TEAM · ${dmy(d)}/${d.slice(0, 4)}`, '',
    `✅ Hoàn thành (${done.length})`, ...done.map(i => `- ${i.title} (${person(i.pic).short})`), '',
    `🚧 Đang làm (${act.filter(i => i.status === 'doing').length})`, ...act.filter(i => i.status === 'doing').map(i => line(i) + (nextStep(i) ? ` · bước tiếp: ${nextStep(i).t}` : '')), '',
    `⛔ Đang vướng (${act.filter(i => i.status === 'blocked').length})`, ...act.filter(i => i.status === 'blocked').map(i => line(i) + ` · ${i.blocker || ''}`), '',
    `🟡 Chờ duyệt (${act.filter(i => i.status === 'review').length})`, ...act.filter(i => i.status === 'review').map(i => line(i) + ` · ${(i.approval && i.approval.note) || ''}`), '',
    `📅 Đến hạn 7 ngày tới (${next.length})`, ...next.map(line), '',
    '👥 Theo người', ...H.team.map(p => { const st = personStats(p.id, items); return `- ${p.short}: ${st.act} đang mở, ${st.done7} xong tuần này, ${st.over} trễ, ${st.blocked} vướng, đúng hạn ${st.onTime == null ? '–' : Math.round(st.onTime * 100) + '%'}`; })].join('\n');
  H.modal(`<h3>📝 Báo cáo tuần</h3><p class="sub">Tự tổng hợp từ tab Công việc — sửa được trước khi gửi Zalo / email</p><label><textarea id="wkTxt" style="min-height:360px;font-size:13px">${esc(txt)}</textarea></label><div class="foot"><button class="btn ghost" data-close>Đóng</button><button class="btn" id="wkSendTeam">Gửi vào chat team</button><button class="btn pri" id="wkCopy">Copy</button></div>`, m => {
    m.querySelector('#wkCopy').onclick = async () => { try { await navigator.clipboard.writeText(m.querySelector('#wkTxt').value); H.toast('Đã copy báo cáo tuần'); } catch (e) { H.toast('Không copy được'); } };
    m.querySelector('#wkSendTeam').onclick = async () => { const t = m.querySelector('#wkTxt').value; H.closeModal(); try { await sendMsg('team', null, { text: t }); H.toast('Đã gửi báo cáo vào chat team'); refresh(); } catch (e) { H.toast(e.message); } };
  });
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
  root.querySelector('#wkWeek').onclick = weekly;
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
    <div class="wd-steps"><div class="wd-sh"><b>Các bước / subtask</b><span>${p}% · ${(it.steps || []).filter(s => s.done).length}/${(it.steps || []).length}</span></div><div class="wk-prog big"><i style="width:${p}%"></i></div>
      ${!(it.steps || []).length ? `<p class="wd-hint">${ed ? 'Chưa có bước nào. Hãy chia việc thành các bước nhỏ — mỗi bước có thể giao người & hạn riêng; tiến độ sẽ tự tính.' : 'PIC chưa chia bước cho việc này.'}</p>` : ''}
      ${(it.steps || []).map((s, i, arr) => `<div class="wd-step ${s.done ? 'done' : ''}" data-sid="${s.id}"><input type="checkbox" data-step="${s.id}" ${s.done ? 'checked' : ''} ${ed || s.pic === H.me.id ? '' : 'disabled'}>
        <span class="wd-st" ${ed ? 'contenteditable="true" spellcheck="false"' : ''} data-stxt="${s.id}">${esc(s.t)}</span>
        ${ed ? `<select class="wd-sp" data-spic="${s.id}" title="Người làm bước này"><option value="">${esc(it.pic ? person(it.pic).short : '—')}</option>${H.team.filter(x => x.id !== it.pic).map(x => `<option value="${x.id}" ${s.pic === x.id ? 'selected' : ''}>${esc(x.short)}</option>`).join('')}</select><input type="date" class="wd-sd" data-sdue="${s.id}" value="${esc(s.due || '')}" title="Hạn của bước"><span class="wd-mv"><button data-up="${s.id}" ${i ? '' : 'disabled'} title="Lên">↑</button><button data-dn="${s.id}" ${i < arr.length - 1 ? '' : 'disabled'} title="Xuống">↓</button></span><button class="x" data-delstep="${s.id}" title="Xoá bước">×</button>`
          : `${s.pic ? `<small>${esc(person(s.pic).short)}</small>` : ''}${s.due ? `<small>${dmy(s.due)}</small>` : ''}`}
        ${s.done && s.doneAt ? `<small class="wd-done">✓ ${esc(person(s.by).short)} ${dmy(new Date(Date.parse(s.doneAt) + 7 * 36e5).toISOString().slice(0, 10))}</small>` : ''}</div>`).join('')}
      ${ed ? `<form class="wd-add" id="wdAdd"><textarea id="wdStep" rows="1" placeholder="+ Thêm bước (dán nhiều dòng = nhiều bước)"></textarea><button class="btn">Thêm</button></form>` : ''}</div>
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
    const stepPatch = (sid, label, fn) => workOp(label + ' ' + it.id, d => { const x = d.items.find(i => i.id === it.id), st = x && x.steps.find(z => z.id === sid); if (st) fn(x, st); });
    m.querySelectorAll('[data-stxt]').forEach(el => el.addEventListener('blur', () => { const t = el.textContent.trim(), old = it.steps.find(z => z.id === el.dataset.stxt); if (!t || !old || t === old.t) return; stepPatch(el.dataset.stxt, 'sửa bước', (x, st) => { logTo(x, `Sửa bước: “${st.t}” → “${t}”`, { kind: 'edit' }); st.t = t; }); }));
    m.querySelectorAll('[data-stxt]').forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } }));
    m.querySelectorAll('[data-spic]').forEach(el => el.onchange = () => stepPatch(el.dataset.spic, 'giao bước', (x, st) => { st.pic = el.value || null; logTo(x, `Giao bước “${st.t}” cho ${el.value ? person(el.value).name : 'PIC chính'}`, { kind: 'assign' }); }));
    m.querySelectorAll('[data-sdue]').forEach(el => el.onchange = () => stepPatch(el.dataset.sdue, 'hạn bước', (x, st) => { st.due = el.value; }));
    m.querySelectorAll('[data-up],[data-dn]').forEach(b => b.onclick = () => { const sid = b.dataset.up || b.dataset.dn, dir = b.dataset.up ? -1 : 1; workOp('sắp xếp bước ' + it.id, d => { const x = d.items.find(i => i.id === it.id), k = x.steps.findIndex(z => z.id === sid), j = k + dir; if (k < 0 || j < 0 || j >= x.steps.length) return; [x.steps[k], x.steps[j]] = [x.steps[j], x.steps[k]]; }).then(() => openItem(it.id)); });
    m.querySelectorAll('[data-delstep]').forEach(b => b.onclick = () => workOp('xoá bước ' + it.id, d => { const x = d.items.find(i => i.id === it.id); const s = x.steps.find(s => s.id === b.dataset.delstep); x.steps = x.steps.filter(z => z !== s); logTo(x, 'Xoá bước: ' + (s && s.t), { kind: 'edit' }); }).then(() => openItem(it.id)));
    if (q('#wdAdd')) { const ta = q('#wdStep'); ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }); ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); q('#wdAdd').requestSubmit(); } });
      q('#wdAdd').onsubmit = e => { e.preventDefault(); const lines = ta.value.split('\n').map(x => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean); if (!lines.length) return; workOp('thêm bước ' + it.id, d => { const x = d.items.find(i => i.id === it.id); x.steps = x.steps || []; lines.forEach(t => x.steps.push({ id: uid('s'), t, done: false })); logTo(x, lines.length > 1 ? `Chia thành ${lines.length} bước: ${lines.join(' · ')}` : 'Thêm bước: ' + lines[0], { kind: 'update' }); if (x.status === 'todo' && x.pic === H.me.id) x.status = 'doing'; }).then(() => { openItem(it.id); setTimeout(() => { const n = document.querySelector('#wdStep'); if (n) n.focus(); }, 80); }); }; }
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
      ${sec('📅 Đến hạn trong 2 ngày', act.filter(i => i.due && daysTo(i.due) >= 0 && daysTo(i.due) <= 2), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — hạn ${dmy(i.due)}, ${progress(i)}% (${esc(person(i.pic).short)})</li>`)}
      ${sec('✎ Chờ PIC chia bước', act.filter(i => health(i).k === 'split'), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — ${esc(person(i.pic).short)}</li>`)}
      ${sec('🔕 Chưa cập nhật > 2 ngày', act.filter(i => health(i).k === 'silent'), i => `<li><a href="#" data-openw="${i.id}">${esc(i.title)}</a> — ${esc(person(i.pic).short)}</li>`)}
      ${sec('↻ Cập nhật mới', recent, x => `<li><b>${esc(person(x.l.by).short)}</b> · <a href="#" data-openw="${x.i.id}">${esc(x.i.title)}</a>: ${esc(x.l.text)}</li>`)}
      ${!act.length ? '<p>Chưa có việc nào. Bấm "+ Giao việc / dự án" để bắt đầu — có sẵn mẫu Sabi Lab và Shopee Mall.</p>' : ''}
      <div class="foot"><button class="btn ghost" data-close>Đóng</button><button class="btn pri" id="dlGo">Mở Công việc</button></div></div>`, m => {
      m.querySelector('#dlGo').onclick = () => { H.closeModal(); H.goto('work'); };
      m.querySelectorAll('[data-openw]').forEach(a => a.onclick = e => { e.preventDefault(); H.closeModal(); H.goto('work'); setTimeout(() => openItem(a.dataset.openw), 60); });
    });
  } else {
    const mine = act.filter(i => i.pic === H.me.id || myStep(i));
    H.modal(`<div class="daily"><h3>☀ Cập nhật hôm nay · ${dmy(today())}</h3><p class="sub">Mỗi việc 1–2 dòng: hôm nay làm gì, đến bước nào, vướng gì. Quản lý sẽ thấy ngay.</p>
      ${mine.map(i => { const ns = (i.steps || []).find(s => !s.done && (s.pic === H.me.id || (!s.pic && i.pic === H.me.id))) || nextStep(i), d = daysTo(i.due); return `<div class="dc" data-id="${i.id}"><div class="dc-h"><b>${esc(i.title)}</b><span class="sub">${progress(i)}% · ${health(i).t}${d != null && d >= 0 && d <= 2 ? ' · ⏰ hạn ' + dmy(i.due) : ''}</span></div>${ns ? `<label class="dc-ns"><input type="checkbox" data-tick="${ns.id}"> Đã xong bước: ${esc(ns.t)}</label>` : `<label class="dc-split">✎ Việc này chưa có bước — chia luôn (mỗi dòng 1 bước):<textarea rows="3" data-split placeholder="Bước 1…&#10;Bước 2…"></textarea></label>`}<textarea rows="2" placeholder="Hôm nay…"></textarea><label class="dc-bl"><input type="checkbox" data-bl> Đang vướng (ghi lý do ở trên)</label></div>`; }).join('') || '<p>Bạn chưa có việc nào đang chạy.</p>'}
      ${recent.length ? `<h4>↻ Mới từ team</h4><ul class="dl">${recent.slice(0, 5).map(x => `<li><b>${esc(person(x.l.by).short)}</b> · ${esc(x.i.title)}: ${esc(x.l.text)}</li>`).join('')}</ul>` : ''}
      <div class="foot"><button class="btn ghost" data-close>Để sau</button>${mine.length ? '<button class="btn pri" id="dcGo">Gửi cập nhật</button>' : ''}</div></div>`, m => {
      const go = m.querySelector('#dcGo'); if (!go) return;
      go.onclick = () => {
        const ups = [...m.querySelectorAll('.dc')].map(el => ({ id: el.dataset.id, text: el.querySelector('textarea:not([data-split])').value.trim(), split: el.querySelector('[data-split]') ? el.querySelector('[data-split]').value.split('\n').map(x => x.trim()).filter(Boolean) : [], tick: el.querySelector('[data-tick]') && el.querySelector('[data-tick]').checked ? el.querySelector('[data-tick]').dataset.tick : null, bl: el.querySelector('[data-bl]').checked })).filter(u => u.text || u.tick || u.split.length);
        if (!ups.length) return H.toast('Nhập ít nhất một cập nhật');
        H.closeModal();
        workOp('cập nhật hằng ngày', d => { for (const u of ups) { const x = d.items.find(i => i.id === u.id); if (!x) continue; if (u.split.length) { x.steps = x.steps || []; u.split.forEach(t => x.steps.push({ id: uid('s'), t, done: false })); logTo(x, `Chia thành ${u.split.length} bước: ${u.split.join(' · ')}`, { kind: 'update' }); } if (u.tick) { const s = x.steps.find(s => s.id === u.tick); if (s && !s.done) { s.done = true; s.doneAt = H.now(); s.by = H.me.id; logTo(x, '✓ Xong bước: ' + s.t, { kind: 'update' }); } }
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
    X.loaded = false; await refresh(true); X.loaded = true; X.ready = true; if (root) paint(); startPolling();
    await seed();
    setTimeout(() => daily(false), 900);
  },
  mount(el, view) { root = el; root.dataset.view = view; paint(); },
  unmount() { root = null; },
  refresh, openItem, daily, avatar, setAvatar,
  badges: () => ({ chat: H ? chatUnread() : 0, work: H ? myWorkBadge() : 0 })
};
})();
