/* LF Command Center — app (login, data loading, views, task actions) */
(() => {
'use strict';
const CFG = window.CC_CONFIG;
const PB = window.CCPB || { routines: [], messages: {}, meta: {} }, E = window.CCE;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} } };
const nfVN = new Intl.NumberFormat('vi-VN');
const vnd = v => nfVN.format(Math.round(v || 0)) + '₫';
const vndS = v => { const a = Math.abs(v || 0); return a >= 1e9 ? (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ' : a >= 1e6 ? (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr' : a >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v || 0)); };
const usd = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v || 0)).toLocaleString('en-US');
const pct = (v, d = 0) => v == null || !isFinite(v) ? '–' : (v * 100).toLocaleString('vi-VN', { maximumFractionDigits: d }) + '%';
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '–';
const dt = ts => { if (!ts) return '–'; const d = new Date(new Date(ts).getTime() + 7 * 36e5); return d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7) + ' ' + d.toISOString().slice(11, 16); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hexd = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const OWN = E.OWNERS, SEVN = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low' };
const isDemo = /[?&]demo=1/.test(location.search);
// how staff address the manager (anh / chị), set in Cài đặt; applied to every template and playbook text
const PRON = () => store.get('mp-pron') || 'anh';
const vx = t => String(t ?? '').replace(/[cC]hị Nhi/g, m => m[0] === 'C' ? PRON()[0].toUpperCase() + PRON().slice(1) : PRON()).replace(/(^|[^\p{L}])([cC])hị(?=[^\p{L}]|$)/gu, (m, p, c) => p + (c === 'C' ? PRON()[0].toUpperCase() + PRON().slice(1) : PRON()));

