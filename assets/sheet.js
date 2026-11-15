/* Manage-Performance — built-in spreadsheet (replaces Google Sheets).
 * Sheets are grouped by access scope; each scope is one encrypted file in the repo:
 *   S = Cả nhóm · G = Global (chị + Trang) · L = Local (chị + Phú) · M = Chỉ mình tôi
 * Features: formulas (SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, IFERROR, ROUND, ABS, AND, OR, NOT, SUMIF, COUNTIF,
 * VLOOKUP, CONCAT, LEN, UPPER, LOWER, TODAY), bold/italic, alignment, fill colour, number formats (số, ₫, $, %),
 * insert/delete rows & columns, column resize, sort, filter, freeze header, undo/redo, copy/paste with Excel & Google
 * Sheets (TSV), CSV import/export, templates, autosave with cell-level merge when two people edit at once.
 */
window.CCSheet = (() => {
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const colName = c => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const colIdx = s => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const ref = (r, c) => colName(c) + (r + 1);
const parseRef = s => { const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(s); return m ? { r: +m[2] - 1, c: colIdx(m[1]) } : null; };
const nfVN = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const SCOPES = { S: 'Cả nhóm', G: 'Global', L: 'Local', M: 'Chỉ mình tôi' };
const SCOPE_ICON = { S: '👥', G: '🌎', L: '🏠', M: '🔒' };
const COLORS = ['', '#fde2e1', '#fdebd3', '#fef4c7', '#e3f4dc', '#dceefb', '#ece3f7', '#ebe7e2'];

/* ---------------- values & formulas ---------------- */
function toNum(raw) {
  if (typeof raw === 'number') return raw; if (raw == null) return null; const s = String(raw).trim(); if (!s) return null;
  let m;
  if ((m = /^(-?[\d.,]+)\s*%$/.exec(s))) { const n = toNum(m[1]); return n == null ? null : n / 100; }
  if ((m = /^-?\$?\s*[\d]{1,3}(,\d{3})+(\.\d+)?$/.exec(s)) || /^-?\$?\d+(\.\d+)?$/.test(s)) return Number(s.replace(/[$,\s]/g, ''));
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?\s*₫?$/.test(s)) return Number(s.replace(/[.\s₫]/g, '').replace(',', '.'));
  if (/^-?\d+(,\d+)?\s*₫?$/.test(s)) return Number(s.replace(/[\s₫]/g, '').replace(',', '.'));
  return null;
}
function tokenize(src) {
  const t = [], re = /\s*(?:(\d+(?:\.\d+)?%?)|("(?:[^"]|"")*")|(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)|([A-Z_][A-Z0-9_.]*)(?=\s*\()|(TRUE|FALSE)\b|(<=|>=|<>|[-+*/^&=<>(),:;]))/iy;
  let m, pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos; m = re.exec(src); if (!m || m[0].length === 0) { if (/^\s*$/.test(src.slice(pos))) break; throw new Error('#ERR'); }
    pos = re.lastIndex;
    if (m[1]) t.push({ k: 'n', v: m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]) });
    else if (m[2]) t.push({ k: 's', v: m[2].slice(1, -1).replace(/""/g, '"') });
    else if (m[3]) t.push({ k: 'r', v: m[3].toUpperCase().replace(/\$/g, '') });
    else if (m[4]) t.push({ k: 'f', v: m[4].toUpperCase() });
    else if (m[5]) t.push({ k: 'b', v: m[5].toUpperCase() === 'TRUE' });
    else t.push({ k: 'o', v: m[6] === ';' ? ',' : m[6] });
  }
  return t;
}
class Err { constructor(c) { this.c = c; } toString() { return this.c; } }
const isErr = v => v instanceof Err;
function evalFormula(src, getCell, getRange) {
  const T = tokenize(src); let i = 0;
  const peek = () => T[i], eat = v => { const x = T[i]; if (!x || (v && x.v !== v)) throw new Error('#ERR'); i++; return x; };
  const num = v => { if (isErr(v)) throw v; if (Array.isArray(v)) v = v[0]; if (typeof v === 'boolean') return v ? 1 : 0; if (v === '' || v == null) return 0; const n = typeof v === 'number' ? v : toNum(v); if (n == null) throw new Err('#VALUE!'); return n; };
  const str = v => { if (isErr(v)) throw v; if (Array.isArray(v)) v = v[0]; return v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : String(v); };
  function cmp() { let a = cat(); while (peek() && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v) && peek().k === 'o') { const o = eat().v, b = cat(); const x = typeof a === 'number' || toNum(a) != null ? num(a) : str(a).toLowerCase(), y = typeof b === 'number' || toNum(b) != null ? num(b) : str(b).toLowerCase(); a = o === '=' ? x == y : o === '<>' ? x != y : o === '<' ? x < y : o === '>' ? x > y : o === '<=' ? x <= y : x >= y; } return a; }
  function cat() { let a = add(); while (peek() && peek().v === '&') { eat(); a = str(a) + str(add()); } return a; }
  function add() { let a = mul(); while (peek() && (peek().v === '+' || peek().v === '-') && peek().k === 'o') { const o = eat().v, b = mul(); a = o === '+' ? num(a) + num(b) : num(a) - num(b); } return a; }
  function mul() { let a = pw(); while (peek() && (peek().v === '*' || peek().v === '/')) { const o = eat().v, b = pw(); if (o === '/' && num(b) === 0) throw new Err('#DIV/0!'); a = o === '*' ? num(a) * num(b) : num(a) / num(b); } return a; }
  function pw() { let a = un(); while (peek() && peek().v === '^') { eat(); a = Math.pow(num(a), num(un())); } return a; }
  function un() { if (peek() && peek().v === '-') { eat(); return -num(un()); } if (peek() && peek().v === '+') { eat(); return num(un()); } return prim(); }
  function prim() {
    const x = peek(); if (!x) throw new Error('#ERR');
    if (x.k === 'n' || x.k === 's' || x.k === 'b') { i++; return x.v; }
    if (x.k === 'r') { i++; return x.v.includes(':') ? getRange(x.v) : getCell(x.v); }
    if (x.k === 'o' && x.v === '(') { eat('('); const v = cmp(); eat(')'); return v; }
    if (x.k === 'f') { i++; eat('('); const args = []; if (peek() && peek().v !== ')') { args.push(argv()); while (peek() && peek().v === ',') { eat(','); args.push(argv()); } } eat(')'); return fn(x.v, args); }
    throw new Error('#ERR');
  }
  function argv() { try { return cmp(); } catch (e) { if (isErr(e)) return e; throw e; } }
  const flat = args => args.flatMap(a => Array.isArray(a) ? a.flat(2) : [a]);
  const nums = args => flat(args).map(v => { if (isErr(v)) throw v; return typeof v === 'number' ? v : typeof v === 'boolean' ? null : toNum(v); }).filter(v => v != null);
  const crit = c => { const s = str(c), m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s), op = m[1] || '=', val = m[2], n = toNum(val); return v => { const vn = typeof v === 'number' ? v : toNum(v); const a = n != null && vn != null ? vn : String(v ?? '').toLowerCase(), b = n != null && vn != null ? n : val.toLowerCase(); return op === '=' ? a == b : op === '<>' ? a != b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b; }; };
  function fn(name, a) {
    const A = (k) => { const v = a[k]; if (isErr(v)) throw v; return v; };
    switch (name) {
      case 'SUM': return nums(a).reduce((s, x) => s + x, 0);
      case 'AVERAGE': case 'AVG': { const n = nums(a); if (!n.length) throw new Err('#DIV/0!'); return n.reduce((s, x) => s + x, 0) / n.length; }
      case 'MIN': { const n = nums(a); return n.length ? Math.min(...n) : 0; }
      case 'MAX': { const n = nums(a); return n.length ? Math.max(...n) : 0; }
      case 'COUNT': return nums(a).length;
      case 'COUNTA': return flat(a).filter(v => v !== '' && v != null).length;
      case 'IF': return (typeof A(0) === 'boolean' ? A(0) : num(A(0)) !== 0) ? (a.length > 1 ? A(1) : true) : (a.length > 2 ? A(2) : false);
      case 'IFERROR': return isErr(a[0]) ? A(1) : a[0];
      case 'ROUND': return Math.round(num(A(0)) * Math.pow(10, a.length > 1 ? num(A(1)) : 0)) / Math.pow(10, a.length > 1 ? num(A(1)) : 0);
      case 'ABS': return Math.abs(num(A(0)));
      case 'AND': return flat(a).every(v => typeof v === 'boolean' ? v : num(v) !== 0);
      case 'OR': return flat(a).some(v => typeof v === 'boolean' ? v : num(v) !== 0);
      case 'NOT': return !(typeof A(0) === 'boolean' ? A(0) : num(A(0)) !== 0);
      case 'CONCAT': case 'CONCATENATE': return flat(a).map(str).join('');
      case 'LEN': return str(A(0)).length;
      case 'UPPER': return str(A(0)).toUpperCase();
      case 'LOWER': return str(A(0)).toLowerCase();
      case 'TODAY': { const d = new Date(Date.now() + 7 * 36e5); return d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7) + '/' + d.toISOString().slice(0, 4); }
      case 'SUMIF': { const r = flat([A(0)]), f = crit(A(1)), s = a.length > 2 ? flat([A(2)]) : r; return r.reduce((t, v, k) => t + (f(v) ? (toNum(s[k]) ?? (typeof s[k] === 'number' ? s[k] : 0)) : 0), 0); }
      case 'COUNTIF': { const f = crit(A(1)); return flat([A(0)]).filter(f).length; }
      case 'VLOOKUP': { const rows = A(1), key = A(0), col = num(A(2)) - 1, exact = a.length < 4 || !(typeof A(3) === 'boolean' ? A(3) : num(A(3))); if (!Array.isArray(rows)) throw new Err('#REF!'); const k = str(key).toLowerCase(); const row = rows.find(rw => str(rw[0]).toLowerCase() === k); if (!row) { if (exact) throw new Err('#N/A'); } return row ? row[col] ?? '' : ''; }
      default: throw new Err('#NAME?');
    }
  }
  const v = cmp(); if (i < T.length) throw new Error('#ERR'); return v;
}

