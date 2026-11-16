/* Manage-Performance — public configuration (no secrets here). */
window.CC_CONFIG = {
  OWNER: 'khoimr11', REPO: 'Manage-Performance', BRANCH: 'main', DATA_BRANCH: 'data',   // fast-changing files (chat, work, log, sheets) live on branch 'data' so GitHub Pages does not rebuild on every message   // storage for accounts, task log and sheets (encrypted)
  SRC_GLOBAL: '/Lignarc-Dashboard/data/lignarc.enc.json',          // source dashboards on the same GitHub Pages origin
  SRC_LOCAL: '/LF---B2C-Local/data/data.enc.json',
  SRC_NIKON: '/LF---B2C-Local/data/nikon.enc.json',
  SRC_KEYRING: '/LF---B2C-Local/data/keyring.json',
  DASH_GLOBAL: '/Lignarc-Dashboard/',
  DASH_LOCAL: '/LF---B2C-Local/',
  FX: 26300,
  // team roster (names shown in chat & work board)
  TEAM: [
    { id: 'khoimr11', name: 'Khoi Bui', short: 'Khoi', role: 'manager', channel: '' },
    { id: 'trang', name: 'Nguyễn Thị Thuỳ Trang', short: 'Thuỳ Trang', role: 'staff', channel: 'global' },
    { id: 'phu', name: 'Nguyễn Đình Phú', short: 'Đình Phú', role: 'staff', channel: 'local' }
  ]
};