/* ---------------- storage & loading (GitHub repo, encrypted) ---------------- */
const ST = window.CCS;
const FILES = { G: 'data/events-global.enc.json', L: 'data/events-local.enc.json', M: 'data/events-mgr.enc.json' };
const MGR_OPS = ['assign', 'deadline', 'approve', 'reopen', 'remind', 'warn', 'praise', 'dismiss', 'routine.set'];
const chanKey = ch => ch === 'global' ? 'G' : ch === 'local' ? 'L' : 'M';
const sigBody = e => JSON.stringify([e.eid || e.id, e.ts, e.user, e.op, e.ref || '', e.channel || '', e.data || {}]);
async function openWith(raw, file) { const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(file.iv) }, k, b64d(file.ct)))); }
async function api(op, body = {}) {
  if (isDemo) return demoApi(op, body);
  const K = S.me.keys || {};
  try {
    if (op === 'events.list') {
      const out = []; S.tamper = [];
      for (const k of ['G', 'L', 'M']) {
        if (!K[k]) continue;
        const d = await ST.readEnc(FILES[k], K[k], { events: [] }), evs = d.events || [];
        if (K.M) { const lk = 'mp-evn-' + k, prev = +(store.get(lk) || 0); if (evs.length < prev) S.tamper.push(`Nhật ký ${k === 'G' ? 'Global' : k === 'L' ? 'Local' : 'quản lý'} giảm từ ${prev} xuống ${evs.length} bản ghi (có thể bị xoá)`); store.set(lk, Math.max(prev, evs.length)); }
        for (const e of evs) {
          e.eid = e.eid || e.id;
          if (MGR_OPS.includes(e.op)) {
            if (K.M) { if (!e.sig || e.sig !== await ST.hmac(K.M, sigBody(e))) { S.tamper.push(`Bản ghi "${e.op}" ${e.ref || ''} của ${e.user} không có chữ ký quản lý hợp lệ — đã bỏ qua`); continue; } }
            else if (e.role !== 'manager') continue;
          }
          out.push(e);
        }
      }
      out.sort((x, y) => String(x.ts).localeCompare(String(y.ts))); out.forEach((e, i) => { e.id = i + 1; });
      return { ok: true, events: out };
    }
    if (op === 'event.add') {
      const ev = body.ev, mgr = S.me.role === 'manager';
      if (!mgr && !['ack', 'progress', 'done', 'note'].includes(ev.op)) return { ok: false, err: 'Không có quyền' };
      const channel = mgr ? (ev.channel || '') : S.me.channel, k = chanKey(channel);
      if (!K[k]) return { ok: false, err: 'Không có quyền ghi kênh này' };
      const data = { ...(ev.data || {}) }; if (data.link && !/^https?:\/\//.test(data.link)) delete data.link;
      const e = { eid: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: ST.now(), user: S.me.id, role: S.me.role, channel, op: ev.op, ref: ev.ref || '', data };
      if (mgr) e.sig = await ST.hmac(K.M, sigBody(e));
      await ST.updateEnc(FILES[k], K[k], d => { d.events = d.events || []; d.events.push(e); return d; }, `log: ${S.me.id} ${e.op} ${e.ref}`, { events: [] });
      if (K.M) store.set('mp-evn-' + k, +(store.get('mp-evn-' + k) || 0) + 1);
      return { ok: true, ev: { ...e, id: (S.events.length ? Math.max(...S.events.map(x => x.id)) : 0) + 1 } };
    }
    if (op === 'snaps.list') { if (!K.M) return { ok: true, snaps: [] }; const d = await ST.readEnc('data/snaps.enc.json', K.M, { snaps: [] }); return { ok: true, snaps: d.snaps || [] }; }
    if (op === 'snapshot') { if (!K.M || !ST.hasToken()) return { ok: false }; await ST.updateEnc('data/snaps.enc.json', K.M, d => { d.snaps = (d.snaps || []).concat({ ts: ST.now(), keys: body.snap.keys, issues: body.snap.issues, brief: body.snap.brief }).slice(-60); return d; }, 'snapshot ' + E.todayVN(), { snaps: [] }); return { ok: true }; }
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
  return { ok: false, err: 'op' };
}
async function login(user, pass) {
  await ST.syncClock();
  const f = await ST.getFile('data/vault.json'); if (!f) throw new Error('Chưa có dữ liệu tài khoản');
  const b = await ST.openSlot(JSON.parse(f.text), user, pass); b.username = user.trim().toLowerCase(); return b;
}
async function unlock(me) { // team token + source data keys, each readable only with the right key
  if (isDemo) return; const K = me.keys || {};
  ST.setToken(null);
  if (K.S) { try { const t = await ST.readEnc('data/token.enc.json', K.S, {}); ST.setToken(t.t || null); } catch (e) {} }
  me.lg = null; me.lf = null;
  if (K.G) { try { me.lg = (await ST.readEnc('data/src-global.enc.json', K.G, {})).lg || null; } catch (e) {} }
  me.nk = null;
  if (K.L) { try { const x = await ST.readEnc('data/src-local.enc.json', K.L, {}); me.lf = x.lf || null; me.nk = x.nikon || null; } catch (e) {} }
}
async function loadSources(me) {
  const out = { G: null, L: null, gErr: null, lErr: null, gUpd: null, lUpd: null };
  if (isDemo) { const d = window.CCDEMO(); if (me.lg) out.G = d.G; if (me.lf) { out.L = d.L; out.N = d.L; } return out; }
  const K = me.keys || {};
  const job = async (url, fn) => { const r = await fetch(url + '?ts=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const f = await r.json(); return { data: await fn(f), upd: f.updated }; };
  await Promise.all([
    K.G ? (me.lg ? job(CFG.SRC_GLOBAL, f => openWith(b64d(me.lg), f)).then(x => { out.G = x.data; out.gUpd = x.upd; }).catch(e => { out.gErr = 'Không giải mã được dữ liệu Lignarc: ' + (e.message || e); }) : (out.gErr = 'Chưa kết nối dữ liệu Lignarc — quản lý vào Cài đặt › Kết nối dữ liệu nguồn', null)) : null,
    K.L && me.nk ? job(CFG.SRC_NIKON, f => openWith(ST.b64d(me.nk), f)).then(x => { out.N = x.data; out.nUpd = x.upd; }).catch(e => { out.nErr = 'Không giải mã được dữ liệu Nikon: ' + (e.message || e); }) : null,
    K.L ? (me.lf ? job(CFG.SRC_LOCAL, f => openWith(hexd(me.lf), f)).then(x => { out.L = x.data; out.lUpd = x.upd; }).catch(e => { out.lErr = 'Không giải mã được dữ liệu Shopee: ' + (e.message || e); }) : (out.lErr = 'Chưa kết nối dữ liệu Shopee — quản lý vào Cài đặt › Kết nối dữ liệu nguồn', null)) : null
  ]);
  return out;
}

/* ---------------- demo backend (localStorage) ---------------- */
function demoApi(op, body) {
  const evs = JSON.parse(store.get('cc-demo-ev') || '[]');
  if (op === 'events.list') return { ok: true, events: S.me.role === 'manager' ? evs : evs.filter(e => e.channel === S.me.channel || e.user === S.me.id) };
  if (op === 'snaps.list') return { ok: true, snaps: [] };
  if (op === 'snapshot') return { ok: true };
  if (op === 'event.add') { const ev = { id: evs.length + 1, ts: new Date().toISOString(), user: S.me.id, role: S.me.role, channel: S.me.role === 'manager' ? (body.ev.channel || '') : S.me.channel, op: body.ev.op, ref: body.ev.ref, data: body.ev.data || {} }; evs.push(ev); store.set('cc-demo-ev', JSON.stringify(evs)); return { ok: true, ev }; }
  return { ok: false };
}
const DEMO_USERS = { manager: { id: 'khoimr11', username: 'khoimr11', name: 'Khoi Bui', role: 'manager', channel: '', lg: 1, lf: 1, keys: {} }, trang: { id: 'trang', username: 'trangnguyen', name: OWN.trang.name, role: 'staff', channel: 'global', lg: 1, keys: {} }, phu: { id: 'phu', username: 'phunguye', name: OWN.phu.name, role: 'staff', channel: 'local', lf: 1, keys: {} } };

/* ---------------- state ---------------- */
const S = { me: null, tab: 'brief', src: null, G: null, L: null, issues: [], led: null, rout: [], events: [], snaps: [], f: { ch: 'all', sev: new Set(), owner: 'all', unassigned: false, kind: 'all' }, fx: +(store.get('cc-fx') || CFG.FX) };
const isMgr = () => S.me && S.me.role === 'manager';
const myOwner = () => S.me.channel === 'global' ? 'trang' : S.me.channel === 'local' ? 'phu' : null;

async function compute() {
  const src = S.src, me = S.me;
  try { S.G = src.G ? E.modelGlobal(src.G, { updated: src.gUpd }) : null; } catch (e) { S.G = null; src.gErr = 'Lỗi mô hình: ' + e.message; }
  try { S.L = src.L ? E.modelLocal(src.L, E.LOCAL_PLAN, { updated: src.lUpd }) : null; } catch (e) { S.L = null; src.lErr = 'Lỗi mô hình: ' + e.message; }
  try { S.N = src.N ? E.modelLocal(src.N, E.NIKON_PLAN, { updated: src.nUpd }) : null; } catch (e) { S.N = null; src.nErr = 'Lỗi mô hình Nikon: ' + e.message; }
  const closedKeys = new Set(E.ledger(S.events, [], []).tasks.filter(t => t.state === 'closed').map(t => t.issueKey));
  const K = me.keys || {}, hasG = isDemo ? !!me.lg : !!K.G, hasL = isDemo ? !!me.lf : !!K.L;
  let iss = E.detect(S.G, S.L, { fx: S.fx, closedKeys, globalErr: hasG ? src.gErr : null, localErr: hasL ? src.lErr : null, nikonErr: hasL && me.nk ? src.nErr : null }, S.N);
  if (isMgr() && !isDemo) {
    if ((S.tamper || []).length) iss.unshift({ key: 'X-LOG-TAMPER', rule: 'X-LOG-TAMPER', channel: 'system', owner: 'manager', sev: 'P0', effSev: 'P0', kind: 'issue', title: 'Nhật ký giao việc có dấu hiệu bị chỉnh sửa', detail: S.tamper.join(' · '), steps: ['Mở lịch sử commit của repo Manage-Performance (thư mục data/) để xem ai sửa', 'Đổi GitHub token nếu cần', 'Trao đổi trực tiếp với nhân viên liên quan'], closeWhen: 'Không còn bản ghi lỗi chữ ký', score: 9999 });
    if (!ST.hasToken()) iss.unshift({ key: 'X-NO-TOKEN', rule: 'X-NO-TOKEN', channel: 'system', owner: 'manager', sev: 'P1', effSev: 'P1', kind: 'issue', title: 'Chưa có GitHub token: chưa ai lưu được giao việc / Sheet', detail: 'Vào Cài đặt › GitHub token, dán fine-grained token của repo Manage-Performance (quyền Contents: Read and write).', steps: ['Tạo token tại github.com/settings/personal-access-tokens', 'Dán vào Cài đặt › GitHub token'], closeWhen: 'Có token hợp lệ', score: 5000 });
  }
  if (!isMgr()) iss = iss.filter(i => i.owner === myOwner() || (i.channel === me.channel));
  for (const i of iss) { const m = PB.meta[i.rule]; if (m) { i.why = vx(i.why || m.why); i.pbSteps = m.steps; } i.title = vx(i.title); i.steps = (i.steps || []).map(vx); i.closeWhen = vx(i.closeWhen); }
  S.issues = iss;
  S.led = E.ledger(S.events, S.issues, S.snaps);
  const defs = (PB.routines.length ? PB.routines : E.ROUTINES).filter(r => isMgr() || r.owner === myOwner()).map(r => ({ ...r, title: vx(r.title), evidence: vx(r.evidence) }));
  S.rout = E.routines(defs, S.issues, S.events);
}
async function loadEvents() {
  const r = await api('events.list'); S.events = r.ok ? r.events : []; S.apiErr = r.ok ? null : r.err;
  const s = await api('snaps.list'); S.snaps = s.ok ? s.snaps : [];
}
async function snapshotOncePerDay(force) {
  if (!isMgr() || isDemo) return; const k = 'cc-snap-' + E.todayVN(); if (store.get(k) && !force) return;
  const snap = { at: new Date().toISOString(), keys: S.issues.map(i => i.key), issues: S.issues.filter(i => i.kind === 'issue').map(i => ({ sev: i.effSev, owner: OWN[i.owner] ? OWN[i.owner].short : i.owner, title: i.title, age: i.age })), brief: briefLines().map(x => x.replace(/<[^>]+>/g, '')) };
  const r = await api('snapshot', { snap }); if (r.ok) store.set(k, '1'); return { ok: r.ok, issues: snap.keys.length, p0: S.issues.filter(i => i.effSev === 'P0').length };
}
// For an automated run (e.g. a scheduled task in Chrome after the afternoon syncs): reload sources, recompute, store today's snapshot for the 08:15 email.
window.CC_SNAPSHOT = async () => { if (!S.me) return { ok: false, err: 'not logged in' }; S.src = await loadSources(S.me); await loadEvents(); await compute(); render(); return snapshotOncePerDay(true); };

/* ---------------- small UI helpers ---------------- */
const sevTag = s => `<span class="sev ${s}" title="${SEVN[s]}">${s}</span>`;
const kpi = (label, val, meta = '', info = '') => `<div class="kpi card glass"><div class="lbl"><span>${label}</span>${info ? `<span class="info" title="${esc(info)}">i</span>` : ''}</div><div class="val">${val}</div><div class="meta">${meta}</div></div>`;
const card = (title, sub, body, extra = '') => `<section class="card glass"><div class="card-head"><div><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${extra}</div>${body}</section>`;
const delta = (a, b, inv) => { if (!b || Math.abs(b) * 5 < Math.abs(a)) return b ? '<span class="delta flat">mới tăng mạnh</span>' : ''; const d = (a - b) / Math.abs(b); const up = d >= 0; return `<span class="delta ${Math.abs(d) < .005 ? 'flat' : (up !== !!inv) ? 'up' : 'down'}">${up ? '▲' : '▼'} ${pct(Math.abs(d))}</span>`; };
const bar = (p, color) => `<div class="bar-track"><i style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%;${color ? 'background:' + color : ''}"></i></div>`;
function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }
function modal(html, bind) { const root = $('#modalRoot'); root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="box glass">${html}</div></div>`; const m = root.firstChild; m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) root.innerHTML = ''; }); if (bind) bind(m); const f = m.querySelector('input,textarea,select'); if (f) setTimeout(() => f.focus(), 30); return m; }
const closeModal = () => { $('#modalRoot').innerHTML = ''; };
async function copy(t) { try { await navigator.clipboard.writeText(t); toast('Đã copy tin nhắn — dán vào Zalo'); } catch (e) { toast('Không copy được, hãy chọn và copy thủ công'); } }
function fill(tpl, v) { return vx(String(tpl || '')).replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m); }
const ageTxt = i => i.age == null ? '' : i.age === 0 ? 'hôm nay' : i.age + ' ngày';
const ownerName = id => OWN[id] ? OWN[id].short : id;

/* ---------------- brief lines ---------------- */
function briefLines() {
  const out = [], G = S.G, L = S.L, iss = S.issues.filter(i => i.kind === 'issue');
  if (G) out.push(`<b>Global:</b> doanh thu MTD ${usd(G.mtd.rev)}${G.tgt.rev ? ` = <b>${pct(G.mtd.rev / G.pace)}</b> tiến độ target, dự phóng ${usd(G.proj)} / ${usd(G.tgt.rev)}` : ''} · margin 30 ngày ${pct(G.l30.margin, 1)} · % Mkt ${pct(G.l30.mktPct, 1)}.`);
  if (L) out.push(`<b>Local:</b> ${L.mtd.units}/${L.tgtUnits || '–'} kệ tháng này = <b>${L.paceUnits ? pct(L.mtd.units / L.paceUnits) : '–'}</b> tiến độ, dự phóng ${Math.round(L.projUnits)} kệ · thực thu ${vnd(L.l30.unitNet)}/kệ (target ${vnd(L.plan.netPerUnit)}) · kho còn ~${L.whStock} kệ.`);
  const p0 = iss.filter(i => i.effSev === 'P0').length, od = S.led ? S.led.tasks.filter(t => t.overdue).length : 0, miss = iss.filter(i => i.missReport).length, un = iss.filter(i => !i.task && (i.effSev === 'P0' || i.effSev === 'P1')).length;
  out.push(`<b>Việc:</b> ${p0} issue Critical · ${un} issue P0/P1 chưa giao · ${od} việc quá hạn · <b>${miss}</b> issue nghiêm trọng nhân viên chưa báo.`);
  return out;
}

/* ---------------- views ---------------- */
const TABS_M = [['brief', 'Tổng quan', 'M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z'], ['global', 'Global', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z'], ['local', 'Kệ 3 tầng', 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'], ['nikon', 'Nikon', 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], ['radar', 'Issue Radar', 'M12 3 2.5 20h19L12 3zm0 6v5m0 3v.5'], ['tasks', 'Việc từ issue', 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9'], ['team', 'Nhân sự', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'], ['routine', 'Định kỳ', 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'], ['sheet', 'Sheet', 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18']];
const TI = Object.fromEntries(TABS_M.map(t => [t[0], t]));
TI.work = ['work', 'Công việc', 'M9 5H5v4h4zM9 15H5v4h4zM13 7h6M13 17h6M5.5 12h13']; TI.chat = ['chat', 'Chat', 'M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.4A8 8 0 1 1 21 12z'];
const TABS_MGR = ['brief', 'work', 'chat', 'global', 'local', 'nikon', 'radar', 'tasks', 'team', 'routine', 'sheet'];
const TABS_STAFF = ch => ['brief', 'work', 'chat', ...(ch === 'global' ? ['global'] : ['local', 'nikon']), 'radar', 'tasks', 'routine', 'team', 'sheet'];
const TAB_LABEL_STAFF = { radar: 'Issue của tôi', tasks: 'Việc từ issue', team: 'Điểm của tôi' };
function renderTabs() {
  const T = (isMgr() ? TABS_MGR : TABS_STAFF(S.me.channel)).map(k => isMgr() || !TAB_LABEL_STAFF[k] ? TI[k] : [k, TAB_LABEL_STAFF[k], TI[k][2]]), badge = { radar: S.issues.filter(i => i.effSev === 'P0' && i.kind === 'issue').length, tasks: S.led.tasks.filter(t => isMgr() ? t.state === 'review' || t.overdue : t.state !== 'closed').length, chat: (S.badge || {}).chat || 0, work: (S.badge || {}).work || 0 };
  $('#tabs').innerHTML = T.map(([k, l, d]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg><span class="l">${l}</span>${badge[k] ? `<b class="sev P0" style="min-width:20px;height:18px;font-size:10.5px">${badge[k]}</b>` : ''}</button>`).join('');
}
function render() {
  renderTabs();
  if (S.tab === 'work' || S.tab === 'chat') { window.CCSheet.unmount(); $('#view').innerHTML = `<section id="cxRoot" class="cx-root ${S.tab}"></section>`; $('#view').onclick = null; window.CCX.mount($('#cxRoot'), S.tab); return; }
  window.CCX.unmount();
  if (S.tab === 'sheet') { $('#view').innerHTML = '<section id="sheetRoot" class="sheet-root"></section>'; window.CCSheet.mount($('#sheetRoot'), S.sheetHost); $('#view').onclick = null; return; }
  window.CCSheet.unmount();
  const v = { brief: viewBrief, global: viewGlobal, local: viewLocal, nikon: viewNikon, radar: viewRadar, tasks: viewTasks, team: viewTeam, routine: viewRoutine }[S.tab] || viewBrief;
  $('#view').innerHTML = v(); bindView();
}
function freshPill(label, iso, err) {
  if (err) return `<span class="pill crit"><i></i>${label}: lỗi đọc dữ liệu</span>`;
  if (!iso) return `<span class="pill muted"><i></i>${label}: –</span>`;
  const h = (Date.now() - Date.parse(iso)) / 36e5; return `<span class="pill ${h > 26 ? 'crit' : h > 20 ? 'warn' : 'good'}"><i></i>${label}: cập nhật ${dt(iso)}</span>`;
}
function issueRow(i, compact) {
  const mgr = isMgr(), t = i.task;
  const tags = [i.kind === 'opportunity' ? '<span class="tag good">Cơ hội</span>' : '', i.missReport ? '<span class="tag bad">Miss báo cáo</span>' : '', i.slaBreached ? `<span class="tag bad">Quá SLA ${i.sla * 24}h${i.effSev !== i.sev ? ' → nâng ' + i.sev + '→' + i.effSev : ''}</span>` : '', t ? `<span class="tag">${esc(t.id)} · ${t.state === 'review' ? 'chờ duyệt' : 'đã giao'}</span>` : '', i.ackAt ? `<span class="tag good">NV đã nắm ${dt(i.ackAt)}</span>` : ''].join('');
  const steps = (i.steps || []).map(s => `<li>${esc(s)}</li>`).join('');
  const acts = mgr ? `${t ? `<button class="btn ghost" data-goto="tasks">Xem việc</button>` : `<button class="btn pri" data-assign="${esc(i.key)}">Giao việc</button>`}${!t ? `<button class="btn ghost" data-dismiss="${esc(i.key)}" title="Bỏ qua (ghi log lý do)">Bỏ qua</button>` : ''}`
    : `${!i.ackAt && !t ? `<button class="btn pri" data-ack="${esc(i.key)}">Em đã nắm</button>` : ''}`;
  return `<article class="issue${compact ? ' compact' : ''}"><div>${sevTag(i.effSev)}</div><div><h4>${esc(i.title)}</h4>
    <div class="meta"><span>${i.channel === 'global' ? 'Global' : i.channel === 'local' ? 'Local' : 'Hệ thống'}</span>·<span>${esc(ownerName(i.owner))}</span>${ageTxt(i) ? `·<span>tồn ${ageTxt(i)}</span>` : ''}${i.sla ? `·<span>SLA ${i.sla * 24}h</span>` : ''}${i.impactVnd ? `·<span>ảnh hưởng ~${vndS(i.impactVnd)}₫</span>` : ''}${tags}</div>
    ${i.detail && !compact ? `<div class="det">${esc(i.detail)}</div>` : ''}</div><div class="acts">${acts}</div>
    ${compact ? '' : `<details><summary>Next steps · điều kiện đóng</summary>${i.why ? `<p class="why"><b>Vì sao:</b> ${esc(i.why)}</p>` : ''}<ol>${steps}</ol><p class="why"><b>Tự đóng khi:</b> ${esc(i.closeWhen || '')}</p><p class="why" style="font-size:11.5px;color:var(--muted)">Mã luật ${esc(i.rule)}</p></details>`}</article>`;
}

function viewBrief() {
  const G = S.G, L = S.L, iss = S.issues, hello = new Date().getHours() < 11 ? 'Chào buổi sáng' : 'Xin chào';
  const top = iss.filter(i => !i.task && i.kind === 'issue').slice(0, 6), opp = iss.filter(i => i.kind === 'opportunity').slice(0, 3);
  const cards = S.led.cards, miss = iss.filter(i => i.missReport).length;
  const kp = [];
  if (G) kp.push(kpi('Global · Doanh thu MTD', usd(G.mtd.rev), `${G.tgt.rev ? pct(G.mtd.rev / G.tgt.rev) + ' target tháng · tiến độ ' + pct(G.mtd.rev / G.pace) : 'chưa có target'}${G.tgt.rev ? bar(G.mtd.rev / G.tgt.rev) : ''}`, 'Base cost × units, như dash Lignarc. Target: Cashflow 26+27'));
  if (G) kp.push(kpi('Global · Margin 30 ngày', pct(G.l30.margin, 1), `Profit ${usd(G.l30.profit)} ${delta(G.l30.profit, G.p30.profit)}`, 'Profit ÷ Revenue, sau COGS, phí, deduction, ads'));
  if (L) kp.push(kpi('Local · Kệ bán tháng này', `${L.mtd.units}<small>/ ${L.tgtUnits || '–'}</small>`, `tiến độ ${L.paceUnits ? pct(L.mtd.units / L.paceUnits) : '–'} · NMV ${vndS(L.mtd.nmv)}₫${L.tgtUnits ? bar(L.mtd.units / L.tgtUnits) : ''}`, 'Đơn không hủy. Target theo kế hoạch 2.700 kệ'));
  if (L) kp.push(kpi('Local · Thực thu / kệ', vnd(L.l30.unitNet), `target ${vnd(L.plan.netPerUnit)} · giá sàn ${vnd(L.plan.floorPrice)}`, '(Giá bán − voucher shop − phí sàn) ÷ số kệ, 30 ngày'));
  const nP0 = iss.filter(i => i.effSev === 'P0' && i.kind === 'issue').length, nP1 = iss.filter(i => i.effSev === 'P1' && i.kind === 'issue').length, od = S.led.tasks.filter(t => t.overdue).length, rv = S.led.tasks.filter(t => t.state === 'review').length;
  return `<div class="page-head"><div><h1>${hello}, ${esc(isMgr() ? (S.me.name || '').split(' ').pop() : S.me.name.split(' ').pop())}</h1><p>${new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
    <div class="fresh">${S.me.lg ? freshPill('Lignarc', S.G && S.G.updatedAt, S.src.gErr) : ''}${S.me.lf ? freshPill('Kệ 3 tầng', S.L && S.L.updatedAt, S.src.lErr) : ''}${S.me.nk || (isDemo && S.me.lf) ? freshPill('Nikon', S.N && S.N.updatedAt, S.src.nErr) : ''}${S.apiErr ? `<span class="pill warn"><i></i>Sổ giao việc: ${esc(S.apiErr)}</span>` : ''}</div></div>
  <section class="card glass"><h3>Tóm tắt sáng nay</h3><div class="brief-lines">${briefLines().map(x => `<div>${x}</div>`).join('')}</div></section>
  <div class="grid g-kpi">${kp.join('')}</div>
  <div class="grid g-kpi">${kpi('Issue Critical (P0)', `<span style="color:var(--crit-ink)">${nP0}</span>`, `${nP1} High (P1)`)}${kpi('Việc quá hạn', String(od), `${S.led.tasks.filter(t => t.state !== 'closed').length} việc đang mở`)}${kpi('Chờ ' + PRON() + ' duyệt', String(rv), 'Nhân viên báo xong, cần đối chiếu')}${kpi('Miss báo cáo', `<span style="color:${miss ? 'var(--crit-ink)' : 'inherit'}">${miss}</span>`, 'Issue P0/P1 quá 24h nhân viên chưa báo')}</div>
  <div class="grid g-21">
    ${card('Cần quyết ngay', 'Issue chưa giao, xếp theo mức độ × tiền bị ảnh hưởng × số ngày tồn', top.length ? top.map(i => issueRow(i, true)).join('') : '<div class="empty2">Không có issue mở 🎉</div>', `<button class="btn ghost" data-goto="radar">Xem tất cả ${iss.length}</button>`)}
    <div class="grid" style="align-content:start">
      ${isMgr() ? ['trang', 'phu'].map(id => { const c = cards[id]; return card(esc(c.name), id === 'trang' ? 'Global · Wayfair / Amazon' : 'Local · Shopee', `<div class="score"><div class="ring2" style="--p:${c.score};--c:${c.score >= 80 ? 'var(--good)' : c.score >= 60 ? 'var(--warn)' : 'var(--crit)'}"><div><b>${c.score}</b><span>/ 100</span></div></div><div class="statgrid" style="grid-template-columns:repeat(2,1fr)"><div class="stat ${c.p0 ? 'bad' : ''}"><b>${c.p0}</b><span>Issue P0</span></div><div class="stat ${c.overdue ? 'bad' : ''}"><b>${c.overdue}</b><span>Việc quá hạn</span></div><div class="stat ${c.missReport ? 'bad' : ''}"><b>${c.missReport}</b><span>Miss báo cáo</span></div><div class="stat"><b>${c.onTimeRate == null ? '–' : pct(c.onTimeRate)}</b><span>Đúng hạn</span></div></div></div>`, `<button class="btn ghost" data-goto="team">Chi tiết</button>`); }).join('') : ''}
      ${opp.length ? card('Cơ hội', 'Hệ thống gợi ý để tăng trưởng', opp.map(i => issueRow(i, true)).join('')) : ''}
    </div>
  </div>`;
}

function vbars(rows, fmt) {
  const max = Math.max(1, ...rows.map(r => Math.max(r.a, r.t)));
  return `<div class="vbars">${rows.map(r => `<div class="m" title="${esc(r.l)} · thực tế ${fmt(r.a)} · target ${fmt(r.t)}${r.t ? ' · ' + pct(r.a / r.t) : ''}"><span class="pc">${r.t && r.a ? pct(r.a / r.t) : ''}</span><div class="bar" style="height:${r.a / max * 140}px;${r.future ? 'opacity:.35' : ''}"></div>${r.t ? `<div class="tg" style="bottom:${r.t / max * 140}px"></div>` : ''}<span class="lb">${esc(r.l)}</span></div>`).join('')}</div><div class="legend2"><span><i style="background:var(--s1)"></i>Thực tế</span><span><i style="border-top:2px dashed var(--ink2);height:0;border-radius:0"></i>Target</span></div>`;
}
/* KPI from sheet "Cashflow 26+27" (Revenue, Units, Profit, MKT come from the Lignarc data; these are the extra plan lines) */
const GPLAN = {
  months: ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'],
  netRev: [10847, 19284, 6970, 34088, 45835, 101540, 126924, 118916, 130404, 216590, 333527, 336333, 364577, 344943, 286731],
  promo: [4726, 8256, 2431, 9625, 10736, 24098, 39897, 30750, 28994, 65214, 78943, 73829, 130208, 134257, 62122],
  ads: [889, 1743, 618, 2102, 2645, 5513, 9806, 7065, 6455, 14478, 17329, 16406, 29264, 26041, 14217]
};
const gp = (k, m) => { const i = GPLAN.months.indexOf(m); return i >= 0 ? GPLAN[k][i] : 0; };
const mLab = m => 'T' + (+m.slice(5, 7)) + '/' + m.slice(2, 4);
function ring(frac, label, color) {
  const r = 70, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return `<svg class="ring" viewBox="0 0 170 170"><circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--grid)" stroke-width="14"/><circle cx="85" cy="85" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 85 85)"/><text x="85" y="88" text-anchor="middle" style="font:750 32px var(--font);fill:var(--ink);letter-spacing:-1px">${esc(pct(frac))}</text><text x="85" y="110" text-anchor="middle" style="font:12px var(--font);fill:var(--muted)">${esc(label)}</text></svg>`;
}
function dbars(rows, key, fmt, color) {
  const max = Math.max(1, ...rows.map(r => r[key] || 0));
  return `<div class="dbars">${rows.map((r, i) => `<div class="db" title="${dmy(r.d)} · ${esc(fmt(r[key] || 0))}"><i style="height:${(r[key] || 0) / max * 100}%;background:${color || 'var(--s1)'}"></i>${i % 5 === 0 || i === rows.length - 1 ? `<span>${dmy(r.d)}</span>` : ''}</div>`).join('')}</div>`;
}
function hbars(list, fmt, n = 8, color) {
  const top = list.slice(0, n), max = Math.max(1, ...top.map(x => x.v)), tot = list.reduce((s, x) => s + x.v, 0) || 1;
  return `<div class="hb">${top.map(x => `<div class="hbr"><span class="hbl" title="${esc(x.l)}">${esc(x.l)}</span><div class="hbt"><i style="width:${x.v / max * 100}%;background:${color || 'var(--s1)'}"></i></div><b>${esc(fmt(x.v))}</b><em>${pct(x.v / tot)}</em></div>`).join('') || '<div class="empty2">Chưa có dữ liệu</div>'}</div>`;
}
function vs(a, t, inv) { if (!t) return ''; const r = a / t; return `<span class="delta ${(r >= 1) !== !!inv ? 'up' : 'down'}">${pct(r)} KH</span>`; }

function viewGlobal() {
  const G = S.G;
  if (!G) return `<div class="page-head"><div><h1>Global · Wayfair / Amazon</h1></div></div><section class="card glass"><div class="empty2">${esc(S.src.gErr || 'Chưa có dữ liệu Lignarc')}</div></section>`;
  const t = G.tgt, m = G.mtd, ym = G.ym, behind = m.rev < G.pace;
  const netT = gp('netRev', ym), promoT = gp('promo', ym), adsT = gp('ads', ym);
  const first = '2026-10', last = E.isoAdd(ym + '-01', 62).slice(0, 7);
  const months = G.months.filter(x => x.m >= first && x.m <= last);
  const d30 = G.daily(E.isoAdd(G.today, -29), G.today);
  const col = G.breakdown(E.isoAdd(G.today, -89), G.today, 'col').map(x => ({ l: x.k, v: x.rev }));
  const sku = G.breakdown(E.isoAdd(G.today, -89), G.today, 'sku');
  const kRows = G.months.filter(x => x.m >= first);
  return `<div class="page-head"><div><h1>Global · Wayfair / Amazon</h1><p>KPI theo sheet Cashflow 26+27 · USD · cập nhật ${S.G.updatedAt ? dt(S.G.updatedAt) : '–'} · phụ trách ${esc(OWN.trang.name)}</p></div><div class="fresh"><a class="btn ghost" href="${CFG.DASH_GLOBAL}" target="_blank" rel="noopener">Mở dash Lignarc ↗</a></div></div>
  <section class="hero card glass">${ring(t.rev ? m.rev / t.rev : 0, 'target ' + mLab(ym), behind ? 'var(--s2)' : 'var(--s4)')}
    <div><h2>Revenue ${mLab(ym)} · tháng đến hôm nay so với KPI</h2><div class="big">${usd(m.rev)} <span class="of">/ ${usd(t.rev)}</span></div>
    <div class="line">Ngày ${G.dNow}/${G.dIn}: tiến độ cần ${usd(G.pace)} · <b style="color:${behind ? 'var(--crit-ink)' : 'var(--good-ink)'}">${behind ? 'thiếu' : 'vượt'} ${usd(Math.abs(m.rev - G.pace))}</b> · dự phóng cả tháng ${usd(G.proj)} · cần ${usd(Math.max(0, (t.rev - m.rev) / Math.max(1, G.dIn - G.dNow + 1)))}/ngày còn lại</div>
    <div class="hero-stats"><div><b>${m.units} / ${t.unit || '–'}</b><span>Units / KPI</span></div><div><b>${usd(m.net)} / ${usd(netT)}</b><span>NMV / Net Rev KPI</span></div><div><b>${usd(m.profit)} / ${usd(t.profit)}</b><span>Profit / KPI</span></div><div><b>${pct(m.margin, 1)} / ${t.rev ? pct(t.profit / t.rev, 1) : '–'}</b><span>Margin / KPI</span></div><div><b>${pct(m.mktPct, 1)} / ${t.rev ? pct(t.mkt / t.rev, 1) : '–'}</b><span>% Mkt fee / KPI</span></div></div></div></section>
  <div class="grid g-kpi">
    ${kpi('Promotion (MTD)', usd(m.promo), `KPI ${usd(promoT)} ${vs(m.promo, promoT * G.dNow / G.dIn, true)}`, 'Revenue − NMV. So với KPI theo tiến độ ngày')}
    ${kpi('Ads spend (MTD)', usd(m.ads), `KPI ${usd(adsT)} ${vs(m.ads, adsT * G.dNow / G.dIn, true)}`, 'Wayfair Ads + Amazon Ads')}
    ${kpi('TACoS · ROAS 30 ngày', pct(G.l30.tacos, 1), `ROAS ${G.l30.roas ? G.l30.roas.toFixed(2) : '–'} · ACoS ${pct(G.l30.acos, 1)}`)}
    ${kpi('Returns + Incidents (MTD)', usd(m.returns + m.incidents), `Incident rate ${pct(G.incStats.incidentRate)} · BRR ${pct(G.incStats.brr)}`)}
  </div>
  <div class="grid g-21">
    ${card('Revenue so với KPI theo tháng', 'Cột: thực tế · gạch: KPI Cashflow 26+27', vbars(months.map(x => ({ l: mLab(x.m), a: x.act.rev, t: x.tgt, future: x.m > ym })), usd))}
    ${card('Doanh thu theo collection', '90 ngày gần nhất', hbars(col, usd, 6))}
  </div>
  ${card('Doanh thu theo ngày', '30 ngày gần nhất · Revenue (base cost)', dbars(d30, 'rev', usd) + `<div class="legend2" style="margin-top:22px"><span>Tổng 30 ngày ${usd(G.l30.rev)} · ${G.l30.units} units · ${G.l30.orders} đơn</span></div>`)}
  ${card('Bảng KPI theo tháng', 'Thực tế / KPI · tháng chưa tới hiển thị KPI', `<div class="tw"><table class="t kt"><thead><tr><th>Chỉ số</th>${kRows.map(x => `<th class="r ${x.m === ym ? 'cur' : ''}">${mLab(x.m)}</th>`).join('')}</tr></thead><tbody>
    ${[['Revenue', x => x.act.rev, x => x.tgt, usd], ['Units', x => x.act.units, x => x.tgtUnit, v => Math.round(v)], ['NMV / Net Rev', x => x.act.net, x => gp('netRev', x.m), usd], ['Profit', x => x.act.profit, x => (S.G.months.find(y => y.m === x.m) || {}).tgtProfit, usd], ['Promotion', x => x.act.promo, x => gp('promo', x.m), usd], ['Ads', x => x.act.ads, x => gp('ads', x.m), usd]].map(([lab, a, tg, f]) => `<tr><td><b>${lab}</b></td>${kRows.map(x => { const past = x.m <= ym, av = a(x), tv = tg(x); return `<td class="r ${x.m === ym ? 'cur' : ''}">${past ? `<b>${f(av)}</b><br><span class="sub">${tv ? f(tv) + ' · ' + pct(av / tv) : '–'}</span>` : `<span class="sub">${tv ? f(tv) : '–'}</span>`}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`)}
  <div class="grid g-2">
    ${card('Top SKU', '90 ngày · doanh thu · lợi nhuận gộp trước ads', `<div class="tw"><table class="t"><tr><th>SKU</th><th class="r">Units</th><th class="r">Revenue</th><th class="r">LN gộp</th></tr>${sku.slice(0, 10).map(x => `<tr><td><b>${esc(x.k)}</b><br><span class="sub">${esc(x.name)}</span></td><td class="r">${x.units}</td><td class="r">${usd(x.rev)}</td><td class="r" style="color:${x.gp < 0 ? 'var(--crit-ink)' : 'inherit'}">${usd(x.gp)}</td></tr>`).join('')}</table></div>`)}
    ${card('Tồn kho CastleGate & đồng hồ lưu kho', 'Cover = tồn ÷ tốc độ bán 30 ngày', `<div class="tw"><table class="t"><tr><th>SKU</th><th class="r">Tồn</th><th class="r">Bán 30N</th><th class="r">Cover</th></tr>${G.inv.filter(r => r.onHand || r.sold30).sort((a, b) => (a.coverDays ?? 1e9) - (b.coverDays ?? 1e9)).slice(0, 12).map(r => `<tr><td><b>${esc(r.part)}</b></td><td class="r">${r.onHand}</td><td class="r">${r.sold30}</td><td class="r">${r.coverDays == null ? '∞' : Math.round(r.coverDays) + 'n'}</td></tr>`).join('')}</table></div>${G.storage.length ? `<p class="sub" style="margin-top:10px">${G.storage.map(x => `<b>${esc(x.po)}</b>: hết miễn phí ${dmy(x.end)} (${x.daysLeft >= 0 ? 'còn ' + x.daysLeft : 'quá ' + -x.daysLeft} ngày) · còn ${x.units} units`).join('<br>')}</p>` : ''}`)}
  </div>
  ${issueMini('global')}`;
}

/* Kệ 3 tầng plan (target table): fees on Net GMV and monthly warehouse rent */
function viewLocal() {
  const L = S.L;
  if (!L) return `<div class="page-head"><div><h1>Local · Shopee kệ 3 tầng</h1></div></div><section class="card glass"><div class="empty2">${esc(S.src.lErr || 'Chưa có dữ liệu Shopee')}</div></section>`;
  const P = L.plan, m = L.mtd, ym = L.ym, tu = L.tgtUnits, behind = m.units < L.paceUnits;
  const rent = P.rent * L.dNow / L.dIn, netRev = m.nmv - m.fee - m.adCost, profit = netRev * 0.97 - rent;
  const planNet = tu * P.floorPrice, planNetRev = planNet * (1 - 0.3598 - 0.04) - 0 , planProfit = (planNet - planNet * 0.3598 - tu * 0 - planNet * 0.04) * 0.97 - P.rent;
  const d30 = L.daily(E.isoAdd(L.today, -29), L.today);
  const src = { fs: 0, other: 0 }; L.orders.filter(o => !o.cx && o.date > E.isoAdd(L.today, -30)).forEach(o => { if (o.fs) src.fs += o.v; else src.other += o.v; });
  const r30 = L.reviews.filter(r => r.date > E.isoAdd(L.today, -30)), avg = r30.length ? r30.reduce((s, r) => s + r.star, 0) / r30.length : null;
  return `<div class="page-head"><div><h1>Local · Shopee kệ 3 tầng</h1><p>Kế hoạch 2.700 kệ (T11/2026 → T5/2027) · VND · cập nhật ${L.updatedAt ? dt(L.updatedAt) : '–'} · phụ trách ${esc(OWN.phu.name)}</p></div><div class="fresh"><a class="btn ghost" href="${CFG.DASH_LOCAL}" target="_blank" rel="noopener">Mở dash Kệ 3 tầng ↗</a></div></div>
  <section class="hero card glass">${ring(tu ? m.units / tu : 0, 'kế hoạch ' + mLab(ym), behind ? 'var(--s2)' : 'var(--s4)')}
    <div><h2>Kệ bán ${mLab(ym)} · tháng đến hôm nay so với kế hoạch</h2><div class="big">${m.units} <span class="of">/ ${tu || '–'} kệ</span></div>
    <div class="line">Ngày ${L.dNow}/${L.dIn}: tiến độ cần ${Math.round(L.paceUnits)} kệ · <b style="color:${behind ? 'var(--crit-ink)' : 'var(--good-ink)'}">${behind ? 'thiếu' : 'vượt'} ${Math.abs(Math.round(m.units - L.paceUnits))} kệ</b> · dự phóng ${Math.round(L.projUnits)} kệ · cần ${Math.max(0, Math.ceil((tu - m.units) / Math.max(1, L.dIn - L.dNow + 1)))} kệ/ngày còn lại</div>
    <div class="hero-stats"><div><b>${vndS(m.nmv)}₫</b><span>NMV tháng</span></div><div><b>${vnd(L.l30.unitNet)}</b><span>Thực thu/kệ · KH ${vnd(P.netPerUnit)}</span></div><div><b>${vndS(profit)}₫ / ${vndS(planProfit)}₫</b><span>Profit (chưa COGS) / KH</span></div><div><b>${L.soldSince} / ${Math.round(L.planCum)}</b><span>Luỹ kế từ T11 / KH</span></div><div><b>${L.whStock}</b><span>Tồn kho Suối Nghệ (ước)</span></div></div></div></section>
  <div class="grid g-kpi">
    ${kpi('Giá bán TB / kệ (30N)', vnd(L.l30.asp), `giá sàn ${vnd(P.floorPrice)} · niêm yết ${vnd(P.listPrice)}`)}
    ${kpi('Phí sàn (30N)', pct(L.l30.take, 1), `KH ~36% Net GMV · voucher shop ${vndS(L.l30.sh)}₫`)}
    ${kpi('Hủy · Trả hàng (30N)', `${pct(L.l30.cxRate)} · ${pct(L.l30.retRate)}`, `${L.l30.cx} đơn hủy / ${L.l30.all} đơn`)}
    ${kpi('Ads Shopee (30N)', vndS(L.l30.adCost) + '₫', `${pct(L.l30.nmv ? L.l30.adCost / L.l30.nmv : null, 1)} NMV (KH 4%) · ROAS ${L.l30.roas ? L.l30.roas.toFixed(1) : '–'}`)}
  </div>
  <div class="grid g-21">
    ${card('Kệ bán so với kế hoạch theo tháng', 'Cột: thực tế · gạch: kế hoạch', vbars(L.months.map(x => ({ l: mLab(x.m), a: x.act.units, t: x.tgt, future: x.m > ym })), v => Math.round(v) + ' kệ'))}
    ${card('Nguồn doanh thu 30 ngày', 'Flash Sale so với giá thường', hbars([{ l: 'Flash Sale', v: src.fs }, { l: 'Giá KM / khác', v: src.other }], v => vndS(v) + '₫', 4, 'var(--s4)') + `<p class="sub" style="margin-top:12px">Rating 30 ngày: <b>${avg ? avg.toFixed(2) + '★' : '–'}</b> (${r30.length} đánh giá) · Tồn Shopee ${L.shopStock} kệ${L.coverDays ? ' ≈ ' + L.coverDays.toFixed(0) + ' ngày bán' : ''}</p>`)}
  </div>
  ${card('Kệ bán theo ngày', '30 ngày gần nhất', dbars(d30, 'units', v => v + ' kệ', 'var(--s4)') + `<div class="legend2" style="margin-top:22px"><span>Tổng 30 ngày ${L.l30.units} kệ · ${L.l30.orders} đơn · NMV ${vndS(L.l30.nmv)}₫</span></div>`)}
  ${card('P&L tháng này so với bảng target', 'Kế hoạch phân bổ theo số ngày đã qua · chưa gồm COGS', `<div class="tw"><table class="t"><tr><th>Hạng mục</th><th class="r">Thực tế MTD</th><th class="r">Kế hoạch tới hôm nay</th><th class="r">Kế hoạch cả tháng</th></tr>
    ${(() => { const k = L.dNow / L.dIn, pn = planNet, rows = [['Sản lượng (kệ)', m.units, tu * k, tu, v => Math.round(v)], ['Net GMV / NMV', m.nmv, pn * k, pn, vnd], ['Phí sàn', m.fee, pn * 0.3598 * k, pn * 0.3598, vnd], ['Quảng cáo', m.adCost, pn * 0.04 * k, pn * 0.04, vnd], ['Doanh thu thuần thực về', netRev, pn * 0.6002 * k, pn * 0.6002, vnd], ['Thuê kho Suối Nghệ', rent, P.rent * k, P.rent, vnd], ['Profit (chưa COGS)', profit, (pn * 0.6002 * 0.97 - P.rent) * k, pn * 0.6002 * 0.97 - P.rent, vnd], ['Thực thu / kệ', L.mtd.unitNet, P.netPerUnit, P.netPerUnit, vnd]]; return rows.map(([l, a, b, c, f]) => `<tr><td><b>${l}</b></td><td class="r"><b>${f(a)}</b></td><td class="r">${f(b)}</td><td class="r sub">${f(c)}</td></tr>`).join(''); })()}</table></div>`)}
  ${issueMini('local')}`;
}
function viewNikon() {
  const N = S.N;
  if (!N) return `<div class="page-head"><div><h1>Nikon Việt Nam · Shopee</h1></div></div><section class="card glass"><div class="empty2">${esc(S.src.nErr || 'Chưa kết nối dữ liệu Nikon — quản lý vào Cài đặt › Kết nối dữ liệu nguồn (tài khoản dash Local).')}</div></section>`;
  const m = N.mtd, pm = N.period(E.isoAdd(N.ym + '-01', -1).slice(0, 7) + '-01', E.isoAdd(N.ym + '-01', -1)), pmToDay = N.period(E.isoAdd(N.ym + '-01', -1).slice(0, 7) + '-01', E.isoAdd(N.ym + '-01', -1).slice(0, 7) + '-' + String(Math.min(N.dNow, 28)).padStart(2, '0'));
  const d30 = N.daily(E.isoAdd(N.today, -29), N.today), proj = N.dNow ? m.nmv / N.dNow * N.dIn : 0;
  const prods = {}; N.orders.filter(o => !o.cx && o.date > E.isoAdd(N.today, -30)).forEach(o => { const k = o.sku || o.m || 'Khác'; (prods[k] = prods[k] || { l: k, v: 0 }).v += o.v; });
  const r30 = N.reviews.filter(r => r.date > E.isoAdd(N.today, -30)), avg = r30.length ? r30.reduce((a, r) => a + r.star, 0) / r30.length : null;
  return `<div class="page-head"><div><h1>Nikon Việt Nam · Shopee</h1><p>VND · cập nhật ${N.updatedAt ? dt(N.updatedAt) : '–'} · so với cùng kỳ tháng trước</p></div><div class="fresh"><a class="btn ghost" href="${CFG.DASH_LOCAL}" target="_blank" rel="noopener">Mở dash Local ↗</a></div></div>
  <section class="hero card glass">${ring(pm.nmv ? proj / pm.nmv : 0, 'dự phóng / T trước', proj >= pm.nmv ? 'var(--s4)' : 'var(--s2)')}
    <div><h2>NMV ${mLab(N.ym)} · tháng đến hôm nay</h2><div class="big">${vndS(m.nmv)}₫ <span class="of">· cùng kỳ T trước ${vndS(pmToDay.nmv)}₫</span></div>
    <div class="line">Dự phóng cả tháng ${vndS(proj)}₫ so với tháng trước ${vndS(pm.nmv)}₫ ${delta(proj, pm.nmv)}</div>
    <div class="hero-stats"><div><b>${m.orders}</b><span>Đơn (MTD)</span></div><div><b>${m.units}</b><span>Sản phẩm (MTD)</span></div><div><b>${vnd(m.asp)}</b><span>Giá bán TB / sp</span></div><div><b>${pct(m.take, 1)}</b><span>Phí sàn</span></div><div><b>${avg ? avg.toFixed(2) + '★' : '–'}</b><span>Rating 30N (${r30.length})</span></div></div></div></section>
  <div class="grid g-kpi">
    ${kpi('NMV 30 ngày', vndS(N.l30.nmv) + '₫', delta(N.l30.nmv, N.p30.nmv) + ' so với 30 ngày trước')}
    ${kpi('Thực nhận 30 ngày', vndS(N.l30.net) + '₫', 'sau phí sàn, voucher, ads tiền nạp')}
    ${kpi('Hủy · Trả hàng (30N)', `${pct(N.l30.cxRate)} · ${pct(N.l30.retRate)}`, `${N.l30.cx} đơn hủy / ${N.l30.all} đơn`)}
    ${kpi('Ads (30N)', vndS(N.l30.adCost) + '₫', `ROAS ${N.l30.roas ? N.l30.roas.toFixed(1) : '–'} · FS ${pct(N.l30.fsShare)} NMV`)}
  </div>
  <div class="grid g-21">${card('NMV theo ngày', '30 ngày gần nhất', dbars(d30, 'nmv', v => vndS(v) + '₫', '#d9a400') + `<div class="legend2" style="margin-top:22px"><span>Tổng 30 ngày ${vndS(N.l30.nmv)}₫ · ${N.l30.orders} đơn</span></div>`)}
    ${card('Top sản phẩm 30 ngày', 'theo NMV (SKU trên đơn)', hbars(Object.values(prods).sort((a, b) => b.v - a.v), v => vndS(v) + '₫', 8, '#d9a400'))}</div>
  ${issueMini('nikon')}`;
}
function issueMini(ch) {
  const is = S.issues.filter(i => i.channel === ch && i.kind === 'issue').slice(0, 5);
  return card('Issue đang mở của kênh', `${S.issues.filter(i => i.channel === ch).length} issue & cơ hội · xếp theo mức độ`, is.length ? is.map(i => issueRow(i, true)).join('') : '<div class="empty2">Không có issue 🎉</div>', `<button class="btn ghost" data-goto="radar">Mở Issue Radar</button>`);
}
function filteredIssues() {
  const f = S.f;
  return S.issues.filter(i => (f.ch === 'all' || i.channel === f.ch) && (!f.sev.size || f.sev.has(i.effSev)) && (f.owner === 'all' || i.owner === f.owner) && (!f.unassigned || !i.task) && (f.kind === 'all' || i.kind === f.kind));
}
function viewRadar() {
  const f = S.f, list = filteredIssues(), mgr = isMgr();
  const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${f[key] === v}">${l}</button>`).join('')}</div>`;
  const groups = ['P0', 'P1', 'P2', 'P3'].map(s => [s, list.filter(i => i.effSev === s)]).filter(g => g[1].length);
  return `<div class="page-head"><div><h1>${mgr ? 'Issue Radar' : 'Issue của tôi'}</h1><p>${S.issues.length} issue & cơ hội do hệ thống tự phát hiện từ dữ liệu sàn · tuổi tính từ lúc sự việc xảy ra trên sàn</p></div></div>
  <div class="toolbar">${mgr ? seg('ch', [['all', 'Tất cả'], ['global', 'Global'], ['local', 'Local'], ['system', 'Hệ thống']]) : ''}
    <div class="chips">${['P0', 'P1', 'P2', 'P3'].map(s => `<button class="chip" data-sevf="${s}" aria-pressed="${f.sev.has(s)}">${s} · ${S.issues.filter(i => i.effSev === s).length}</button>`).join('')}</div>
    ${seg('kind', [['all', 'Tất cả'], ['issue', 'Vấn đề'], ['opportunity', 'Cơ hội']])}
    ${mgr ? `<button class="chip" data-unas aria-pressed="${f.unassigned}">Chỉ chưa giao</button>` : ''}</div>
  ${groups.map(([s, is]) => `<div><div class="group-h">${sevTag(s)} ${SEVN[s]} · ${is.length}</div>${is.map(i => issueRow(i)).join('')}</div>`).join('') || '<section class="card glass"><div class="empty2">Không có issue phù hợp bộ lọc</div></section>'}`;
}

function taskCard(t) {
  const mgr = isMgr(), o = OWN[t.owner] || { short: t.owner };
  const flag = t.flag === 'warning' ? '<span class="tag bad">Cảnh cáo · lần ' + t.recurrence + '</span>' : t.flag === 'remind' ? '<span class="tag warn">Nhắc nhở</span>' : '';
  const dataOk = t.state !== 'closed' && t.dataResolved ? '<span class="tag good">✓ Dữ liệu xác nhận đã xử lý</span>' : (t.state === 'review' && t.live ? '<span class="tag bad">Báo xong nhưng dữ liệu vẫn còn lỗi</span>' : '');
  let acts = '';
  if (t.state !== 'closed') {
    if (mgr) acts = `${t.state === 'review' || t.dataResolved ? `<button class="btn pri" data-approve="${esc(t.id)}">Duyệt đóng</button>` : ''}<button class="btn" data-remind="${esc(t.id)}">Nhắc nhở</button>${t.recurrence >= 2 || t.reminds ? `<button class="btn danger" data-warn="${esc(t.id)}">Cảnh cáo</button>` : ''}<button class="btn ghost" data-deadline="${esc(t.id)}">Gia hạn</button><button class="btn ghost" data-msg="${esc(t.id)}">Tin nhắn giao</button>`;
    else acts = `${!t.ackAt && t.state !== 'review' ? `<button class="btn pri" data-tack="${esc(t.id)}">Nhận việc</button>` : ''}<button class="btn" data-progress="${esc(t.id)}">Cập nhật</button>${t.state !== 'review' ? `<button class="btn pri" data-done="${esc(t.id)}">Báo hoàn thành</button>` : ''}`;
  } else if (mgr) acts = `<button class="btn ghost" data-reopen="${esc(t.id)}">Mở lại</button>${!t.praised && t.closeHow !== 'dismissed' ? `<button class="btn ghost" data-praise="${esc(t.id)}">Ghi nhận</button>` : ''}`;
  const hist = t.history.map(e => `<li>${dt(e.ts)} · ${esc(e.user)} · ${esc({ assign: 'giao việc', ack: 'nhận việc', progress: 'cập nhật', done: 'báo hoàn thành', approve: 'duyệt đóng', reopen: 'mở lại', remind: 'nhắc nhở', warn: 'cảnh cáo', deadline: 'gia hạn', praise: 'ghi nhận', dismiss: 'huỷ', note: 'ghi chú' }[e.op] || e.op)}${e.data && e.data.note ? ': ' + esc(e.data.note) : ''}${e.data && /^https?:\/\//.test(e.data.link || '') ? ` <a href="${esc(e.data.link)}" target="_blank" rel="noopener">bằng chứng ↗</a>` : ''}${e.data && e.data.due && e.op === 'deadline' ? ' → ' + dmy(e.data.due) : ''}</li>`).join('');
  return `<div class="task ${t.overdue ? 'over' : ''}"><div class="row">${sevTag(t.effSev)}<span>${esc(t.id)}</span>${flag}</div><b class="t">${esc(t.title)}</b>
    <div class="row"><span>${esc(o.short)}</span>·<span>hạn ${dmy(t.due)}${t.overdue ? ` <b style="color:var(--crit-ink)">(trễ ${t.daysOver} ngày)</b>` : ''}</span>${t.reminds ? `·<span>${t.reminds} lần nhắc</span>` : ''}</div>
    ${dataOk ? `<div class="row">${dataOk}</div>` : ''}
    ${t.closeWhen ? `<div class="row" style="color:var(--ink2)">Đóng khi: ${esc(t.closeWhen)}</div>` : ''}
    <div class="acts">${acts}</div><details><summary class="sub" style="cursor:pointer">Lịch sử (${t.history.length})</summary><ul class="hist">${hist}</ul></details></div>`;
}
function viewTasks() {
  const ts = S.led.tasks, recentClosed = ts.filter(t => t.state === 'closed' && t.closedAt && Date.now() - Date.parse(t.closedAt) < 21 * 864e5);
  const cols = [['Quá hạn', ts.filter(t => t.overdue)], ['Đã giao', ts.filter(t => t.state === 'open' && !t.overdue)], ['Đang làm', ts.filter(t => t.state === 'doing' && !t.overdue)], ['Chờ duyệt', ts.filter(t => t.state === 'review' && !t.overdue)], ['Đã đóng (21 ngày)', recentClosed]];
  return `<div class="page-head"><div><h1>${isMgr() ? 'Giao việc & theo dõi' : 'Việc được giao'}</h1><p>Mọi thao tác được ghi vào nhật ký có giờ máy chủ, không sửa/xoá được. Việc chỉ đóng khi quản lý duyệt — ưu tiên khi dữ liệu đã xác nhận.</p></div></div>
  ${S.apiErr ? `<div class="alert warn"><span class="ic">!</span><div><b>Sổ giao việc chưa kết nối</b><span>${esc(S.apiErr)}</span></div></div>` : ''}
  <div class="kanban">${cols.map(([h, l]) => `<div class="col glass"><h3><span>${h}</span><span>${l.length}</span></h3>${l.sort((a, b) => E.SEV.indexOf(b.effSev) - E.SEV.indexOf(a.effSev)).map(taskCard).join('') || '<div class="empty2" style="padding:12px">—</div>'}</div>`).join('')}</div>`;
}

function challengeList(c, id) {
  const out = [], iss = S.issues.filter(i => i.owner === id), ts = S.led.tasks.filter(t => t.owner === id);
  if (c.missReport) out.push(`<b>${c.missReport} issue nghiêm trọng</b> đã tồn trên 24h mà ${esc(c.short)} chưa báo: ${iss.filter(i => i.missReport).slice(0, 3).map(i => esc(i.title)).join('; ')}.`);
  if (c.overdue) out.push(`<b>${c.overdue} việc quá hạn</b>: ${ts.filter(t => t.overdue).map(t => esc(t.id) + ' (trễ ' + t.daysOver + ' ngày)').join(', ')}.`);
  const fakeDone = ts.filter(t => t.state === 'review' && t.live);
  if (fakeDone.length) out.push(`<b>${fakeDone.length} việc báo "xong" nhưng dữ liệu vẫn còn lỗi</b>: ${fakeDone.map(t => esc(t.id)).join(', ')} — yêu cầu giải trình.`);
  const rec = ts.filter(t => t.recurrence >= 2); if (rec.length) out.push(`<b>Lỗi tái phát</b>: ${rec.map(t => esc(t.ruleId) + ' lần ' + t.recurrence).join(', ')}.`);
  const rf = S.rout.filter(r => r.owner === id && (r.status === 'fail' || r.status === 'pending')); if (rf.length) out.push(`<b>${rf.length} việc định kỳ chưa đạt</b>: ${rf.slice(0, 4).map(r => esc(r.title)).join('; ')}.`);
  if (!out.length) out.push('Không có điểm cần nhắc. Cân nhắc ghi nhận nhân viên.');
  return out;
}
function viewTeam() {
  const ids = isMgr() ? ['trang', 'phu'] : [myOwner()];
  return `<div class="page-head"><div><h1>${isMgr() ? 'Nhân sự · Scorecard trách nhiệm' : 'Điểm trách nhiệm của tôi'}</h1><p>Điểm 100 trừ: quá hạn −8, miss báo cáo −6, tái phát −5, P0 đang mở −5, mở lại −4, cảnh cáo −10; cộng/trừ theo tỷ lệ đúng hạn.</p></div></div>
  ${ids.map(id => { const c = S.led.cards[id]; return card(esc(c.name), id === 'trang' ? 'Global · Wayfair CastleGate & Amazon' : 'Local · Shopee kệ 3 tầng', `<div class="score"><div class="ring2" style="--p:${c.score};--c:${c.score >= 80 ? 'var(--good)' : c.score >= 60 ? 'var(--warn)' : 'var(--crit)'}"><div><b>${c.score}</b><span>/ 100</span></div></div>
    <div class="statgrid"><div class="stat"><b>${c.assigned}</b><span>Việc được giao</span></div><div class="stat"><b>${c.open}</b><span>Đang mở</span></div><div class="stat ${c.overdue ? 'bad' : ''}"><b>${c.overdue}</b><span>Quá hạn</span></div><div class="stat"><b>${c.onTimeRate == null ? '–' : pct(c.onTimeRate)}</b><span>Đúng hạn</span></div>
    <div class="stat ${c.missReport ? 'bad' : ''}"><b>${c.missReport}</b><span>Miss báo cáo</span></div><div class="stat ${c.recurring ? 'bad' : ''}"><b>${c.recurring}</b><span>Tái phát</span></div><div class="stat"><b>${c.reminds}/${c.warns}</b><span>Nhắc nhở / Cảnh cáo</span></div><div class="stat"><b>${c.avgDays == null ? '–' : c.avgDays.toFixed(1) + 'd'}</b><span>Thời gian xử lý TB</span></div>
    <div class="stat ${c.p0 ? 'bad' : ''}"><b>${c.p0}</b><span>Issue P0 đang mở</span></div><div class="stat"><b>${c.p1}</b><span>Issue P1 đang mở</span></div><div class="stat"><b>${c.unassigned}</b><span>Issue chưa giao</span></div><div class="stat"><b>${c.reopen}</b><span>Bị mở lại</span></div></div></div>
    <h3 style="margin-top:18px">${isMgr() ? 'Điểm cần challenge' : 'Điểm cần cải thiện'}</h3><ul class="challenge">${challengeList(c, id).map(x => `<li>${x}</li>`).join('')}</ul>`); }).join('')}`;
}

function viewRoutine() {
  const by = {}; for (const r of S.rout) (by[r.owner] = by[r.owner] || []).push(r);
  const st = { ok: '✓ Đạt', fail: '✗ Chưa đạt (dữ liệu)', review: '⏳ Chờ duyệt', pending: '— Chưa nộp' };
  const cad = { daily: 'Hằng ngày', weekly: 'Hằng tuần', monthly: 'Hằng tháng' };
  return `<div class="page-head"><div><h1>Việc định kỳ</h1><p>Hệ thống kiểm bằng dữ liệu khi có thể; việc không có dữ liệu (content, báo cáo, kiểm kê) phải nộp link bằng chứng và được quản lý duyệt.</p></div></div>
  ${Object.entries(by).map(([o, rs]) => card(esc(o === 'manager' ? 'Quản lý' : OWN[o] ? OWN[o].name : o), `${rs.filter(r => r.status === 'ok').length}/${rs.length} đạt kỳ này`, `<div class="tw"><table class="t"><tr><th>Việc</th><th>Chu kỳ</th><th>Hạn</th><th>Kiểm bằng</th><th>Trạng thái</th><th></th></tr>${rs.map(r => `<tr><td><b>${esc(r.title)}</b>${r.evidence && r.verify === 'evidence' && typeof r.evidence === 'string' && !/^https?:/.test(r.evidence) ? `<br><span class="sub">${esc(r.evidence)}</span>` : ''}</td><td>${cad[r.cadence] || r.cadence}</td><td>${esc(r.due)}</td><td>${r.verify.startsWith('rule:') ? 'Dữ liệu sàn' : 'Bằng chứng'}</td><td class="st-${r.status}">${st[r.status]}${r.submittedAt ? `<br><span class="sub">${dt(r.submittedAt)}</span>` : ''}</td>
    <td>${r.verify === 'evidence' ? (isMgr() ? (r.status === 'review' ? `<button class="btn pri" data-rapprove="${esc(r.ref)}" data-ch="${OWN[r.owner] ? OWN[r.owner].channel : ''}">Duyệt</button>` : '') : (r.status !== 'ok' ? `<button class="btn" data-rsubmit="${esc(r.ref)}">Nộp bằng chứng</button>` : '')) : ''}${/^https?:/.test(r.evidence || '') ? ` <a href="${esc(r.evidence)}" target="_blank" rel="noopener">xem ↗</a>` : ''}</td></tr>`).join('')}</table></div>`)).join('')}`;
}

/* ---------------- actions ---------------- */
async function addEvent(op, ref, data, channel) {
  const r = await api('event.add', { ev: { op, ref, data, channel } });
  if (!r.ok) { toast('Lỗi: ' + (r.err || 'không ghi được')); return false; }
  S.events.push(r.ev); await compute(); render(); return true;
}
const issueByKey = k => S.issues.find(i => i.key === k);
const taskById = id => S.led.tasks.find(t => t.id === id);
function msgVars(t, extra = {}) { return { name: (OWN[t.owner] || {}).short || '', title: t.title, taskId: t.id, deadline: dmy(t.due), detail: t.detail || (t.live && t.live.detail) || '', steps: (t.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n'), closeWhen: t.closeWhen || '', count: t.recurrence, ...extra }; }
function assignModal(i) {
  const due = E.isoAdd(E.todayVN(), i.sla || 7), owner = i.owner === 'manager' ? (i.channel === 'local' ? 'phu' : 'trang') : i.owner;
  modal(`<h3>Giao việc</h3><p class="sub">${sevTag(i.effSev)} ${esc(i.title)}</p>
    <label>Người phụ trách<select id="mOwner"><option value="trang" ${owner === 'trang' ? 'selected' : ''}>${OWN.trang.name} (Global)</option><option value="phu" ${owner === 'phu' ? 'selected' : ''}>${OWN.phu.name} (Local)</option></select></label>
    <label>Mức độ<select id="mSev">${['P0', 'P1', 'P2', 'P3'].map(s => `<option ${s === i.effSev ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>Hạn hoàn thành<input id="mDue" type="date" value="${due}"></label>
    <label>Các bước cần làm (mỗi dòng 1 bước)<textarea id="mSteps">${esc((i.steps || []).join('\n'))}</textarea></label>
    <label>Điều kiện đóng việc<input id="mClose" value="${esc(i.closeWhen || '')}"></label>
    <div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="mGo">Giao & copy tin nhắn Zalo</button></div>`, m => {
    m.querySelector('#mGo').onclick = async () => {
      const ow = m.querySelector('#mOwner').value, d = { taskId: 'T-' + Date.now().toString(36).slice(-5).toUpperCase(), issueKey: i.key, ruleId: i.rule, title: i.title, detail: i.detail || '', sev: m.querySelector('#mSev').value, owner: ow, ownerName: OWN[ow].name, channel: OWN[ow].channel, due: m.querySelector('#mDue').value, steps: m.querySelector('#mSteps').value.split('\n').map(s => s.trim()).filter(Boolean), closeWhen: m.querySelector('#mClose').value };
      closeModal(); if (await addEvent('assign', d.taskId, d, d.channel)) copy(fill(PB.messages.assign, msgVars({ ...d, id: d.taskId })));
    };
  });
}
function noteModal(title, needLink, cb) {
  modal(`<h3>${title}</h3><label>Ghi chú<textarea id="mNote" placeholder="Đã làm gì, kết quả, vướng mắc…"></textarea></label><label>Link bằng chứng ${needLink ? '(bắt buộc)' : '(nếu có)'}<input id="mLink" placeholder="https://… ảnh chụp, link listing, file báo cáo"></label><div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="mGo">Gửi</button></div>`, m => {
    m.querySelector('#mGo').onclick = () => { const note = m.querySelector('#mNote').value.trim(), link = m.querySelector('#mLink').value.trim(); if (needLink && !/^https?:\/\//.test(link)) { toast('Cần link bằng chứng (https://…)'); return; } if (!note && !link) { toast('Nhập ghi chú'); return; } closeModal(); cb({ note, link }); };
  });
}
function msgModal(title, text, cb) {
  modal(`<h3>${title}</h3><label>Tin nhắn (sửa được trước khi gửi)<textarea id="mMsg" style="min-height:220px">${esc(text)}</textarea></label><div class="foot"><button class="btn ghost" data-close>Đóng</button><button class="btn pri" id="mGo">${cb ? 'Ghi nhận & copy' : 'Copy'}</button></div>`, m => {
    m.querySelector('#mGo').onclick = async () => { const t = m.querySelector('#mMsg').value; closeModal(); if (cb) await cb(t); copy(t); };
  });
}
function bindView() {
  const V = $('#view');
  V.onclick = async e => {
    const b = e.target.closest('button,[data-goto]'); if (!b) return; const d = b.dataset;
    if (d.goto) { S.tab = d.goto; render(); scrollTo({ top: 0 }); return; }
    if (d.seg !== undefined) return;
    if (b.closest('[data-seg]')) { S.f[b.closest('[data-seg]').dataset.seg] = d.v; render(); return; }
    if (d.sevf) { S.f.sev.has(d.sevf) ? S.f.sev.delete(d.sevf) : S.f.sev.add(d.sevf); render(); return; }
    if (d.unas !== undefined) { S.f.unassigned = !S.f.unassigned; render(); return; }
    if (d.assign) return assignModal(issueByKey(d.assign));
    if (d.dismiss) { const i = issueByKey(d.dismiss); return modal(`<h3>Bỏ qua issue</h3><p class="sub">${esc(i.title)}</p><label>Lý do (được ghi log)<input id="mR"></label><div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="mGo">Bỏ qua</button></div>`, m => { m.querySelector('#mGo').onclick = async () => { const r = m.querySelector('#mR').value.trim(); if (!r) return toast('Cần lý do'); closeModal(); const id = 'T-' + Date.now().toString(36).slice(-5).toUpperCase(); await addEvent('assign', id, { taskId: id, issueKey: i.key, ruleId: i.rule, title: i.title, sev: i.sev, owner: i.owner === 'manager' ? 'trang' : i.owner, channel: i.channel, due: E.todayVN(), closeWhen: 'evidence' }, i.channel); await addEvent('dismiss', id, { reason: r }, i.channel); }; }); }
    if (d.ack) return addEvent('ack', d.ack, { note: 'Nhân viên chủ động báo đã nắm issue' }).then(ok => ok && toast('Đã ghi nhận: em đã nắm issue'));
    const t = taskById(d.approve || d.remind || d.warn || d.deadline || d.msg || d.tack || d.progress || d.done || d.reopen || d.praise || '');
    if (d.approve) return addEvent('approve', t.id, { how: t.dataResolved ? 'data' : 'manager' }, t.channel);
    if (d.remind) return msgModal('Nhắc nhở ' + (OWN[t.owner] || {}).short, fill(PB.messages.remind, msgVars(t)), txt => addEvent('remind', t.id, { note: 'Đã gửi nhắc nhở' }, t.channel));
    if (d.warn) { const prior = S.led.tasks.filter(x => x.owner === t.owner && x.ruleId === t.ruleId).map(x => dmy(String(x.assignedAt).slice(0, 10))).join(', '); return msgModal('Cảnh cáo ' + (OWN[t.owner] || {}).short, fill(PB.messages.warning, msgVars(t, { detail: prior, deadline: dmy(E.isoAdd(E.todayVN(), 2)) })), txt => addEvent('warn', t.id, { note: 'Đã gửi cảnh cáo' }, t.channel)); }
    if (d.msg) return msgModal('Tin nhắn giao việc', fill(PB.messages.assign, msgVars(t)));
    if (d.praise) return msgModal('Ghi nhận ' + (OWN[t.owner] || {}).short, fill(PB.messages.praise, msgVars(t)), txt => addEvent('praise', t.id, {}, t.channel));
    if (d.deadline) return modal(`<h3>Gia hạn ${esc(t.id)}</h3><label>Hạn mới<input id="mDue" type="date" value="${E.isoAdd(t.due || E.todayVN(), 2)}"></label><label>Lý do<input id="mR"></label><div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="mGo">Lưu</button></div>`, m => { m.querySelector('#mGo').onclick = () => { const due = m.querySelector('#mDue').value, note = m.querySelector('#mR').value; closeModal(); addEvent('deadline', t.id, { due, note }, t.channel); }; });
    if (d.reopen) return addEvent('reopen', t.id, {}, t.channel);
    if (d.tack) return addEvent('ack', t.id, {});
    if (d.progress) return noteModal('Cập nhật tiến độ ' + t.id, false, x => addEvent('progress', t.id, x));
    if (d.done) return noteModal('Báo hoàn thành ' + t.id, String(t.closeWhen || '').startsWith('evidence'), x => addEvent('done', t.id, x));
    if (d.rsubmit) return noteModal('Nộp bằng chứng việc định kỳ', true, x => addEvent('done', d.rsubmit, x));
    if (d.rapprove) return addEvent('approve', d.rapprove, {}, d.ch);
  };
}

/* ---------------- private chat keys ---------------- */
let PUBS = null; const DMK = {};
async function ensureDH(me, pass) {
  if (isDemo || !ST.hasToken()) return;
  if (!me.dh) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    me.dh = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: await crypto.subtle.exportKey('jwk', kp.publicKey) };
    const f = await ST.getFile('data/vault.json'), b = await ST.openSlot(JSON.parse(f.text), me.username, pass);
    const slot = await ST.makeSlot(me.username, pass, { ...b, dh: me.dh });
    await ST.updatePlain('data/vault.json', v => { v.users = (v.users || []).filter(u => u.h !== slot.h).concat(slot); return v; }, 'account: ' + me.username + ' bật chat riêng', { v: 2, iter: 250000, users: [] });
  }
  await publishPub(me);
}
async function publishPub(me) {
  if (isDemo || !me.dh || !ST.hasToken()) return;
  const f = await ST.getFile('data/pubkeys.json'), cur = f ? JSON.parse(f.text) : {};
  if (cur[me.id] && cur[me.id].x === me.dh.pub.x) { PUBS = cur; return; }
  PUBS = await ST.updatePlain('data/pubkeys.json', v => { v[me.id] = me.dh.pub; return v; }, 'account: khoá chat riêng của ' + me.id, {});
}
async function dmKey(other) {
  if (!S.me.dh) return null; if (DMK[other]) return DMK[other];
  if (!PUBS || !PUBS[other]) { const f = await ST.getFile('data/pubkeys.json'); PUBS = f ? JSON.parse(f.text) : {}; }
  if (!PUBS[other]) return null;
  const mine = await crypto.subtle.importKey('jwk', S.me.dh.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const theirs = await crypto.subtle.importKey('jwk', PUBS[other], { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return (DMK[other] = ST.b64e(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine, 256)));
}
function collabHost() {
  return { me: S.me, team: CFG.TEAM.map(p => p.id === S.me.id ? { ...p, name: S.me.name || p.name } : p), keys: S.me.keys || {}, ST, isDemo, dmKey,
    now: () => isDemo ? new Date().toISOString() : ST.now(), toast, modal, closeModal, canWrite: () => isDemo || ST.hasToken(),
    goto: t => { S.tab = t; render(); scrollTo({ top: 0 }); }, tab: () => S.tab, onBadge: b => { S.badge = b; renderTabs(); } };
}

/* ---------------- shell, accounts & settings ---------------- */
function remember(me) { const j = JSON.stringify(me); if (store.get('mp-me')) store.set('mp-me', j); else { try { sessionStorage.setItem('mp-me', j); } catch (e) {} } }
async function changePassword(oldp, newp) {
  if (newp.length < 8) throw new Error('Mật khẩu mới cần ít nhất 8 ký tự');
  if (newp === oldp) throw new Error('Mật khẩu mới phải khác mật khẩu cũ');
  if (!ST.hasToken()) throw new Error('Chưa có GitHub token nên chưa lưu được — báo quản lý nhập token trong Cài đặt');
  const f = await ST.getFile('data/vault.json'); const b = await ST.openSlot(JSON.parse(f.text), S.me.username, oldp).catch(() => { throw new Error('Mật khẩu hiện tại không đúng'); });
  const slot = await ST.makeSlot(S.me.username, newp, { ...b, mustChange: false });
  await ST.updatePlain('data/vault.json', v => { v.users = (v.users || []).filter(u => u.h !== slot.h).concat(slot); return v; }, 'account: ' + S.me.username + ' đổi mật khẩu', { v: 2, iter: 250000, users: [] });
  S.me.mustChange = false; remember(S.me);
}
async function resetStaffPassword(member, newp) {
  const K = S.me.keys; if (newp.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự');
  const bundle = { id: member.id, username: member.username, name: member.name, role: 'staff', channel: member.channel, keys: { S: K.S, [member.channel === 'global' ? 'G' : 'L']: K[member.channel === 'global' ? 'G' : 'L'] }, mustChange: true };
  const slot = await ST.makeSlot(member.username, newp, bundle);
  await ST.updatePlain('data/vault.json', v => { v.users = (v.users || []).filter(u => u.h !== slot.h).concat(slot); return v; }, 'account: quản lý đặt lại mật khẩu ' + member.username, { v: 2, iter: 250000, users: [] });
}
async function saveToken(t) {
  const r = await fetch(`https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}`, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('Token không đọc được repo ' + CFG.REPO + ' (' + r.status + ')');
  const j = await r.json(); if (j.permissions && !j.permissions.push) throw new Error('Token chưa có quyền ghi (Contents: Read and write)');
  ST.setToken(t); await ST.updateEnc('data/token.enc.json', S.me.keys.S, () => ({ t, at: ST.now(), by: S.me.id }), 'config: cập nhật GitHub token', {});
}
async function connectSources(lgU, lgP, lfU, lfP) {
  const te = new TextEncoder(), K = S.me.keys;
  const pb = async (user, pass, salt, usage) => { const base = await crypto.subtle.importKey('raw', te.encode(user.trim().toLowerCase() + '\n' + pass), 'PBKDF2', false, ['deriveKey', 'deriveBits']); return { key: () => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 250000 }, base, { name: 'AES-GCM', length: 256 }, false, usage), bits: () => crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 250000 }, base, 256) }; };
  const out = [];
  if (lgP) {
    const lg = await (await fetch(CFG.SRC_GLOBAL + '?ts=' + Date.now(), { cache: 'no-store' })).json();
    const h = (await ST.sha('lignarc|' + lgU.trim().toLowerCase())).slice(0, 16), slot = (lg.users || []).find(u => u.h === h); if (!slot) throw new Error('Lignarc: không thấy username');
    let dk; try { dk = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(slot.iv) }, await (await pb(lgU, lgP, b64d(slot.salt), ['decrypt'])).key(), b64d(slot.wk))); } catch (e) { throw new Error('Lignarc: sai mật khẩu'); }
    const d = await openWith(dk, lg); await ST.updateEnc('data/src-global.enc.json', K.G, () => ({ lg: ST.b64e(dk), at: ST.now() }), 'config: kết nối dữ liệu Lignarc', {});
    S.me.lg = ST.b64e(dk); out.push('Lignarc ✓ ' + (((d.wf || {}).orders || []).length) + ' dòng đơn');
  }
  if (lfP) {
    let keys = null;
    try {
      const kr = await (await fetch(CFG.SRC_KEYRING + '?ts=' + Date.now(), { cache: 'no-store' })).json();
      keys = await Promise.any((kr.users || []).map(async u => { const raw = new Uint8Array(await (await pb(lfU, lfP, b64d(u.salt))).bits()); const j = await openWith(raw, u); return j.shops; }));
    } catch (e) { keys = null; }
    let lfRaw, nkB64 = null;
    if (keys && keys.lf) { lfRaw = b64d(keys.lf); nkB64 = keys.nikon || null; }
    else { const lf = await (await fetch(CFG.SRC_LOCAL + '?ts=' + Date.now(), { cache: 'no-store' })).json(); lfRaw = new Uint8Array(await (await pb(lfU, lfP, b64d(lf.salt))).bits()); }
    const lf = await (await fetch(CFG.SRC_LOCAL + '?ts=' + Date.now(), { cache: 'no-store' })).json();
    let d; try { d = await openWith(lfRaw, lf); } catch (e) { throw new Error('Dash Local: sai email hoặc mật khẩu'); }
    let nInfo = '';
    if (nkB64) { try { const nf = await (await fetch(CFG.SRC_NIKON + '?ts=' + Date.now(), { cache: 'no-store' })).json(); const nd = await openWith(b64d(nkB64), nf); nInfo = ' · Nikon ✓ ' + (nd.orders || []).length + ' đơn'; } catch (e) { nInfo = ' · Nikon ✗'; nkB64 = null; } }
    await ST.updateEnc('data/src-local.enc.json', K.L, () => ({ lf: ST.hex(lfRaw), nikon: nkB64, at: ST.now() }), 'config: kết nối dữ liệu Shopee (LF + Nikon)', {});
    S.me.lf = ST.hex(lfRaw); S.me.nk = nkB64; out.push('Kệ 3 tầng ✓ ' + (d.orders || []).length + ' đơn' + nInfo);
  }
  remember(S.me); return out.join(' · ');
}
function pwModal(forced) {
  modal(`<h3>${forced ? 'Đổi mật khẩu lần đầu' : 'Đổi mật khẩu'}</h3>${forced ? '<p class="sub">Mật khẩu ban đầu do quản lý cấp. Vì bảo mật, hãy đặt mật khẩu riêng (≥ 8 ký tự) trước khi dùng.</p>' : ''}
    <label>Mật khẩu hiện tại<input id="pw0" type="password" autocomplete="current-password"></label><label>Mật khẩu mới (≥ 8 ký tự)<input id="pw1" type="password" autocomplete="new-password"></label><label>Nhập lại mật khẩu mới<input id="pw2" type="password" autocomplete="new-password"></label>
    <p class="login-err" id="pwErr"></p><div class="foot">${forced ? '<button class="btn ghost" id="pwLater">Để sau</button>' : '<button class="btn ghost" data-close>Huỷ</button>'}<button class="btn pri" id="pwGo">Đổi mật khẩu</button></div>`, m => {
    if (forced) { m.onclick = null; m.addEventListener('click', e => { if (e.target.id === 'pwLater') { closeModal(); toast('Nhớ đổi mật khẩu sớm trong Cài đặt'); } }, true); }
    m.querySelector('#pwGo').onclick = async () => { const p1 = m.querySelector('#pw1').value, p2 = m.querySelector('#pw2').value, err = m.querySelector('#pwErr'); if (p1 !== p2) { err.textContent = 'Hai mật khẩu mới không khớp'; return; } const b = m.querySelector('#pwGo'); b.disabled = true; b.textContent = 'Đang lưu…'; try { await changePassword(m.querySelector('#pw0').value, p1); closeModal(); toast('Đã đổi mật khẩu. Lần sau đăng nhập bằng mật khẩu mới.'); } catch (e) { err.textContent = e.message; b.disabled = false; b.textContent = 'Đổi mật khẩu'; } };
  });
}
function settings() {
  const mgr = isMgr() && !isDemo, team = (S.me.team || []);
  modal(`<h3>Cài đặt</h3><p class="sub">${esc(S.me.name)} · @${esc(S.me.username || S.me.id)} · ${S.me.role === 'manager' ? 'Quản lý (toàn quyền)' : 'Nhân viên · ' + (S.me.channel === 'global' ? 'Global' : 'Local')}</p>
    <div class="set-sec"><b>Tài khoản</b><button class="btn" id="sPw">Đổi mật khẩu</button></div>
    ${isMgr() ? `<div class="set-sec"><b>Hiển thị</b><label>Tên hiển thị<input id="sName" value="${esc(S.me.name)}"></label><label>Nhân viên xưng hô với quản lý<select id="sPron"><option value="anh">anh</option><option value="chị">chị</option></select></label><label>Tỷ giá USD → VND<input id="sFx" inputmode="numeric" value="${S.fx}"></label></div>` : ''}
    ${mgr ? `<div class="set-sec"><b>GitHub token ${ST.hasToken() ? '<span class="tag good">đang hoạt động</span>' : '<span class="tag bad">chưa có</span>'}</b><p class="sub">Fine-grained token chỉ cho repo ${esc(CFG.REPO)}, quyền Contents: Read and write. Được mã hoá; nhân viên dùng chung để lưu việc & Sheet.</p><label>Token<input id="sTok" placeholder="github_pat_…" autocomplete="off"></label><button class="btn" id="sTokGo">Lưu token</button> <span id="sTokOut" class="sub"></span></div>
    <div class="set-sec"><b>Kết nối dữ liệu nguồn ${S.me.lg ? '<span class="tag good">Lignarc ✓</span>' : '<span class="tag bad">Lignarc ✗</span>'} ${S.me.lf ? '<span class="tag good">Kệ 3 tầng ✓</span>' : '<span class="tag bad">Kệ 3 tầng ✗</span>'} ${S.me.nk ? '<span class="tag good">Nikon ✓</span>' : '<span class="tag bad">Nikon ✗</span>'}</b><p class="sub">Đăng nhập 2 dash gốc một lần để Command Center đọc được dữ liệu. Chỉ khoá giải mã được lưu (mã hoá), không lưu mật khẩu.</p>
      <div class="set-2"><label>Lignarc · Username<input id="cLgU" value="khoimr11" autocomplete="off"></label><label>Lignarc · Password<input id="cLgP" type="password" autocomplete="off"></label><label>Dash Local (Kệ 3 tầng + Nikon) · Email<input id="cLfU" value="salesb2c.lf@vhg.vn" autocomplete="off"></label><label>Dash Local · Password<input id="cLfP" type="password" autocomplete="off"></label></div>
      <button class="btn" id="cGo">Kết nối</button> <span id="cOut" class="sub"></span></div>
    <div class="set-sec"><b>Tài khoản nhân viên</b>${team.map(t => `<div class="set-row"><span>${esc(t.name)} · @${esc(t.username)} · ${t.channel === 'global' ? 'Global' : 'Local'}</span><button class="btn ghost" data-reset="${esc(t.id)}">Đặt lại mật khẩu</button></div>`).join('')}</div>` : ''}
    ${isDemo ? `<div class="set-sec"><b>Xem như (demo)</b><select id="mAs"><option value="manager">Quản lý</option><option value="trang">Thuỳ Trang (Global)</option><option value="phu">Đình Phú (Local)</option></select></div>` : ''}
    <div class="foot"><button class="btn ghost" data-close>Đóng</button><button class="btn pri" id="mGo">Lưu</button></div>`, m => {
    const q = s => m.querySelector(s);
    if (q('#sPron')) q('#sPron').value = PRON();
    if (isDemo) q('#mAs').value = S.me.role === 'manager' ? 'manager' : S.me.id;
    q('#sPw').onclick = () => isDemo ? toast('Bản demo không đổi mật khẩu') : pwModal(false);
    if (q('#sTokGo')) q('#sTokGo').onclick = async () => { const t = q('#sTok').value.trim(), o = q('#sTokOut'); if (!t) return; o.textContent = 'Đang kiểm tra…'; try { await saveToken(t); o.textContent = '✓ Đã lưu token'; S.sheetHost = sheetHost(); await loadEvents(); await compute(); render(); } catch (e) { o.textContent = e.message; } };
    if (q('#cGo')) q('#cGo').onclick = async () => { const o = q('#cOut'); o.textContent = 'Đang giải mã… (mất vài giây)'; try { o.textContent = await connectSources(q('#cLgU').value, q('#cLgP').value, q('#cLfU').value, q('#cLfP').value); S.src = await loadSources(S.me); await compute(); render(); } catch (e) { o.textContent = e.message; } };
    m.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { const t = team.find(x => x.id === b.dataset.reset); const p = prompt('Mật khẩu tạm mới cho ' + t.name + ' (nhân viên sẽ phải đổi khi đăng nhập):'); if (!p) return; resetStaffPassword(t, p).then(() => toast('Đã đặt lại mật khẩu cho ' + t.name)).catch(e => toast(e.message)); });
    q('#mGo').onclick = async () => {
      if (q('#sFx')) { const v = +String(q('#sFx').value).replace(/\D/g, ''); if (v > 1000) { S.fx = v; store.set('cc-fx', v); } }
      if (q('#sPron')) store.set('mp-pron', q('#sPron').value);
      if (q('#sName') && q('#sName').value.trim()) { S.me.name = q('#sName').value.trim(); store.set('mp-name-' + S.me.id, S.me.name); remember(S.me); }
      if (isDemo && q('#mAs').value !== (S.me.role === 'manager' ? 'manager' : S.me.id)) { closeModal(); S.tab = 'brief'; return start({ ...DEMO_USERS[q('#mAs').value] }); }
      closeModal(); await compute(); render(); showWho();
    };
  });
}
function sheetHost() {
  const K = S.me.keys || {}, mgr = S.me.role === 'manager';
  const scopes = isDemo ? ['S', 'G', 'L', 'M'].filter(k => k === 'S' || mgr || (k === 'G' && S.me.channel === 'global') || (k === 'L' && S.me.channel === 'local')) : ['S', 'G', 'L', 'M'].filter(k => K[k]);
  const dkey = k => 'mp-demo-sh-' + k, dread = k => JSON.parse(store.get(dkey(k)) || '{"sheets":[]}');
  return { me: S.me, scopes, get canWrite() { return isDemo || ST.hasToken(); }, canEdit: k => scopes.includes(k) && (isDemo || ST.hasToken()), now: () => isDemo ? new Date().toISOString() : ST.now(), toast, modal, closeModal,
    read: async k => isDemo ? dread(k) : ST.readEnc(`data/sheets-${k}.enc.json`, K[k], { sheets: [] }),
    write: async (k, mutate, msg) => { if (isDemo) { const d = mutate(dread(k)); store.set(dkey(k), JSON.stringify(d)); return d; } return ST.updateEnc(`data/sheets-${k}.enc.json`, K[k], mutate, msg, { sheets: [] }); } };
}
function showWho() { $('#who').textContent = (S.me.role === 'manager' ? 'Quản lý · ' : 'NV · ') + S.me.name; $('#sub').textContent = S.me.role === 'manager' ? 'Command Center · Quản lý' : (S.me.channel === 'global' ? 'Command Center · Global' : 'Command Center · Local · Nikon'); }
async function start(me) {
  S.me = me; const nm = store.get('mp-name-' + me.id); if (nm) S.me.name = nm;
  $('#login').hidden = true; $('#app').hidden = false; showWho();
  $('#view').innerHTML = '<div class="empty2">Đang giải mã & tính toán…</div>';
  await ST.syncClock(); await unlock(me); S.sheetHost = sheetHost();
  const [src] = await Promise.all([loadSources(me), loadEvents()]); S.src = src;
  await compute(); render(); snapshotOncePerDay();
  if (me.mustChange && !isDemo) pwModal(true);
  if (!isDemo) publishPub(me).catch(() => {});
  window.CCX.init(collabHost()).catch(e => console.warn('collab', e));
}
const th0 = store.get('lg-theme'); if (th0) document.documentElement.dataset.theme = th0;
$('#themeBtn').onclick = () => { const r = document.documentElement, cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), n = cur === 'dark' ? 'light' : 'dark'; r.dataset.theme = n; store.set('lg-theme', n); };
$('#logoutBtn').onclick = () => { if (window.CCSheet.hasUnsaved() && !confirm('Sheet đang lưu dở, vẫn đăng xuất?')) return; store.del('mp-me'); location.href = location.pathname; };
$('#settingsBtn').onclick = settings;
$('#refreshBtn').onclick = () => start(S.me);
$('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; render(); scrollTo({ top: 0 }); } };
addEventListener('beforeunload', e => { if (window.CCSheet.hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Đang giải mã…'; $('#loginErr').textContent = '';
  try { const pw = $('#pass').value, me = await login($('#user').value, pw); await unlock(me); await ensureDH(me, pw).catch(e => console.warn('dh', e)); const j = JSON.stringify(me); if ($('#remember').checked) store.set('mp-me', j); else sessionStorage.setItem('mp-me', j); $('#pass').value = ''; start(me); }
  catch (x) { $('#loginErr').textContent = x.message === 'bad' ? 'Sai tài khoản hoặc mật khẩu' : x.message; }
  finally { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
});
/* installable app (Chrome › Cài app) */
let installEvt = null;
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Đã cài Command Center — mở từ màn hình chính / Start menu'); });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; };
{ const qt = new URLSearchParams(location.search).get('tab'); if (qt) S.tab = qt; }
if (isDemo) { $('#demoBand').hidden = false; start({ ...DEMO_USERS.manager }); }
else { const saved = store.get('mp-me') || sessionStorage.getItem('mp-me'); if (saved) start(JSON.parse(saved)); else { $('#login').hidden = false; setTimeout(() => $('#user').focus(), 50); } }
})();