/* ---------------- module state ---------------- */
let H = null; // host context
const S = { scopes: {}, base: {}, active: null, sel: { r: 0, c: 0, r2: 0, c2: 0 }, edit: null, undo: [], redo: [], dirty: new Set(), saving: false, status: '', filter: '', calc: null };

function sheetById(id) { for (const k in S.scopes) { const s = S.scopes[k].sheets.find(x => x.id === id); if (s) return { s, scope: k }; } return null; }
const cur = () => S.active && sheetById(S.active);
function blank(name, rows = 60, cols = 12) { return { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, rows, cols, cells: {}, fmt: {}, widths: {}, frozen: 1, updatedAt: null, updatedBy: null }; }

/* computed values with memo + cycle guard */
function computer(sh) {
  const memo = {}, stack = new Set();
  const raw = k => sh.cells[k] ?? '';
  function val(k) {
    if (k in memo) return memo[k]; const r = raw(k);
    if (typeof r === 'string' && r.startsWith('=')) {
      if (stack.has(k)) return new Err('#CYCLE!'); stack.add(k);
      let v; try { v = evalFormula(r.slice(1), x => { const p = parseRef(x); if (!p) throw new Err('#REF!'); const y = val(x); if (isErr(y)) throw y; return y; }, rg => { const [a, b] = rg.split(':').map(parseRef); if (!a || !b) throw new Err('#REF!'); const out = []; for (let i = Math.min(a.r, b.r); i <= Math.max(a.r, b.r); i++) { const row = []; for (let j = Math.min(a.c, b.c); j <= Math.max(a.c, b.c); j++) { const y = val(ref(i, j)); row.push(isErr(y) ? y : y); } out.push(row); } return out; }); }
      catch (e) { v = isErr(e) ? e : new Err(e.message && e.message.startsWith('#') ? e.message : '#ERR'); }
      stack.delete(k); return (memo[k] = v);
    }
    const n = toNum(r); return (memo[k] = n != null ? n : r);
  }
  return val;
}
function display(v, f) {
  if (isErr(v)) return v.c; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return v;
  const nf = f && f.nf;
  if (nf === 'vnd') return Math.round(v).toLocaleString('vi-VN') + '₫';
  if (nf === 'usd') return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (nf === 'pct') return (v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
  if (nf === 'int') return Math.round(v).toLocaleString('vi-VN');
  return nfVN.format(v);
}

/* ---------------- persistence (with cell-level merge) ---------------- */
function diffScope(base, curv) {
  const P = { add: [], del: [], ch: {} }, bm = new Map((base.sheets || []).map(s => [s.id, s]));
  for (const s of curv.sheets) {
    const b = bm.get(s.id); if (!b) { P.add.push(clone(s)); continue; }
    const d = { cells: {}, fmt: {}, meta: {} }; let any = false;
    for (const k of new Set([...Object.keys(s.cells), ...Object.keys(b.cells)])) if ((s.cells[k] ?? '') !== (b.cells[k] ?? '')) { d.cells[k] = s.cells[k] ?? null; any = true; }
    for (const k of new Set([...Object.keys(s.fmt), ...Object.keys(b.fmt)])) if (JSON.stringify(s.fmt[k] || null) !== JSON.stringify(b.fmt[k] || null)) { d.fmt[k] = s.fmt[k] || null; any = true; }
    for (const k of ['name', 'rows', 'cols', 'frozen', 'widths', 'order']) if (JSON.stringify(s[k]) !== JSON.stringify(b[k])) { d.meta[k] = clone(s[k]); any = true; }
    if (d.rebase = s._rebase) { d.full = clone(s); any = true; }
    if (any) P.ch[s.id] = d;
  }
  for (const b of base.sheets || []) if (!curv.sheets.find(s => s.id === b.id)) P.del.push(b.id);
  return P;
}
const emptyP = P => !P.add.length && !P.del.length && !Object.keys(P.ch).length;
function applyP(data, P, who) {
  data.sheets = (data.sheets || []).filter(s => !P.del.includes(s.id));
  for (const s of P.add) if (!data.sheets.find(x => x.id === s.id)) data.sheets.push(s);
  for (const [id, d] of Object.entries(P.ch)) {
    let s = data.sheets.find(x => x.id === id); if (!s) continue;
    if (d.full) { Object.assign(s, d.full); delete s._rebase; }
    for (const [k, v] of Object.entries(d.cells)) { if (v === null || v === '') delete s.cells[k]; else s.cells[k] = v; }
    for (const [k, v] of Object.entries(d.fmt)) { if (v === null) delete s.fmt[k]; else s.fmt[k] = v; }
    Object.assign(s, d.meta); s.updatedAt = H.now(); s.updatedBy = who;
  }
  for (const s of data.sheets) delete s._rebase;
  return data;
}
async function load() {
  S.status = 'Đang tải…'; paintStatus();
  for (const sc of H.scopes) {
    try { S.scopes[sc] = await H.read(sc); } catch (e) { S.scopes[sc] = { sheets: [], err: String(e.message || e) }; }
    S.scopes[sc].sheets = S.scopes[sc].sheets || []; S.base[sc] = clone(S.scopes[sc]);
  }
  if (!all().length && H.canWrite && H.scopes.includes('S')) { const s = template('plan'); S.scopes.S.sheets.push(s); S.dirty.add('S'); queueSave(); }
  if (!S.active || !sheetById(S.active)) S.active = (all()[0] || {}).id || null;
  S.status = H.canWrite ? 'Đã đồng bộ' : 'Chỉ xem (chưa có GitHub token)'; render();
}
const all = () => H.scopes.flatMap(k => (S.scopes[k] ? S.scopes[k].sheets.map(s => ({ ...s, _scope: k })) : []));
let saveT = null;
function queueSave() { if (!H.canWrite) return; S.status = 'Chưa lưu…'; paintStatus(); clearTimeout(saveT); saveT = setTimeout(saveAll, 1200); }
async function saveAll() {
  if (S.saving) { queueSave(); return; } S.saving = true;
  try {
    for (const sc of [...S.dirty]) {
      S.dirty.delete(sc); S.status = 'Đang lưu…'; paintStatus();
      const P = diffScope(S.base[sc], S.scopes[sc]); if (emptyP(P)) continue;
      const atStart = clone(S.scopes[sc]);
      const result = await H.write(sc, remote => applyP(remote, P, H.me.id), 'sheet: ' + (H.me.name || H.me.id) + ' cập nhật ' + SCOPES[sc]);
      const P2 = diffScope(atStart, S.scopes[sc]);          // edits typed while saving
      S.base[sc] = clone(result); S.scopes[sc] = applyP(clone(result), P2, H.me.id); if (!emptyP(P2)) S.dirty.add(sc);
    }
    S.status = 'Đã lưu ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (!sheetById(S.active)) S.active = (all()[0] || {}).id || null;
    render(true);
  } catch (e) { S.status = 'Lỗi lưu: ' + (e.message || e); for (const k of H.scopes) S.dirty.add(k); }
  finally { S.saving = false; paintStatus(); if (S.dirty.size) { clearTimeout(saveT); saveT = setTimeout(saveAll, 4000); } }
}

/* ---------------- templates ---------------- */
function template(kind) {
  if (kind === 'tasks') { const s = blank('Theo dõi việc tuần', 80, 9); ['Ngày', 'Kênh', 'Việc', 'Người phụ trách', 'Hạn', 'Trạng thái', 'Mức độ', 'Link bằng chứng', 'Ghi chú'].forEach((h, c) => { s.cells[ref(0, c)] = h; s.fmt[ref(0, c)] = { b: 1, bg: '#ebe7e2' }; }); s.widths = { A: 90, C: 280, D: 150, H: 220, I: 220 }; return s; }
  if (kind === 'weekly') { const s = blank('Báo cáo tuần', 60, 8); ['Tuần', 'Kênh', 'Doanh thu', 'Target', '% đạt', 'Đơn', 'Vấn đề chính', 'Kế hoạch tuần sau'].forEach((h, c) => { s.cells[ref(0, c)] = h; s.fmt[ref(0, c)] = { b: 1, bg: '#ebe7e2' }; }); for (let r = 1; r < 30; r++) { s.cells[ref(r, 4)] = `=IFERROR(C${r + 1}/D${r + 1},"")`; s.fmt[ref(r, 4)] = { nf: 'pct', al: 'r' }; } s.widths = { G: 260, H: 260 }; return s; }
  if (kind === 'plan') {
    const s = blank('Target Kệ 3 tầng · Local', 40, 9);
    const months = ['Hạng mục', 'Tháng 11/2026', 'Tháng 12/2026', 'Tháng 1/2027', 'Tháng 2/2027', 'Tháng 3/2027', 'Tháng 4/2027', 'Tháng 5/2027', 'Tổng cộng'];
    months.forEach((h, c) => { s.cells[ref(0, c)] = h; s.fmt[ref(0, c)] = { b: 1, bg: '#3d312d0f', al: c ? 'r' : 'l' }; });
    const units = [95, 300, 555, 333, 400, 480, 537];
    const rows = [
      ['Sản lượng bán trong tháng (pcs)', c => units[c - 1], 'int', 'sum'],
      ['Sản lượng luỹ kế (pcs)', c => c === 1 ? '=B2' : `=${colName(c - 1)}3+${colName(c)}2`, 'int'],
      ['Tồn kho cuối kỳ (pcs)', c => `=2700-${colName(c)}3`, 'int'],
      ['Giá niêm yết (VND)', () => 700000, 'vnd'],
      ['Giá thấp nhất đảm bảo thu về trên 185k', () => 315000, 'vnd'],
      ['Tổng GMV niêm yết (VND)', c => `=${colName(c)}2*${colName(c)}5`, 'vnd', 'sum'],
      ['Doanh thu thực tế (Net GMV)', c => `=${colName(c)}2*${colName(c)}6`, 'vnd', 'sum'],
      ['Phí cố định sàn (13,18%)', c => `=${colName(c)}8*0.1318`, 'vnd', 'sum'],
      ['Phí xử lý giao dịch (6%)', c => `=${colName(c)}8*0.06`, 'vnd', 'sum'],
      ['Phí gói Voucher Xtra (5,2%)', c => `=${colName(c)}8*0.052`, 'vnd', 'sum'],
      ['Hoa hồng Affiliate (10%)', c => `=${colName(c)}8*0.1`, 'vnd', 'sum'],
      ['Phí hạ tầng & PiShip (5.052₫/đơn)', c => `=${colName(c)}2*5052`, 'vnd', 'sum'],
      ['Tổng chi phí sàn', c => `=SUM(${colName(c)}9:${colName(c)}13)`, 'vnd', 'sum'],
      ['Chi phí quảng cáo (4%)', c => `=${colName(c)}8*0.04`, 'vnd', 'sum'],
      ['Tổng chi phí Sàn & Ads', c => `=${colName(c)}14+${colName(c)}15`, 'vnd', 'sum'],
      ['Thuê kho Suối Nghệ', () => 20000000, 'vnd', 'sum'],
      ['Doanh thu thuần thực về (Net Revenue)', c => `=${colName(c)}8-${colName(c)}16`, 'vnd', 'sum'],
      ['Commission (3%)', c => `=${colName(c)}18*0.03`, 'vnd', 'sum'],
      ['Profit (chưa gồm COGS)', c => `=${colName(c)}18-${colName(c)}19-${colName(c)}17`, 'vnd', 'sum'],
      ['Doanh thu thuần TB / sản phẩm (VND)', c => `=IFERROR(${colName(c)}18/${colName(c)}2,0)`, 'vnd'],
      ['Biên thực thu / doanh thu bán', c => `=IFERROR(${colName(c)}18/${colName(c)}8,0)`, 'pct']
    ];
    rows.forEach(([label, f, nf, tot], i) => {
      const r = i + 1; s.cells[ref(r, 0)] = label; s.fmt[ref(r, 0)] = { b: [6, 12, 14, 16, 18].includes(i) ? 1 : 0 };
      for (let c = 1; c <= 7; c++) { s.cells[ref(r, c)] = String(f(c)); s.fmt[ref(r, c)] = { nf, al: 'r', ...(i === 18 ? { b: 1, bg: '#fdebd3' } : i === 16 ? { b: 1, bg: '#dceefb' } : [6, 12, 14].includes(i) ? { b: 1 } : {}) }; }
      if (tot === 'sum') { s.cells[ref(r, 8)] = `=SUM(B${r + 1}:H${r + 1})`; s.fmt[ref(r, 8)] = { nf, al: 'r', b: 1 }; }
    });
    s.cells.I3 = '=H3'; s.fmt.I3 = { nf: 'int', al: 'r', b: 1 }; s.cells.I21 = '=IFERROR(I18/I2,0)'; s.fmt.I21 = { nf: 'vnd', al: 'r', b: 1 }; s.cells.I22 = '=IFERROR(I18/I8,0)'; s.fmt.I22 = { nf: 'pct', al: 'r', b: 1 };
    s.widths = { A: 300, B: 128, C: 128, D: 128, E: 128, F: 128, G: 128, H: 128, I: 140 };
    return s;
  }
  return blank('Sheet mới');
}

/* ---------------- rendering ---------------- */
let root = null;
function paintStatus() { const el = root && root.querySelector('#shStatus'); if (el) { el.textContent = S.status; el.className = 'sh-status' + (/Lỗi/.test(S.status) ? ' bad' : /Đang|Chưa/.test(S.status) ? ' busy' : ''); } }
function render(keepScroll) {
  if (!root) return; const c = cur();
  const scroller = root.querySelector('.sh-grid-wrap'), st = scroller ? [scroller.scrollLeft, scroller.scrollTop] : null;
  const tabs = all().map(s => `<button class="sh-tab" data-sheet="${esc(s.id)}" aria-pressed="${s.id === S.active}" title="${esc(SCOPES[s._scope])}"><span>${SCOPE_ICON[s._scope]}</span>${esc(s.name)}</button>`).join('');
  const ro = !H.canWrite || (c && !H.canEdit(c.scope));
  root.innerHTML = `
  <div class="sh-head"><div><h1>Sheet</h1><p>Bảng tính nội bộ thay Google Sheet · mã hoá · lưu tự động · ${c ? `<b>${SCOPE_ICON[c.scope]} ${esc(SCOPES[c.scope])}</b>${c.s.updatedBy ? ` · sửa lần cuối bởi ${esc(c.s.updatedBy)} ${c.s.updatedAt ? new Date(c.s.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}` : ''}` : ''}</p></div><span id="shStatus" class="sh-status"></span></div>
  <div class="sh-bar glass">
    <div class="sh-grp"><button class="sb" data-a="undo" title="Hoàn tác (Ctrl+Z)" ${ro ? 'disabled' : ''}>↶</button><button class="sb" data-a="redo" title="Làm lại (Ctrl+Y)" ${ro ? 'disabled' : ''}>↷</button></div>
    <div class="sh-grp"><button class="sb" data-a="b" title="Đậm (Ctrl+B)" ${ro ? 'disabled' : ''}><b>B</b></button><button class="sb" data-a="i" title="Nghiêng (Ctrl+I)" ${ro ? 'disabled' : ''}><i>I</i></button>
      <button class="sb" data-a="al-l" title="Căn trái" ${ro ? 'disabled' : ''}>⇤</button><button class="sb" data-a="al-c" title="Căn giữa" ${ro ? 'disabled' : ''}>↔</button><button class="sb" data-a="al-r" title="Căn phải" ${ro ? 'disabled' : ''}>⇥</button></div>
    <div class="sh-grp sh-colors">${COLORS.map(cl => `<button class="sw" data-bg="${cl}" title="${cl ? 'Tô màu' : 'Bỏ màu'}" style="background:${cl || 'transparent'}" ${ro ? 'disabled' : ''}>${cl ? '' : '∅'}</button>`).join('')}</div>
    <div class="sh-grp"><select class="ss" data-a="nf" title="Định dạng số" ${ro ? 'disabled' : ''}><option value="">Tự động</option><option value="int">1.234</option><option value="vnd">₫ VND</option><option value="usd">$ USD</option><option value="pct">%</option><option value="text">Văn bản</option></select></div>
    <div class="sh-grp"><button class="sb t" data-a="row+" ${ro ? 'disabled' : ''}>+ Hàng</button><button class="sb t" data-a="col+" ${ro ? 'disabled' : ''}>+ Cột</button><button class="sb t" data-a="row-" ${ro ? 'disabled' : ''}>− Hàng</button><button class="sb t" data-a="col-" ${ro ? 'disabled' : ''}>− Cột</button></div>
    <div class="sh-grp"><button class="sb t" data-a="sortAZ" title="Sắp xếp theo cột đang chọn" ${ro ? 'disabled' : ''}>A→Z</button><button class="sb t" data-a="sortZA" ${ro ? 'disabled' : ''}>Z→A</button><button class="sb t" data-a="freeze" ${ro ? 'disabled' : ''}>${c && c.s.frozen ? 'Bỏ cố định' : 'Cố định'} tiêu đề</button></div>
    <div class="sh-grp"><input class="sf" id="shFilter" placeholder="Lọc hàng…" value="${esc(S.filter)}"></div>
    <div class="sh-grp" style="margin-left:auto"><button class="sb t" data-a="csv">Xuất CSV</button><label class="sb t" ${ro ? 'style="opacity:.5;pointer-events:none"' : ''}>Nhập CSV<input type="file" accept=".csv,.tsv,.txt" id="shImport" hidden></label></div>
  </div>
  <div class="sh-fx glass"><span class="sh-ref" id="shRef"></span><span class="sh-fxi">fx</span><input id="shFx" ${ro ? 'readonly' : ''} spellcheck="false" autocomplete="off"></div>
  ${c ? `<div class="sh-grid-wrap glass" tabindex="0">${grid(c.s)}<input class="sh-ed" id="shEd" hidden spellcheck="false" autocomplete="off"></div>` : `<div class="empty2 glass" style="padding:40px;border-radius:22px">${H.canWrite ? 'Chưa có sheet nào — bấm “+ Sheet mới”.' : 'Chưa có sheet nào.'}</div>`}
  <div class="sh-tabs">${tabs}${H.canWrite ? `<button class="sh-tab add" data-a="new">+ Sheet mới</button>` : ''}${c && !ro ? `<button class="sh-tab more" data-a="menu" title="Đổi tên, nhân bản, chuyển nhóm, xoá">⋯</button>` : ''}</div>
  ${ro && c ? `<p class="sub" style="margin:6px 4px">${!H.canWrite ? 'Chế độ chỉ xem: quản lý cần nhập GitHub token trong Cài đặt để mọi người lưu được.' : 'Bạn chỉ có quyền xem sheet này.'}</p>` : ''}`;
  paintStatus(); bind(); paintSel();
  if (keepScroll && st) { const sc = root.querySelector('.sh-grid-wrap'); if (sc) { sc.scrollLeft = st[0]; sc.scrollTop = st[1]; } }
}
function grid(sh) {
  const val = computer(sh); S.calc = val;
  const f = S.filter.trim().toLowerCase();
  let h = `<table class="sh-grid"><colgroup><col style="width:46px">`;
  for (let c = 0; c < sh.cols; c++) h += `<col style="width:${sh.widths[colName(c)] || 120}px">`;
  h += `</colgroup><thead><tr><th class="corner"></th>`;
  for (let c = 0; c < sh.cols; c++) h += `<th data-col="${c}">${colName(c)}<i class="rz" data-rz="${c}"></i></th>`;
  h += `</tr></thead><tbody>`;
  for (let r = 0; r < sh.rows; r++) {
    if (f && !(sh.frozen && r === 0)) { let hit = false; for (let c = 0; c < sh.cols; c++) { const k = ref(r, c); if (String(display(val(k), sh.fmt[k])).toLowerCase().includes(f)) { hit = true; break; } } if (!hit) continue; }
    h += `<tr class="${sh.frozen && r === 0 ? 'frz' : ''}"><th data-row="${r}">${r + 1}</th>`;
    for (let c = 0; c < sh.cols; c++) {
      const k = ref(r, c), fm = sh.fmt[k] || {}, raw = sh.cells[k];
      const v = raw == null || raw === '' ? '' : fm.nf === 'text' ? raw : val(k);
      const d = v === '' ? '' : display(v, fm), num = typeof v === 'number';
      const st = `${fm.b ? 'font-weight:700;' : ''}${fm.i ? 'font-style:italic;' : ''}${fm.bg ? 'background:' + fm.bg + ';' : ''}text-align:${fm.al === 'c' ? 'center' : fm.al === 'r' ? 'right' : fm.al === 'l' ? 'left' : num ? 'right' : 'left'}`;
      h += `<td data-r="${r}" data-c="${c}" style="${st}" class="${isErr(v) ? 'err' : ''}">${esc(d)}</td>`;
    }
    h += `</tr>`;
  }
  return h + `</tbody></table>`;
}
function paintSel() {
  if (!root) return; const c = cur(); if (!c) return;
  const { r, c: cc, r2, c2 } = S.sel, r0 = Math.min(r, r2), r1 = Math.max(r, r2), c0 = Math.min(cc, c2), c1 = Math.max(cc, c2);
  root.querySelectorAll('td.sel,td.anc').forEach(td => td.classList.remove('sel', 'anc'));
  root.querySelectorAll('td[data-r]').forEach(td => { const y = +td.dataset.r, x = +td.dataset.c; if (y >= r0 && y <= r1 && x >= c0 && x <= c1) td.classList.add(y === r && x === cc ? 'anc' : 'sel'); });
  root.querySelectorAll('th[data-col]').forEach(th => th.classList.toggle('on', +th.dataset.col >= c0 && +th.dataset.col <= c1));
  root.querySelectorAll('th[data-row]').forEach(th => th.classList.toggle('on', +th.dataset.row >= r0 && +th.dataset.row <= r1));
  const k = ref(r, cc); root.querySelector('#shRef').textContent = r0 !== r1 || c0 !== c1 ? `${ref(r0, c0)}:${ref(r1, c1)}` : k;
  const fx = root.querySelector('#shFx'); if (document.activeElement !== fx) fx.value = c.s.cells[k] ?? '';
  const sel = root.querySelector('.ss[data-a="nf"]'); if (sel) sel.value = (c.s.fmt[k] || {}).nf || '';
}

/* ---------------- editing ---------------- */
function setCells(changes, label) { // changes: [{k, v}] raw values
  const c = cur(); if (!c || !H.canEdit(c.scope)) return; const sh = c.s, rec = [];
  for (const { k, v } of changes) { const old = sh.cells[k] ?? ''; if (old === (v ?? '')) continue; rec.push({ k, old, v: v ?? '' }); if (v == null || v === '') delete sh.cells[k]; else sh.cells[k] = v; const p = parseRef(k); if (p.r >= sh.rows) sh.rows = p.r + 1; if (p.c >= sh.cols) sh.cols = p.c + 1; }
  if (!rec.length) return; S.undo.push({ id: sh.id, cells: rec }); S.redo = []; if (S.undo.length > 200) S.undo.shift();
  S.dirty.add(c.scope); queueSave(); render(true);
}
function setFmt(fn) {
  const c = cur(); if (!c || !H.canEdit(c.scope)) return; const sh = c.s, { r, c: cc, r2, c2 } = S.sel, rec = [];
  for (let y = Math.min(r, r2); y <= Math.max(r, r2); y++) for (let x = Math.min(cc, c2); x <= Math.max(cc, c2); x++) { const k = ref(y, x), old = sh.fmt[k] ? clone(sh.fmt[k]) : null, n = fn({ ...(sh.fmt[k] || {}) }); Object.keys(n).forEach(z => { if (n[z] === '' || n[z] == null || n[z] === 0) delete n[z]; }); const nv = Object.keys(n).length ? n : null; if (JSON.stringify(old) !== JSON.stringify(nv)) { rec.push({ k, old, v: nv }); if (nv) sh.fmt[k] = nv; else delete sh.fmt[k]; } }
  if (!rec.length) return; S.undo.push({ id: sh.id, fmt: rec }); S.redo = []; S.dirty.add(c.scope); queueSave(); render(true);
}
function undoRedo(from, to) {
  const op = from.pop(); if (!op) return; const hit = sheetById(op.id); if (!hit) return; S.active = op.id;
  const inv = { id: op.id };
  if (op.cells) { inv.cells = op.cells.map(x => ({ k: x.k, old: x.v, v: x.old })); for (const x of op.cells) { if (x.old === '') delete hit.s.cells[x.k]; else hit.s.cells[x.k] = x.old; } }
  if (op.fmt) { inv.fmt = op.fmt.map(x => ({ k: x.k, old: x.v, v: x.old })); for (const x of op.fmt) { if (x.old) hit.s.fmt[x.k] = x.old; else delete hit.s.fmt[x.k]; } }
  if (op.snap) { inv.snap = clone(hit.s); Object.assign(hit.s, clone(op.snap)); hit.s._rebase = 1; }
  to.push(inv); S.dirty.add(hit.scope); queueSave(); render(true);
}
function structural(fn) { // row/col operations: snapshot for undo, full sheet rebase on save
  const c = cur(); if (!c || !H.canEdit(c.scope)) return; const snap = clone(c.s); fn(c.s); c.s._rebase = 1; S.undo.push({ id: c.s.id, snap }); S.redo = []; S.dirty.add(c.scope); queueSave(); render(true);
}
function shiftMap(map, axis, at, delta) { const out = {}; for (const [k, v] of Object.entries(map)) { const p = parseRef(k); const pos = axis === 'r' ? p.r : p.c; if (delta < 0 && pos === at) continue; const np = pos >= at + (delta < 0 ? 1 : 0) ? pos + delta : pos; out[axis === 'r' ? ref(np, p.c) : ref(p.r, np)] = v; } return out; }
function startEdit(initial) {
  const c = cur(); if (!c || !H.canEdit(c.scope)) return; const td = root.querySelector(`td[data-r="${S.sel.r}"][data-c="${S.sel.c}"]`); if (!td) return;
  const ed = root.querySelector('#shEd'), wrap = root.querySelector('.sh-grid-wrap');
  const a = td.getBoundingClientRect(), b = wrap.getBoundingClientRect();
  ed.hidden = false; ed.style.left = (a.left - b.left + wrap.scrollLeft) + 'px'; ed.style.top = (a.top - b.top + wrap.scrollTop) + 'px'; ed.style.width = Math.max(a.width, 160) + 'px'; ed.style.height = a.height + 'px';
  ed.value = initial != null ? initial : (c.s.cells[ref(S.sel.r, S.sel.c)] ?? ''); S.edit = { r: S.sel.r, c: S.sel.c }; ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length);
}
function commitEdit(move) {
  const ed = root.querySelector('#shEd'); if (!S.edit || !ed) return; const { r, c } = S.edit; S.edit = null; ed.hidden = true;
  setCells([{ k: ref(r, c), v: ed.value }]); if (move) moveSel(move[0], move[1]); root.querySelector('.sh-grid-wrap').focus({ preventScroll: true });
}
function moveSel(dr, dc, extend) {
  const c = cur(); if (!c) return; const s = S.sel;
  if (extend) { s.r2 = Math.max(0, Math.min(c.s.rows - 1, s.r2 + dr)); s.c2 = Math.max(0, Math.min(c.s.cols - 1, s.c2 + dc)); }
  else { s.r = s.r2 = Math.max(0, Math.min(c.s.rows - 1, s.r + dr)); s.c = s.c2 = Math.max(0, Math.min(c.s.cols - 1, s.c + dc)); }
  paintSel(); const td = root.querySelector(`td[data-r="${s.r2}"][data-c="${s.c2}"]`); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function selRange() { const { r, c, r2, c2 } = S.sel; return [Math.min(r, r2), Math.max(r, r2), Math.min(c, c2), Math.max(c, c2)]; }
function copyTSV(cut) {
  const c = cur(); if (!c) return ''; const [r0, r1, c0, c1] = selRange(), lines = [];
  for (let y = r0; y <= r1; y++) { const row = []; for (let x = c0; x <= c1; x++) row.push(String(c.s.cells[ref(y, x)] ?? '').replace(/[\t\n]/g, ' ')); lines.push(row.join('\t')); }
  if (cut) { const ch = []; for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) ch.push({ k: ref(y, x), v: '' }); setCells(ch); }
  return lines.join('\n');
}
function parseDelim(text, d) { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; } else if (ch === '"' && f === '') q = true; else if (ch === d) { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += ch; } if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows; }
function pasteText(text) { const rows = parseDelim(text.replace(/\n$/, ''), text.includes('\t') ? '\t' : (text.includes(',') && text.includes('\n') ? ',' : '\t')); const ch = []; rows.forEach((row, y) => row.forEach((v, x) => ch.push({ k: ref(S.sel.r + y, S.sel.c + x), v }))); setCells(ch); S.sel.r2 = S.sel.r + rows.length - 1; S.sel.c2 = S.sel.c + Math.max(...rows.map(r => r.length)) - 1; paintSel(); }
function sortBy(dir) {
  const c = cur(); if (!c) return; const col = S.sel.c, start = c.s.frozen ? 1 : 0, val = computer(c.s);
  structural(sh => { let last = start; for (let r = start; r < sh.rows; r++) for (let x = 0; x < sh.cols; x++) if (sh.cells[ref(r, x)] != null) last = r;
    const rows = []; for (let r = start; r <= last; r++) { const cells = {}, fmt = {}; for (let x = 0; x < sh.cols; x++) { const k = ref(r, x); if (sh.cells[k] != null) cells[x] = sh.cells[k]; if (sh.fmt[k]) fmt[x] = sh.fmt[k]; } rows.push({ key: val(ref(r, col)), cells, fmt }); }
    const empty = v => v === '' || v == null; rows.sort((a, b) => empty(a.key) - empty(b.key) || (typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), 'vi')) * dir);
    rows.forEach((row, i) => { const r = start + i; for (let x = 0; x < sh.cols; x++) { const k = ref(r, x); delete sh.cells[k]; delete sh.fmt[k]; if (row.cells[x] != null) sh.cells[k] = row.cells[x]; if (row.fmt[x]) sh.fmt[k] = row.fmt[x]; } }); });
}

