/* Manage-Performance — encrypted storage on GitHub (replaces Google Sheet / Apps Script).
 * Every data file lives in this repo under data/, AES-256-GCM encrypted. Who can read a file depends on which keys
 * the user's vault bundle holds:  S = whole team · G = Global (Trang + manager) · L = Local (Phú + manager) · M = manager only.
 * Writes go through the GitHub Contents API with the team's fine-grained token (itself stored encrypted with key S).
 * Every write is a git commit, so the full history of every change stays auditable in the repo.
 */
window.CCS = (() => {
  'use strict';
  const CFG = window.CC_CONFIG, te = new TextEncoder(), td = new TextDecoder();
  const b64e = u => { const a = new Uint8Array(u); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = u => [...new Uint8Array(u)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha = async s => hex(await crypto.subtle.digest('SHA-256', te.encode(s)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clone = o => JSON.parse(JSON.stringify(o));
  const ITER = 250000;
  let token = null, skew = 0;

  /* ---------- crypto ---------- */
  const aes = (b64, usage = ['encrypt', 'decrypt']) => crypto.subtle.importKey('raw', b64d(b64), 'AES-GCM', false, usage);
  async function enc(keyB64, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { v: 1, iv: b64e(iv), ct: b64e(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(keyB64), te.encode(JSON.stringify(obj)))) }; }
  async function dec(keyB64, f) { return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(f.iv) }, await aes(keyB64), b64d(f.ct)))); }
  async function hmac(keyB64, str) { const k = await crypto.subtle.importKey('raw', b64d(keyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64e(await crypto.subtle.sign('HMAC', k, te.encode(str))); }
  const newKey = () => b64e(crypto.getRandomValues(new Uint8Array(32)));
  const hint = async user => (await sha('mp|' + user.trim().toLowerCase())).slice(0, 16);
  async function kek(user, pass, salt, usage) {
    const base = await crypto.subtle.importKey('raw', te.encode(user.trim().toLowerCase() + '\n' + pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, usage);
  }
  async function makeSlot(user, pass, bundle) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await kek(user, pass, salt, ['encrypt']);
    return { h: await hint(user), salt: b64e(salt), iv: b64e(iv), ct: b64e(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(bundle)))) };
  }
  async function openSlot(vault, user, pass) {
    const h = await hint(user), s = (vault.users || []).find(x => x.h === h); if (!s) throw new Error('bad');
    try { const k = await kek(user, pass, b64d(s.salt), ['decrypt']); return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(s.iv) }, k, b64d(s.ct)))); }
    catch (e) { throw new Error('bad'); }
  }

  /* ---------- GitHub ---------- */
  const API = `https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/contents/`;
  // accounts & config stay on main (readable before login, also via GitHub Pages); everything that changes often lives on the data branch
  const MAIN_FILES = /^data\/(vault\.json|token\.enc\.json|src-[a-z]+\.enc\.json)$/;
  const branchOf = path => MAIN_FILES.test(path) || !CFG.DATA_BRANCH ? CFG.BRANCH : CFG.DATA_BRANCH;
  const hdr = () => token ? { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } : { Accept: 'application/vnd.github+json' };
  async function apiGet(path, ref) {
    let r = null;
    try { r = await fetch(API + path + '?ref=' + ref, { headers: hdr(), cache: 'no-store' }); } catch (e) { return { err: true }; }
    if (r.status === 404) return { none: true };
    if (!r.ok) return { err: true, status: r.status };
    const j = await r.json();
    if (j.encoding === 'base64' && j.content) return { sha: j.sha, text: td.decode(b64d(j.content.replace(/\n/g, ''))) };
    if (j.sha) { const b = await fetch(`https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/git/blobs/${j.sha}`, { headers: hdr(), cache: 'no-store' }); if (b.ok) { const bj = await b.json(); return { sha: j.sha, text: td.decode(b64d(bj.content.replace(/\n/g, ''))) }; } }
    return { err: true };
  }
  async function getFile(path) {
    const br = branchOf(path), x = await apiGet(path, br);
    if (x.text != null) return { sha: x.sha, text: x.text };
    if (br !== CFG.BRANCH) {
      if (x.none) { const m = await apiGet(path, CFG.BRANCH); return m.text != null ? { sha: null, text: m.text, legacy: true } : null; } // file not moved to the data branch yet
      if (x.err) throw new Error('Không đọc được ' + path + (x.status ? ' (' + x.status + ')' : ''));
    }
    if (x.none) return null;
    const r2 = await fetch(path + '?ts=' + Date.now(), { cache: 'no-store' });  // GitHub Pages copy (main branch)
    if (r2.status === 404) return null; if (!r2.ok) throw new Error('Không tải được ' + path + ' (' + r2.status + ')');
    return { sha: null, text: await r2.text() };
  }
  async function putFile(path, text, sha, message) {
    if (!token) throw new Error('Chưa có GitHub token — quản lý cần nhập trong Cài đặt');
    const br = branchOf(path);
    if (!sha) { const cur = await fetch(API + path + '?ref=' + br, { headers: hdr(), cache: 'no-store' }); if (cur.ok) sha = (await cur.json()).sha; }
    const r = await fetch(API + path, { method: 'PUT', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64e(te.encode(text)), branch: br, ...(sha ? { sha } : {}) }) });
    if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
    if (r.status === 401 || r.status === 403) throw new Error('GitHub token không hợp lệ hoặc hết hạn (' + r.status + ')');
    if (!r.ok) throw new Error('GitHub ' + r.status + ': ' + (await r.text()).slice(0, 140));
    return r.json();
  }
  async function readEnc(path, keyB64, empty) { const f = await getFile(path); return f ? dec(keyB64, JSON.parse(f.text)) : clone(empty); }
  /** read → mutate → write with optimistic concurrency (retries on a concurrent commit) */
  async function updateEnc(path, keyB64, mutate, message, empty) {
    for (let i = 0; i < 6; i++) {
      const f = await getFile(path);
      const cur = f ? await dec(keyB64, JSON.parse(f.text)) : clone(empty);
      const next = await mutate(cur); if (next === undefined) return cur;
      try { await putFile(path, JSON.stringify(await enc(keyB64, next)), f && f.sha, message); return next; }
      catch (e) { if (!e.conflict) throw e; await sleep(350 * (i + 1) + Math.random() * 300); }
    }
    throw new Error('Nhiều người cùng ghi, vui lòng thử lại');
  }
  async function updatePlain(path, mutate, message, empty) {
    for (let i = 0; i < 6; i++) {
      const f = await getFile(path); const cur = f ? JSON.parse(f.text) : clone(empty); const next = await mutate(cur);
      try { await putFile(path, JSON.stringify(next), f && f.sha, message); return next; }
      catch (e) { if (!e.conflict) throw e; await sleep(400 * (i + 1)); }
    }
    throw new Error('Nhiều người cùng ghi, vui lòng thử lại');
  }
  /** cheap change detector: latest commit of the data branch, conditional request (a 304 does not count against the API limit) */
  let pollTag = null, pollSha = null;
  async function poll() {
    if (!token) return { changed: false };
    try {
      const r = await fetch(`https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/commits?sha=${CFG.DATA_BRANCH || CFG.BRANCH}&per_page=5`, { headers: { ...hdr(), ...(pollTag ? { 'If-None-Match': pollTag } : {}) }, cache: 'no-store' });
      if (r.status === 304) return { changed: false };
      if (!r.ok) return { changed: false };
      pollTag = r.headers.get('etag'); const j = await r.json(), head = j[0] && j[0].sha;
      if (!head || head === pollSha) return { changed: false };
      const first = pollSha == null; pollSha = head;
      return { changed: !first, msgs: j.map(c => c.commit && c.commit.message || '') };
    } catch (e) { return { changed: false }; }
  }
  async function syncClock() { try { const r = await fetch('data/vault.json?clock=' + Date.now(), { method: 'HEAD', cache: 'no-store' }); const d = r.headers.get('date'); if (d) skew = Date.parse(d) - Date.now(); } catch (e) {} }
  const now = () => new Date(Date.now() + skew).toISOString();

  return { enc, dec, hmac, newKey, hint, makeSlot, openSlot, getFile, putFile, readEnc, updateEnc, updatePlain, syncClock, now, poll, branchOf, sha, b64e, b64d, hex, clone,
    setToken: t => { token = t || null; }, hasToken: () => !!token, get skew() { return skew; } };
})();