/* ---------------- events ---------------- */
function bind() {
  const wrap = root.querySelector('.sh-grid-wrap'), fx = root.querySelector('#shFx'), ed = root.querySelector('#shEd');
  root.querySelectorAll('[data-sheet]').forEach(b => b.onclick = () => { S.active = b.dataset.sheet; S.sel = { r: 0, c: 0, r2: 0, c2: 0 }; S.filter = ''; render(); });
  root.querySelector('#shFilter').oninput = e => { S.filter = e.target.value; const pos = e.target.selectionStart; render(true); const f = root.querySelector('#shFilter'); f.focus(); f.setSelectionRange(pos, pos); };
  const imp = root.querySelector('#shImport'); if (imp) imp.onchange = async e => { const f = e.target.files[0]; if (!f) return; const t = await f.text(); S.sel = { r: 0, c: 0, r2: 0, c2: 0 }; const rows = parseDelim(t, f.name.endsWith('.tsv') || t.includes('\t') ? '\t' : ','); const ch = []; rows.forEach((row, y) => row.forEach((v, x) => ch.push({ k: ref(y, x), v }))); setCells(ch); H.toast('Đã nhập ' + rows.length + ' hàng'); };
  root.querySelectorAll('[data-a]').forEach(b => { if (b.tagName === 'SELECT') b.onchange = () => setFmt(f => ({ ...f, nf: b.value })); else b.onclick = () => action(b.dataset.a); });
  root.querySelectorAll('[data-bg]').forEach(b => b.onclick = () => setFmt(f => ({ ...f, bg: b.dataset.bg })));
  if (!wrap) return;
  let drag = false;
  wrap.addEventListener('mousedown', e => {
    const rz = e.target.closest('[data-rz]'); if (rz) { e.preventDefault(); const c = cur(), col = colName(+rz.dataset.rz), x0 = e.clientX, w0 = c.s.widths[col] || 120; const mv = ev => { c.s.widths[col] = Math.max(48, Math.round(w0 + ev.clientX - x0)); const cg = wrap.querySelectorAll('col')[+rz.dataset.rz + 1]; if (cg) cg.style.width = c.s.widths[col] + 'px'; }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (H.canEdit(c.scope)) { S.dirty.add(c.scope); queueSave(); } }; addEventListener('mousemove', mv); addEventListener('mouseup', up); return; }
    const td = e.target.closest('td[data-r]'), thc = e.target.closest('th[data-col]'), thr = e.target.closest('th[data-row]');
    if (S.edit && e.target !== ed) commitEdit();
    const c = cur(); if (!c) return;
    if (thc) { S.sel = { r: 0, c: +thc.dataset.col, r2: c.s.rows - 1, c2: +thc.dataset.col }; paintSel(); return; }
    if (thr) { S.sel = { r: +thr.dataset.row, c: 0, r2: +thr.dataset.row, c2: c.s.cols - 1 }; paintSel(); return; }
    if (!td) return;
    if (e.shiftKey) { S.sel.r2 = +td.dataset.r; S.sel.c2 = +td.dataset.c; } else S.sel = { r: +td.dataset.r, c: +td.dataset.c, r2: +td.dataset.r, c2: +td.dataset.c };
    drag = true; paintSel(); wrap.focus({ preventScroll: true });
  });
  wrap.addEventListener('mouseover', e => { if (!drag) return; const td = e.target.closest('td[data-r]'); if (td) { S.sel.r2 = +td.dataset.r; S.sel.c2 = +td.dataset.c; paintSel(); } });
  addEventListener('mouseup', () => { drag = false; }, { once: true });
  wrap.addEventListener('dblclick', e => { if (e.target.closest('td[data-r]')) startEdit(); });
  wrap.addEventListener('keydown', e => {
    if (e.target === ed) {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit([1, 0]); } else if (e.key === 'Tab') { e.preventDefault(); commitEdit([0, e.shiftKey ? -1 : 1]); } else if (e.key === 'Escape') { S.edit = null; ed.hidden = true; wrap.focus(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(e.shiftKey ? S.redo : S.undo, e.shiftKey ? S.undo : S.redo); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undoRedo(S.redo, S.undo); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); action('b'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); action('i'); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); const c = cur(); S.sel = { r: 0, c: 0, r2: c.s.rows - 1, c2: c.s.cols - 1 }; paintSel(); return; }
    if (mod) return; // copy / paste handled by clipboard events
    const k = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (k) { e.preventDefault(); moveSel(k[0], k[1], e.shiftKey); return; }
    if (e.key === 'Enter') { e.preventDefault(); startEdit(); return; }
    if (e.key === 'Tab') { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'F2') { e.preventDefault(); startEdit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const [r0, r1, c0, c1] = selRange(), ch = []; for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) ch.push({ k: ref(y, x), v: '' }); setCells(ch); return; }
    if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(e.key); }
  });
  wrap.addEventListener('copy', e => { if (S.edit) return; e.preventDefault(); e.clipboardData.setData('text/plain', copyTSV(false)); H.toast('Đã copy'); });
  wrap.addEventListener('cut', e => { if (S.edit) return; e.preventDefault(); e.clipboardData.setData('text/plain', copyTSV(true)); });
  wrap.addEventListener('paste', e => { if (S.edit) return; e.preventDefault(); pasteText(e.clipboardData.getData('text/plain')); });
  ed.addEventListener('blur', () => { if (S.edit) commitEdit(); });
  fx.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setCells([{ k: ref(S.sel.r, S.sel.c), v: fx.value }]); moveSel(1, 0); wrap.focus(); } else if (e.key === 'Escape') { paintSel(); wrap.focus(); } });
}
function action(a) {
  const c = cur();
  if (a === 'new') return newSheetModal();
  if (a === 'menu') return sheetMenu();
  if (a === 'csv') { if (!c) return; const val = computer(c.s), lines = []; for (let r = 0; r < c.s.rows; r++) { const row = []; let any = false; for (let x = 0; x < c.s.cols; x++) { const v = c.s.cells[ref(r, x)] != null ? display(val(ref(r, x)), {}) : ''; if (v !== '') any = true; row.push(/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v); } lines.push(any ? row.join(',') : ''); } while (lines.length && !lines[lines.length - 1]) lines.pop(); const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = c.s.name + '.csv'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); return; }
  if (!c || !H.canEdit(c.scope)) return;
  if (a === 'undo') return undoRedo(S.undo, S.redo);
  if (a === 'redo') return undoRedo(S.redo, S.undo);
  if (a === 'b') { const on = !(c.s.fmt[ref(S.sel.r, S.sel.c)] || {}).b; return setFmt(f => ({ ...f, b: on ? 1 : 0 })); }
  if (a === 'i') { const on = !(c.s.fmt[ref(S.sel.r, S.sel.c)] || {}).i; return setFmt(f => ({ ...f, i: on ? 1 : 0 })); }
  if (a.startsWith('al-')) return setFmt(f => ({ ...f, al: a.slice(3) }));
  if (a === 'freeze') return structural(sh => { sh.frozen = sh.frozen ? 0 : 1; });
  if (a === 'sortAZ') return sortBy(1);
  if (a === 'sortZA') return sortBy(-1);
  const [r0, r1, c0, c1] = selRange();
  if (a === 'row+') return structural(sh => { sh.cells = shiftMap(sh.cells, 'r', r1 + 1, 1); sh.fmt = shiftMap(sh.fmt, 'r', r1 + 1, 1); sh.rows++; });
  if (a === 'col+') return structural(sh => { sh.cells = shiftMap(sh.cells, 'c', c1 + 1, 1); sh.fmt = shiftMap(sh.fmt, 'c', c1 + 1, 1); const w = {}; for (const [k, v] of Object.entries(sh.widths)) { const i = colIdx(k); w[colName(i > c1 ? i + 1 : i)] = v; } sh.widths = w; sh.cols++; });
  if (a === 'row-') return structural(sh => { for (let y = r1; y >= r0; y--) { sh.cells = shiftMap(sh.cells, 'r', y, -1); sh.fmt = shiftMap(sh.fmt, 'r', y, -1); sh.rows = Math.max(1, sh.rows - 1); } S.sel = { r: r0, c: S.sel.c, r2: r0, c2: S.sel.c }; });
  if (a === 'col-') return structural(sh => { for (let x = c1; x >= c0; x--) { sh.cells = shiftMap(sh.cells, 'c', x, -1); sh.fmt = shiftMap(sh.fmt, 'c', x, -1); const w = {}; for (const [k, v] of Object.entries(sh.widths)) { const i = colIdx(k); if (i !== x) w[colName(i > x ? i - 1 : i)] = v; } sh.widths = w; sh.cols = Math.max(1, sh.cols - 1); } S.sel = { r: S.sel.r, c: c0, r2: S.sel.r, c2: c0 }; });
}
function scopeOptions(sel) { return H.scopes.filter(k => H.canEdit(k)).map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${SCOPE_ICON[k]} ${SCOPES[k]}</option>`).join(''); }
function newSheetModal() {
  H.modal(`<h3>Sheet mới</h3><label>Tên sheet<input id="nsName" value="Sheet ${all().length + 1}"></label>
    <label>Ai được xem & sửa<select id="nsScope">${scopeOptions(H.me.role === 'manager' ? 'M' : (H.scopes.includes('G') ? 'G' : 'L'))}</select></label>
    <label>Mẫu<select id="nsTpl"><option value="blank">Trống</option><option value="tasks">Theo dõi việc tuần</option><option value="weekly">Báo cáo tuần (có công thức % đạt)</option><option value="plan">Target Kệ 3 tầng (bảng kế hoạch có công thức)</option></select></label>
    <div class="foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="nsGo">Tạo</button></div>`, m => {
    m.querySelector('#nsGo').onclick = () => { const s = template(m.querySelector('#nsTpl').value), name = m.querySelector('#nsName').value.trim(); if (name) s.name = name; const sc = m.querySelector('#nsScope').value; S.scopes[sc].sheets.push(s); S.active = s.id; S.sel = { r: 0, c: 0, r2: 0, c2: 0 }; S.dirty.add(sc); H.closeModal(); queueSave(); render(); };
  });
}
function sheetMenu() {
  const c = cur(); if (!c) return;
  H.modal(`<h3>${esc(c.s.name)}</h3><label>Đổi tên<input id="smName" value="${esc(c.s.name)}"></label><label>Ai được xem & sửa<select id="smScope">${scopeOptions(c.scope)}</select></label>
    <div class="foot" style="justify-content:space-between"><div style="display:flex;gap:8px"><button class="btn danger" id="smDel">Xoá sheet</button><button class="btn ghost" id="smDup">Nhân bản</button></div><div style="display:flex;gap:8px"><button class="btn ghost" data-close>Huỷ</button><button class="btn pri" id="smGo">Lưu</button></div></div>`, m => {
    m.querySelector('#smGo').onclick = () => { const name = m.querySelector('#smName').value.trim() || c.s.name, sc = m.querySelector('#smScope').value; c.s.name = name; if (sc !== c.scope) { S.scopes[c.scope].sheets = S.scopes[c.scope].sheets.filter(x => x.id !== c.s.id); const moved = clone(c.s); S.scopes[sc].sheets.push(moved); S.dirty.add(sc); } S.dirty.add(c.scope); H.closeModal(); queueSave(); render(); };
    m.querySelector('#smDup').onclick = () => { const d = clone(c.s); d.id = blank('x').id; d.name = c.s.name + ' (bản sao)'; S.scopes[c.scope].sheets.push(d); S.active = d.id; S.dirty.add(c.scope); H.closeModal(); queueSave(); render(); };
    m.querySelector('#smDel').onclick = () => { if (!confirm('Xoá sheet "' + c.s.name + '"? (Vẫn khôi phục được từ lịch sử repo)')) return; S.scopes[c.scope].sheets = S.scopes[c.scope].sheets.filter(x => x.id !== c.s.id); S.active = (all()[0] || {}).id || null; S.dirty.add(c.scope); H.closeModal(); queueSave(); render(); };
  });
}

return {
  mount(el, host) { root = el; if (H !== host) { H = host; S.scopes = {}; S.base = {}; load(); } else render(true); },
  unmount() { root = null; },
  hasUnsaved: () => S.dirty.size > 0 || S.saving,
  _test: { evalFormula, toNum, computer, template, diffScope, applyP }
};
})();
