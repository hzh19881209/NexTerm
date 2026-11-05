(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $('#app');
  const SESSION_STORAGE_KEY = 'nexterm_open_sessions';
  const LEGACY_SESSION_STORAGE_KEY = 'termhub_open_sessions';
  const TOKEN_STORAGE_KEY = 'nexterm_token';
  const LEGACY_TOKEN_STORAGE_KEY = 'termhub_token';
  const SIDEBAR_STORAGE_KEY = 'nexterm_sidebar_collapsed';
  const SERVER_GROUPS_STORAGE_KEY = 'nexterm_collapsed_server_groups';
  const CWD_POLL_MS = 1800;
  const SYSTEM_STATUS_POLL_MS = 15000;
  const SERVER_STATUS_POLL_MS = 15000;
  const TERMINAL_SAFE_COLUMNS = 2;
  // Codex changes the activity label while a turn is running (for example
  // "Working" or "Checking files"), but its status line consistently keeps
  // the timer and "esc to interrupt" hint.  Match the stable TUI structure,
  // not individual activity words or transient redraw frames.
  const CODEX_ACTIVE_PATTERN = /(?:^|\n)\s*[•●]\s+.+\(\s*\d+(?:s|m|h).*?esc\s+to\s+interr/i;
  const CODEX_IDLE_PATTERN = /(?:^|\n)\s*›\s*Ask Codex to do anything\s*(?:\n|$)/i;
  const CODEX_COMPLETE_PATTERN = /(?:^|\n)\s*[─━-]+\s*Worked for\s+\d[^\n]*/i;
  const INPUT_REQUIRED_PATTERN = /(?:Would you like to (?:run|apply|execute)|Press enter to confirm or esc to|Question\s+\d+\/\d+\s+\(\d+\s+unanswered\)|enter to submit answer|needs your approval|Approval requested|main needs input|请确认|需要确认|是否继续(?:执行)?|等待(?:用户)?确认)/i;
  const FONT_STACKS = { system: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', modern: '"Segoe UI", Inter, Roboto, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', monospace: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' };
  const ICONS = { sftp:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z"/><path d="M8 14h8m-3-3 3 3-3 3"/></svg>', reconnect:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M18.2 17.2A8 8 0 1 1 20 12"/></svg>',
  desktop:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M9 20h6m-3-3.5V20"/></svg>',
    about:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M12 10.6v6"/><path d="M12 7.3h.01"/></svg>',
    settings:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.02 13.7A8.2 8.2 0 0 1 20.02 10.3L18.26 10.67A6.4 6.4 0 0 1 17.37 8.51L18.88 7.53A8.2 8.2 0 0 1 16.47 5.12L15.49 6.63A6.4 6.4 0 0 1 13.33 5.74L13.7 3.98A8.2 8.2 0 0 1 10.3 3.98L10.67 5.74A6.4 6.4 0 0 1 8.51 6.63L7.53 5.12A8.2 8.2 0 0 1 5.12 7.53L6.63 8.51A6.4 6.4 0 0 1 5.74 10.67L3.98 10.3A8.2 8.2 0 0 1 3.98 13.7L5.74 13.33A6.4 6.4 0 0 1 6.63 15.49L5.12 16.47A8.2 8.2 0 0 1 7.53 18.88L8.51 17.37A6.4 6.4 0 0 1 10.67 18.26L10.3 20.02A8.2 8.2 0 0 1 13.7 20.02L13.33 18.26A6.4 6.4 0 0 1 15.49 17.37L16.47 18.88A8.2 8.2 0 0 1 18.88 16.47A8.2 8.2 0 0 1 20.02 13.7Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    logout:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5h3.2a1.8 1.8 0 0 1 1.8 1.8v11.4a1.8 1.8 0 0 1-1.8 1.8h-3.2"/><path d="M10 8.5 6 12l4 3.5"/><path d="M6.4 12h8.4"/></svg>' };
  const SERVER_OS_OPTIONS = [
    { value:'', label:'自动识别（根据名称）' },
    { value:'windows', label:'Windows' },
    { value:'almalinux', label:'AlmaLinux' },
    { value:'centos', label:'CentOS' },
    { value:'ubuntu', label:'Ubuntu' },
    { value:'debian', label:'Debian' },
    { value:'rocky', label:'Rocky Linux' },
    { value:'rhel', label:'Red Hat Enterprise Linux' },
    { value:'fedora', label:'Fedora' },
    { value:'arch', label:'Arch Linux' },
    { value:'opensuse', label:'openSUSE' },
    { value:'alpine', label:'Alpine Linux' },
    { value:'kali', label:'Kali Linux' },
    { value:'oracle', label:'Oracle Linux' },
    { value:'linux', label:'其他 Linux' },
    { value:'macos', label:'macOS' },
    { value:'freebsd', label:'FreeBSD' },
    { value:'solaris', label:'Solaris' },
    { value:'aix', label:'AIX' },
    { value:'esxi', label:'VMware ESXi' },
    { value:'unknown', label:'其他 / 未知' }
  ];
  const SERVER_OS_LABELS = Object.fromEntries(SERVER_OS_OPTIONS.filter((item) => item.value).map((item) => [item.value, item.label]));
  const SERVER_OS_ALIASES = [
    ['windows', /(?:^|[^a-z])(windows|win(?:dows)?(?:server)?|win(?:10|11|7|8)|微软)(?:[^a-z]|$)/i],
    ['almalinux', /(?:^|[^a-z])(alma(?:linux)?|阿尔玛)(?:[^a-z]|$)/i],
    ['centos', /(?:^|[^a-z])cent\s*os(?:[^a-z]|$)/i],
    ['rocky', /(?:^|[^a-z])rocky(?:\s*linux)?(?:[^a-z]|$)/i],
    ['ubuntu', /(?:^|[^a-z])(?:ubuntu|乌班图)(?:[^a-z]|$)/i],
    ['debian', /(?:^|[^a-z])(?:debian|戴班)(?:[^a-z]|$)/i],
    ['rhel', /(?:^|[^a-z])(?:rhel|red\s*hat|红帽)(?:[^a-z]|$)/i],
    ['fedora', /(?:^|[^a-z])fedora(?:[^a-z]|$)/i],
    ['arch', /(?:^|[^a-z])arch(?:\s*linux)?(?:[^a-z]|$)/i],
    ['opensuse', /(?:^|[^a-z])(?:open\s*suse|sles|suse)(?:[^a-z]|$)/i],
    ['alpine', /(?:^|[^a-z])alpine(?:\s+linux)?(?:[^a-z]|$)/i],
    ['kali', /(?:^|[^a-z])kali(?:\s+linux)?(?:[^a-z]|$)/i],
    ['oracle', /(?:^|[^a-z])oracle\s+linux(?:[^a-z]|$)/i],
    ['freebsd', /(?:^|[^a-z])freebsd(?:[^a-z]|$)/i],
    ['solaris', /(?:^|[^a-z])solaris(?:[^a-z]|$)/i],
    ['aix', /(?:^|[^a-z])aix(?:[^a-z]|$)/i],
    ['esxi', /(?:^|[^a-z])(?:esxi|vmware)(?:[^a-z]|$)/i],
    ['macos', /(?:^|[^a-z])(?:macos|mac\s*os|os\s*x|darwin)(?:[^a-z]|$)/i],
    ['linux', /(?:^|[^a-z])(?:linux|Linux系统)(?:[^a-z]|$)/i]
  ];
  const SERVER_OS_ICONS = {
    windows:'<path d="M3 5.2 10.8 4.1v7.2H3V5.2Zm9.2-1.3L21 2.8v8.5h-8.8V3.9ZM3 12.8h7.8V20L3 18.8v-6Zm9.2 0H21v8.4l-8.8-1.2v-7.2Z"/>',
    almalinux:'<circle cx="12" cy="12" r="8.6"/><path class="server-os-cutout" d="m7.2 17.1 4.8-10.3 4.8 10.3h-2.2l-1-2.4h-3.3l-1 2.4H7.2Zm3.8-4.1h1.6l-.8-2-.8 2Z"/>',
    centos:'<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5.1v3.1h-3v3H5.8A6.3 6.3 0 0 1 12 5.1Zm6.2 6.1h-3v-3h-3V5.1a6.3 6.3 0 0 1 6 6.1ZM12 18.9v-3.1h3v-3h3.2a6.3 6.3 0 0 1-6.2 6.1Zm-6.2-6.1h3v3h3v3.1a6.3 6.3 0 0 1-6-6.1Z"/>',
    ubuntu:'<circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.1"/><circle cx="12" cy="4.4" r="1.5"/><circle cx="5.4" cy="16.1" r="1.5"/><circle cx="18.6" cy="16.1" r="1.5"/><path d="m12 9.8 0-3.9M10.2 13l-3.5 2M13.8 13l3.5 2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    debian:'<path d="M17.4 6.2c-2.2-2.1-5.9-2-7.9.2-1.5 1.7-1.5 4.1-.2 5.8 1.1 1.4 3.2 1.9 4.8.9 1.5-.9 1.8-2.8.8-4.1-.8-1-2.2-1.3-3.2-.6-.8.6-.9 1.7-.3 2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.2 18.7c3.9 1.3 8.2-.8 9.5-4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    rocky:'<path d="m3.2 19.3 5.7-8.1 2.1 2.6 2.9-5.2 6.9 10.7H3.2Z"/><path d="m8.9 11.2 2.1 2.6 2.9-5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    rhel:'<path d="m12 2.8 7.8 4.5v9.4L12 21.2l-7.8-4.5V7.3L12 2.8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 16V8h3.2c2.1 0 3.2 1 3.2 2.5 0 1.1-.6 1.9-1.6 2.3l2.1 3.2h-2.2l-1.8-2.8h-.9V16H8.3Zm2-6.3v1.8h1c.9 0 1.3-.3 1.3-.9 0-.6-.4-.9-1.3-.9h-1Z"/>',
    fedora:'<circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 17V7h7v2H11v2h4v2h-4v4H9Z"/>',
    arch:'<path d="m12 3 8.3 18h-3.1l-1.5-3.5H8.2L6.7 21H3.6L12 3Zm-2.9 12h4.8L12 9.4 9.1 15Z"/>',
    opensuse:'<circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 15.8c1.1 1 2.4 1.5 4 1.5 2.7 0 4.1-1.2 4.1-2.8 0-1.7-1.5-2.3-3.9-2.8-2.1-.4-3-.8-3-1.8 0-.8.8-1.4 2.2-1.4 1.2 0 2.3.4 3.3 1.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    alpine:'<path d="m3 19.5 5.6-8 2.6 3.1 2.4-4.1 6.4 9H3Z"/><path d="M8.6 11.5 5.8 7l-2.1 3.5M13.8 10.5l2-3.2 2.5 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    kali:'<path d="M12 3.2 19.8 8v8L12 20.8 4.2 16V8L12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8.4 15.8 3.6-7.6 3.6 7.6h-2l-.7-1.8h-1.8l-.7 1.8h-2Z"/>',
    oracle:'<path d="M6.3 5.2h7.1a6.8 6.8 0 1 1 0 13.6H6.3a6.8 6.8 0 1 1 0-13.6Zm.5 3a3.8 3.8 0 1 0 0 7.6h6.1a3.8 3.8 0 1 0 0-7.6H6.8Z"/>',
    linux:'<path d="M12 3.3c-3.2 0-4.5 3.2-4.5 6.7 0 1.7-.8 3.2-2.1 4.5-.9.9-.3 2.2 1 2.2h1.3c.4 1.9 1.9 3.2 4.3 3.2s3.9-1.3 4.3-3.2h1.3c1.3 0 1.9-1.3 1-2.2-1.3-1.3-2.1-2.8-2.1-4.5 0-3.5-1.3-6.7-4.5-6.7Z"/><circle cx="9.8" cy="10.2" r=".8" class="server-os-cutout"/><circle cx="14.2" cy="10.2" r=".8" class="server-os-cutout"/><path d="M10 13.3c1.3 1 2.7 1 4 0" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    macos:'<path d="M15.8 6.1c.8-1 1.3-2.2 1.2-3.4-1.2.1-2.5.8-3.3 1.8-.7.8-1.3 2.1-1.1 3.3 1.2.1 2.4-.6 3.2-1.7ZM19.5 13.1c0-2.5 2-3.7 2.1-3.8-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.9-1.6 0-3.1 1-3.9 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.1-1.2 2.9-2.4.9-1.4 1.3-2.8 1.3-2.9-.1 0-3-.9-3-3.7Z" transform="translate(-1 -1.8) scale(.9)"/>',
    freebsd:'<circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.2 15.7c1.1-3.6 2.8-5.4 4.8-5.4s3.7 1.8 4.8 5.4c-1.6-.8-3.2-1.1-4.8-1.1s-3.2.3-4.8 1.1Z"/><circle cx="10.2" cy="11.5" r=".7" class="server-os-cutout"/><circle cx="13.8" cy="11.5" r=".7" class="server-os-cutout"/>',
    solaris:'<circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 15.7c2.5-4.4 5-6.9 10-7.4-2 2.5-3.7 5-4.2 8.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    aix:'<path d="M12 3.2 20.2 20H3.8L12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8.4 16 3.6-7.6 3.6 7.6h-2l-.7-1.8h-1.8l-.7 1.8h-2Z"/>',
    esxi:'<path d="M4 5.2h16v13.6H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 12h5M8 15h7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    unknown:'<rect x="4" y="4" width="16" height="6" rx="1.8"/><rect x="4" y="14" width="16" height="6" rx="1.8"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  };
  function normalizeServerOs(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const aliases = { win:'windows', win10:'windows', win11:'windows', 'windows server':'windows', alma:'almalinux', 'alma linux':'almalinux', 'red hat':'rhel', redhat:'rhel', rocky:'rocky', rockylinux:'rocky', 'rocky linux':'rocky', suse:'opensuse', opensuse:'opensuse', 'open suse':'opensuse', 'mac os':'macos', 'os x':'macos' };
    const candidate = aliases[normalized] || normalized;
    return Object.prototype.hasOwnProperty.call(SERVER_OS_ICONS, candidate) ? candidate : '';
  }
  function detectServerOs(server) {
    const explicit = normalizeServerOs(server?.os || server?.operatingSystem || server?.platform);
    if (explicit) return explicit;
    const haystack = `${server?.name || ''} ${server?.host || ''}`;
    return SERVER_OS_ALIASES.find(([, pattern]) => pattern.test(haystack))?.[0] || 'unknown';
  }
  function serverOsLabel(server) { return SERVER_OS_LABELS[detectServerOs(server)] || '其他 / 未知'; }
  function serverOsIcon(server) { const os = detectServerOs(server); return `<svg class="server-os-svg os-${os}" viewBox="0 0 24 24" aria-hidden="true">${SERVER_OS_ICONS[os] || SERVER_OS_ICONS.unknown}</svg>`; }
  const brandMark = (className = '') => `<span class="brand-mark${className ? ` ${className}` : ''}"><img src="/nexterm.svg" alt="" /></span>`;
  localStorage.removeItem(TOKEN_STORAGE_KEY); localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  const state = { csrfToken:'', user:null, previousLogin:null, servers:[], serverStatuses:new Map(), serverStatusTimer:null, serverStatusRefreshing:false, tabs:new Map(), activeTab:null, sidebarOpen:false, sidebarCollapsed:localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1', cwdPollTimer:null, systemStatusTimer:null, systemStatus:null, collapsedServerGroups:new Set(), takenOverTabs:new Set() };
  try {
    const savedGroups = JSON.parse(localStorage.getItem(SERVER_GROUPS_STORAGE_KEY) || '[]');
    if (Array.isArray(savedGroups)) state.collapsedServerGroups = new Set(savedGroups.map((group) => String(group)));
  } catch { /* ignore malformed local UI preferences */ }
  const api = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase(); const mutating = !['GET','HEAD','OPTIONS'].includes(method);
    const headers = { ...(options.body !== undefined && !(options.body instanceof FormData) ? { 'Content-Type':'application/json' } : {}), ...(mutating && state.csrfToken ? { 'X-CSRF-Token':state.csrfToken } : {}), ...(options.headers || {}) };
    const response = await fetch(url, { ...options, credentials:'same-origin', headers });
    let body = null; try { body = await response.json(); } catch { /* empty */ }
    if (body?.csrfToken) state.csrfToken = body.csrfToken;
    if (body?.user) state.user = body.user;
    if (!response.ok) {
      const error = new Error(body?.error || (response.status === 401 ? '请重新登录' : '请求失败'));
      error.code = body?.code; error.retryAfter = body?.retryAfter;
      if (response.status === 401 && state.user && !String(url).startsWith('/api/auth/login')) clearClientSession();
      throw error;
    }
    return body;
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const userInitials = () => String(state.user?.username || 'NT').trim().slice(0, 2).toUpperCase();
  const avatarMarkup = () => state.user?.avatar ? `<img src="${escapeHtml(state.user.avatar)}" alt="${escapeHtml(state.user.username)} 的头像" />` : `<span>${escapeHtml(userInitials())}</span>`;
  function applyUserPreferences() {
    const preferences = state.user?.preferences || {}; const family = FONT_STACKS[preferences.fontFamily] || FONT_STACKS.system; const terminalFontSize = Math.max(11, Math.min(24, Number(preferences.terminalFontSize) || 13));
    document.documentElement.style.setProperty('--ui-font-family', family);
    state.tabs.forEach((tab) => {
      if (!tab.terminal) return;
      tab.terminal.options.fontSize = terminalFontSize;
      if (tab.id === state.activeTab) setTimeout(() => {
        if (!tab.view?.classList.contains('hidden')) {
          scheduleTerminalFit(tab);
          tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1)); scrollTerminalToBottom(tab, tab.id === state.activeTab);
        }
      }, 0);
    });
  }
  function serverForeground(color) {
    const value = String(color || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(value)) return '#e7edf5';
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)); return ((r * 299 + g * 587 + b * 114) / 1000) > 155 ? '#10202a' : '#ffffff';
  }
  const connectionIcon = (connected, attention = false, color = '', auto = false) => {
    const serverColor = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color) : '';
    const style = serverColor ? ` style="--connection-color:${serverColor}"` : '';
    return `<svg class="connection-icon ${connected ? 'connected' : 'disconnected'}${attention ? ' attention' : ''}${auto ? ' auto' : ''}${serverColor ? ' has-server-color' : ''}"${style} viewBox="0 0 24 24" role="img" aria-label="${auto ? '自动审批已开启（点击关闭）' : '点击开启自动审批'}"><path class="connection-bolt" d="M13.7 2.5 5.4 13.3h6.2l-1.3 8.2 8.3-11h-6.2l1.3-8Z"/>${connected ? '' : '<path class="connection-slash" d="M4.5 4.5 19.5 19.5"/>'}</svg>`;
  };
  const CLIENT_BUILD_TAG = 'nexterm-evolution-24-codex-running-indicator';
  const notify = (message, type = 'info') => {
    const toast = document.createElement('div'); toast.textContent = message; toast.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:30;background:${type === 'error' ? '#4d2029' : '#17372f'};border:1px solid ${type === 'error' ? '#9d4656' : '#2b8067'};color:#e8fff7;padding:11px 14px;border-radius:9px;font-size:13px;box-shadow:0 10px 30px #0005`;
    document.body.appendChild(toast); setTimeout(() => toast.remove(), 3000);
  };
  function openConfirmDialog({ title, message, detail = '', meta = '', confirmLabel = '确定', cancelLabel = '取消', tone = '' }) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const titleId = `dialog-title-${crypto.randomUUID()}`;
      const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.dataset.confirmDialog = '';
      backdrop.innerHTML = `<div class="modal confirm-modal ${tone}" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}"><div class="modal-head"><h3 id="${titleId}">${escapeHtml(title)}</h3><button type="button" class="icon-btn" data-dialog-cancel aria-label="关闭">×</button></div><div class="modal-body dialog-body"><p class="dialog-message">${escapeHtml(message)}</p>${meta ? `<div class="dialog-meta">${escapeHtml(meta)}</div>` : ''}${detail ? `<pre class="paste-preview">${escapeHtml(detail)}</pre>` : ''}</div><div class="modal-actions"><button type="button" class="secondary" data-dialog-cancel>${escapeHtml(cancelLabel)}</button><button type="button" class="primary" data-dialog-confirm>${escapeHtml(confirmLabel)}</button></div></div>`;
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true; document.removeEventListener('keydown', onKeyDown, true); backdrop.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        resolve(confirmed);
      };
      const onKeyDown = (event) => { if (event.key === 'Escape') { event.preventDefault(); finish(false); } };
      backdrop.querySelectorAll('[data-dialog-cancel]').forEach((button) => button.onclick = () => finish(false));
      $('[data-dialog-confirm]', backdrop).onclick = () => finish(true);
      backdrop.onclick = (event) => { if (event.target === backdrop) finish(false); };
      document.addEventListener('keydown', onKeyDown, true); document.body.appendChild(backdrop);
      $('[data-dialog-cancel]', backdrop)?.focus();
    });
  }
  const hasMultipleLines = (value) => /\r\n|\r|\n/.test(String(value || ''));
  function confirmMultilinePaste(value) {
    const normalized = String(value || '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    let preview = lines.slice(0, 8).join('\n');
    if (preview.length > 1200) preview = `${preview.slice(0, 1200)}...`;
    if (lines.length > 8) preview += `\n... 其余 ${lines.length - 8} 行未显示`;
    return openConfirmDialog({ title:'粘贴多行内容？', message:'这些内容会直接发送到当前终端。请确认其中没有不希望执行的命令。', meta:`共 ${lines.length} 行 · ${normalized.length} 个字符`, detail:preview, confirmLabel:'确认粘贴', tone:'warning' });
  }
  function pasteIntoTerminal(tab, value) {
    if (tab.restoring) return;
    if (typeof tab.terminal?.paste === 'function') {
      // xterm clears the current selection as part of sending input, so a
      // right-click paste would otherwise erase a selection the user still
      // wanted to keep. Put it back once the paste has been dispatched.
      const position = tab.terminal.getSelectionPosition?.();
      const selected = String(tab.terminal.getSelection?.() || '');
      tab.terminal.paste(value);
      if (position && selected) {
        try { tab.terminal.select(position.start.x - 1, position.start.y - 1, position.end.x - position.start.x + 1); } catch { /* the buffer may have scrolled past the selection */ }
      }
      return;
    }
    if (tab.ws?.readyState === WebSocket.OPEN) tab.ws.send(JSON.stringify({ type:'input', data:btoa(unescape(encodeURIComponent(value))) }));
  }
  function copyText(value, message = '已复制') {
    const text = String(value);
    const previousFocus = document.activeElement;
    // Run the legacy copy command first while the original click/context-menu
    // user gesture is still active. Clipboard API permission can resolve only
    // after that gesture has expired in some browsers and embedded contexts.
    const textarea = document.createElement('textarea');
    textarea.value = text; textarea.setAttribute('readonly', ''); textarea.tabIndex = -1;
    textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0';
    document.body.appendChild(textarea);
    let copied = false;
    try { textarea.focus({ preventScroll:true }); textarea.select(); textarea.setSelectionRange(0, text.length); copied = document.execCommand('copy') === true; } catch { /* try the Clipboard API below */ } finally {
      textarea.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll:true });
    }
    if (copied) { notify(message); return Promise.resolve(true); }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      return navigator.clipboard.writeText(text).then(() => { notify(message); return true; }).catch(() => { notify('复制失败，请手动选择并复制', 'error'); return false; });
    } catch {
      notify('复制失败，请手动选择并复制', 'error');
      return Promise.resolve(false);
    }
  }
  async function copyTerminalSelection(tab, value = tab?.terminal?.getSelection?.()) {
    const selection = String(value || '');
    if (!selection) { notify('请先选中终端文本', 'error'); return false; }
    const copied = await copyText(selection, '终端选中内容已复制');
    // Only drop the highlight once the text is really on the clipboard; keeping
    // it on failure lets the user retry without re-selecting.
    if (copied) {
      tab.terminal?.clearSelection?.();
      tab.terminalSelection = '';
      terminalRightClickSnapshot = null;
      terminalSelectionGesture = null;
    }
    return copied;
  }
  const usableTerminalSelection = (value) => { const text = String(value || ''); return text.trim() ? text : ''; };
  function decodeOsc52Clipboard(data) {
    const value = String(data || '');
    const separator = value.indexOf(';');
    if (separator < 0) return '';
    const target = value.slice(0, separator);
    const payload = value.slice(separator + 1);
    if (payload === '?' || !payload || payload.length > 2_000_000) return '';
    if (target && !target.split(':').includes('c')) return '';
    try {
      const binary = atob(payload.replace(/\s+/g, ''));
      return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    } catch {
      return '';
    }
  }
  function requestTerminalAppCopy(tab) {
    if (tab?.ws?.readyState !== WebSocket.OPEN) { notify('终端未连接，无法复制', 'error'); return false; }
    // Ctrl+Insert is Codex's non-destructive copy shortcut: it copies an
    // existing program-side selection and is a no-op otherwise, unlike Ctrl+C
    // which interrupts when no selection exists. Codex replies with OSC 52.
    tab.ws.send(JSON.stringify({ type:'input', data:btoa('\u001b[2;5~') }));
    return true;
  }
  function watchTerminalSelection(tab) {
    if (!tab?.terminal || tab.terminalSelectionWatched) return;
    tab.terminalSelectionWatched = true;
    tab.terminal.onSelectionChange?.(() => {
      tab.terminalSelection = usableTerminalSelection(tab.terminal?.getSelection?.());
    });
    const handleOsc52 = (data) => {
      const text = decodeOsc52Clipboard(data);
      if (!text) return true;
      terminalSelectionGesture = null;
      queueMicrotask(() => { void copyText(text, '终端选中内容已复制'); });
      return true;
    };
    // The parser API is proposed by xterm; fall back to its core registration
    // method so OSC 52 works without enabling every proposed API globally.
    try { tab.terminal.parser.registerOscHandler(52, handleOsc52); }
    catch { tab.terminal._core?.registerOscHandler?.(52, handleOsc52); }
  }
  let terminalRightClickSnapshot = null;
  let terminalRightClickHandledAt = 0;
  let terminalPointerDrag = null;
  let terminalSelectionGesture = null;
  function terminalUsesMouseReporting(tab) {
    return Boolean(tab?.view?.querySelector('.xterm')?.classList.contains('enable-mouse-events'));
  }
  function hasTerminalSelectionGesture(tab) {
    // Only defer to the program when terminal mouse reporting is active. In a
    // normal shell xterm owns the selection and must remain authoritative.
    return Boolean(terminalUsesMouseReporting(tab) && terminalSelectionGesture && terminalSelectionGesture.tabId === tab.id
      && Date.now() - terminalSelectionGesture.timestamp < 10 * 60 * 1000);
  }
  function readTerminalSelection(tab) {
    // xterm keeps its own selection model, but its contextmenu handler runs
    // before ours and copies the selection into the hidden textarea (calling
    // select() on it). That replaces the document selection, so reading
    // getSelection() at contextmenu time can come back empty even though the
    // user clearly highlighted text. Capture the selection as soon as the
    // right button goes down, before xterm gets a chance to move it.
    // Whitespace-only selections (a stray highlight on an empty line) are not
    // worth copying, so every fallback returns '' for them and the caller
    // treats the click as a plain paste.
    const live = usableTerminalSelection(tab.terminal?.getSelection?.());
    if (live) {
      // Codex and other full-screen programs repaint frequently. Keep the last
      // real selection so a repaint between mouseup and Ctrl/Cmd+C cannot make
      // the copy shortcut incorrectly report that nothing is selected.
      tab.terminalSelection = live;
      return live;
    }
    const snapshot = terminalRightClickSnapshot;
    if (snapshot && snapshot.tabId === tab.id && Date.now() - snapshot.timestamp < 5000) {
      const fromSnapshot = usableTerminalSelection(snapshot.selection);
      if (fromSnapshot) return fromSnapshot;
    }
    // Last resort: the native selection inside the terminal element itself.
    try {
      const native = document.getSelection?.();
      if (native && !native.isCollapsed && native.anchorNode && tab.view?.contains(native.anchorNode)) {
        const fromNative = usableTerminalSelection(native.toString());
        if (fromNative) return fromNative;
      }
    } catch { /* fall through to the empty result below */ }
    const cached = usableTerminalSelection(tab.terminalSelection);
    if (cached) return cached;
    return '';
  }
  async function handleTerminalContextMenu(event) {
    const view = event.target.closest('.session');
    const tab = view ? state.tabs.get(view.dataset.sessionId) : null;
    if (!tab) return;
    // The mousedown handler consumes the native event, so restore terminal
    // focus explicitly for the copy/paste action and subsequent typing.
    tab.terminal?.focus?.();
    const selection = readTerminalSelection(tab);
    // Standard terminal behavior: a right click with a selection copies it,
    // while a right click without a selection pastes the clipboard. Do not
    // turn a deliberate selection into a paste just because the clipboard is
    // non-empty; Ctrl/Cmd+V remains available for pasting over a selection.
    if (selection) { await copyTerminalSelection(tab, selection); return; }
    // Codex and other mouse-aware TUIs paint and track their own selection, so
    // xterm.getSelection() is empty even though the user visibly selected text.
    // A recent drag inside the terminal therefore asks the TUI to copy; Codex
    // returns that text through OSC 52, which watchTerminalSelection handles.
    if (hasTerminalSelectionGesture(tab)) { requestTerminalAppCopy(tab); return; }
    if (typeof navigator.clipboard?.readText !== 'function') { notify('无法粘贴：当前浏览器不允许程序读取剪贴板', 'error'); return; }
    let clipboardText = '';
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      notify('浏览器拒绝读取剪贴板，请使用 Ctrl/Cmd+V 粘贴', 'error');
      return;
    }
    if (!clipboardText) { notify('剪贴板为空'); return; }
    if (hasMultipleLines(clipboardText) && !(await confirmMultilinePaste(clipboardText))) return;
    pasteIntoTerminal(tab, clipboardText);
  }
  // Shared SFTP panel markup + wiring so SSH and Windows(VNC) tabs get the
  // exact same file-management UI. The panel talks to /api/servers/:id/files,
  // which the server routes to a plain SFTP client for Windows hosts.
  function sftpPanelMarkup() {
    return `<div class="sftp-toolbar"><button class="ghost-btn" data-up>←</button><input class="path-input" value="/" /><button class="ghost-btn" data-refresh>刷新</button><button class="ghost-btn" data-mkdir>新建目录</button><label class="ghost-btn" style="cursor:pointer">上传<input type="file" data-upload multiple hidden /></label><label class="ghost-btn" style="cursor:pointer">上传文件夹<input type="file" data-upload-directory webkitdirectory directory multiple hidden /></label><button class="ghost-btn" type="button" data-sftp-close title="关闭文件面板">关闭</button></div><div class="upload-status hidden" data-upload-status role="status" aria-live="polite"><div class="upload-meta"><span data-upload-label>准备上传</span><span class="upload-percent" data-upload-percent>0%</span><button class="secondary danger" type="button" data-upload-cancel>取消上传</button></div><progress data-upload-progress max="100" value="0"></progress><div class="upload-detail" data-upload-detail></div></div><div class="file-list"><div class="file-row head"><span>名称</span><span>大小</span><span>修改时间</span><span></span></div><div data-files></div></div>`;
  }
  // Wire the SFTP panel inside `view` for `tab`. resolveInitialDir returns a
  // promise for the starting directory (terminal cwd for SSH, "/" for Windows).
  function wireSftpPanel(tab, view, resolveInitialDir) {
    const toggleSftp = async (open = !tab.sftp) => {
      tab.sftp = open;
      const panel = $('.sftp-panel', view);
      panel.classList.toggle('hidden', !tab.sftp);
      if (!tab.sftp) return;
      const currentDirectory = await resolveInitialDir();
      if (!tab.sftp || !state.tabs.has(tab.id)) return;
      if (currentDirectory === null) return; // caller already rendered a hint
      $('[data-files]', panel).innerHTML = '<div class="empty">正在加载目录…</div>';
      loadFiles(tab, currentDirectory || tab.currentDirectory || tab.initialCwd || $('.path-input', panel).value || '/');
    };
    tab.openSftp = () => toggleSftp(true);
    $('[data-sftp-close]', view).onclick = () => toggleSftp(false);
    const sftpBtn = $('[data-sftp]', view); if (sftpBtn) sftpBtn.onclick = () => toggleSftp();
    $('[data-refresh]', view).onclick = () => loadFiles(tab, $('.path-input', view).value);
    $('[data-up]', view).onclick = () => { const current = sftpPath($('.path-input', view).value); loadFiles(tab, current === '/' ? '/' : current.split('/').slice(0, -1).join('/') || '/'); };
    $('[data-mkdir]', view).onclick = async () => { const name = prompt('目录名称'); if (!name) return; try { await api(`/api/servers/${tab.serverId}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path: $('.path-input', view).value, name }) }); loadFiles(tab, $('.path-input', view).value); } catch (e) { notify(e.message, 'error'); } };
    const handleUploadSelection = (event) => { const input = event.currentTarget; const files = [...input.files]; if (!files.length) return; startUploads(tab, files, view, input); };
    $('[data-upload]', view).onchange = handleUploadSelection;
    $('[data-upload-directory]', view).onchange = handleUploadSelection;
    const uploadCancelBtn = $('[data-upload-cancel]', view); if (uploadCancelBtn) uploadCancelBtn.onclick = () => { tab.upload?.currentXhr?.abort(); };
    return toggleSftp;
  }
  function createTabState(server, options = {}) {
    const kind = options.kind === 'vnc' ? 'vnc' : 'ssh';
    const initialCwd = String(options.initialCwd || options.currentDirectory || '');
    const approvalEnabled = options.approvalEnabled === true;
    const approvalRememberAll = options.approvalRememberAll === true;
    return { id:options.id || crypto.randomUUID(), serverId:server.id, name:String(options.name || server.name), initialCwd, currentDirectory:String(options.currentDirectory || initialCwd), kind, vnc:null, connected:false, ws:null, wsGeneration:0, reconnectBlocked:false, terminal:null, fit:null, resizeFrame:null, sftp:false, upload:null, lastSeq:0, restoring:false, restoreGeneration:0, reconnectTimer:null, reconnectAttempt:0, manualClose:false, needsAttention:false, attentionTimer:null, taskWasWorking:false, lastCompletionKey:'', cwdRequests:new Map(), cwdRequestInFlight:false, followOutput:true, approvalEnabled:kind === 'ssh' && approvalEnabled, approvalModelId:kind === 'ssh' ? String(options.approvalModelId || '') : '', approvalRememberAll, approvalStatus:'', approvalStatusTimer:null, approvalNotice:'', approvalStopReason:'', approvalStopReasonMessage:'' };
  }
  function persistSessions() {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ activeTab:state.activeTab, tabs:[...state.tabs.values()].map((tab) => ({ id:tab.id, serverId:tab.serverId, name:tab.name, kind:tab.kind === 'vnc' ? 'vnc' : 'ssh', initialCwd:tab.currentDirectory || tab.initialCwd || '', approvalEnabled:tab.approvalEnabled === true, approvalModelId:tab.approvalModelId || '', approvalRememberAll:tab.approvalRememberAll === true })) }));
  }
  function restoreSessionsFromServer(items) {
    for (const item of Array.isArray(items) ? items : []) {
      const server = state.servers.find((entry) => entry.id === item.serverId);
      if (!server || !item.id) continue;
      const directory = String(item.currentDirectory || item.initialCwd || '');
      const existing = state.tabs.get(item.id);
      if (existing) { if (directory) { existing.initialCwd = directory; existing.currentDirectory = directory; } if (item.approvalEnabled) { existing.approvalEnabled = true; existing.approvalModelId = item.approvalModelId || existing.approvalModelId; existing.approvalRememberAll = Boolean(item.approvalRememberAll); } continue; }
      state.tabs.set(item.id, createTabState(server, { id:item.id, kind:item.kind === 'vnc' ? 'vnc' : 'ssh', initialCwd:directory, currentDirectory:directory, approvalEnabled:item.approvalEnabled === true, approvalModelId:item.approvalModelId || '', approvalRememberAll:Boolean(item.approvalRememberAll) }));
    }
  }
  function updateTabNames() {
    const tabs = [...state.tabs.values()];
    const baseCounts = new Map();
    tabs.forEach((tab) => {
      const directory = String(tab.currentDirectory || tab.initialCwd || '');
      const segments = directory.split('/').filter(Boolean);
      if (segments.length) { const base = segments[segments.length - 1]; baseCounts.set(base, (baseCounts.get(base) || 0) + 1); }
    });
    let changed = false;
    tabs.forEach((tab) => {
      const server = state.servers.find((entry) => entry.id === tab.serverId);
      const segments = String(tab.currentDirectory || tab.initialCwd || '').split('/').filter(Boolean);
      if (!segments.length) { if (server && tab.name !== server.name) { tab.name = server.name; changed = true; } return; }
      const base = segments[segments.length - 1];
      const next = (baseCounts.get(base) || 0) > 1 ? segments.join('/') : base;
      if (next && tab.name !== next) { tab.name = next; changed = true; }
    });
    if (changed) { persistSessions(); renderTabs(); }
  }
  async function refreshTabCwd(tab) {
    if (!tab?.connected || tab.cwdRequestInFlight) return tab?.currentDirectory || tab?.initialCwd || '';
    tab.cwdRequestInFlight = true;
    try {
      const directory = await requestTabCwd(tab);
      if (directory && directory !== tab.currentDirectory) { tab.currentDirectory = directory; updateTabNames(); }
      return directory;
    } finally { tab.cwdRequestInFlight = false; }
  }
  function startCwdPolling() {
    if (state.cwdPollTimer) clearInterval(state.cwdPollTimer);
    state.cwdPollTimer = setInterval(() => state.tabs.forEach((tab) => { if (tab.connected) refreshTabCwd(tab); }), CWD_POLL_MS);
  }
  async function restoreSessions() {
    let saved; try { saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}'); } catch { saved = {}; }
    if (!saved.tabs) { try { saved = JSON.parse(localStorage.getItem(LEGACY_SESSION_STORAGE_KEY) || '{}'); } catch { saved = {}; } }
    for (const item of Array.isArray(saved.tabs) ? saved.tabs : []) {
      const server = state.servers.find((entry) => entry.id === item.serverId);
      if (!server || !item.id || state.tabs.has(item.id)) continue;
      state.tabs.set(item.id, createTabState(server, { id:item.id, name:item.name || server.name, initialCwd:item.initialCwd, approvalEnabled:item.approvalEnabled === true, approvalModelId:item.approvalModelId || '', approvalRememberAll:Boolean(item.approvalRememberAll) }));
    }
    try { const remote = await api('/api/ssh-sessions'); restoreSessionsFromServer(remote.sessions); } catch { /* an expired runtime list must not prevent local tabs from opening */ }
    startCwdPolling();
    if (!state.tabs.size) { persistSessions(); return; }
    state.activeTab = state.tabs.has(saved.activeTab) ? saved.activeTab : state.tabs.keys().next().value;
    state.tabs.forEach((tab) => connectTab(tab));
    activateTab(state.activeTab); updateTabNames(); persistSessions();
  }
  function clearClientSession() { state.csrfToken = ''; state.user = null; if (state.cwdPollTimer) clearInterval(state.cwdPollTimer); if (state.systemStatusTimer) clearInterval(state.systemStatusTimer); if (state.serverStatusTimer) clearInterval(state.serverStatusTimer); state.cwdPollTimer = null; state.systemStatusTimer = null; state.serverStatusTimer = null; state.systemStatus = null; state.serverStatuses.clear(); state.serverStatusRefreshing = false; state.takenOverTabs.clear(); document.querySelector('[data-takeover-dialog]')?.remove(); localStorage.removeItem(SESSION_STORAGE_KEY); localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY); state.tabs.forEach((tab) => { tab.manualClose = true; if (tab.kind === 'vnc') disposeVnc(tab); tab.upload?.currentXhr?.abort(); if (tab.attentionTimer) clearTimeout(tab.attentionTimer); if (tab.approvalStatusTimer) clearTimeout(tab.approvalStatusTimer); resolveCwdRequests(tab); tab.ws?.close(); }); state.tabs.clear(); state.activeTab = null; renderLogin(); }
  async function logout() { try { if (state.csrfToken) await api('/api/auth/logout', { method:'POST', body:'{}' }); } catch { /* clear local state even if the session already expired */ } finally { clearClientSession(); } }
  function renderLogin() {
    app.innerHTML = `<div class="login-shell"><form class="login-card" id="login-form"><div class="brand">${brandMark()}<div><h1>NexTerm</h1><small>Web SSH workspace</small></div></div><div class="field"><label>用户名</label><input name="username" autocomplete="username" autofocus required /></div><div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required /></div><div class="field"><label>动态验证码 <small>已信任的设备可留空</small></label><input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="FreeOTP 生成的 6 位验证码" /></div><label class="remember-device"><input name="rememberDevice" type="checkbox" /><span><strong>记住此设备</strong><small>本次 MFA 验证成功后，30 天内登录无需再次输入动态验证码。</small></span></label><div class="error" id="login-error" role="alert" aria-live="polite"></div><button class="primary" type="submit">登录</button></form></div>`;
    $('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const error = $('#login-error'); const otp = $('#login-form [name="otp"]'); error.textContent = ''; try { const result = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password'), otp: form.get('otp'), rememberDevice: form.get('rememberDevice') === 'on' }) }); state.previousLogin = result.previousLogin || null; if (result.user.mustChangePassword) renderChangePassword(); else await loadWorkspace(); } catch (e) { error.textContent = e.message; if (e.code === 'TOTP_REQUIRED' || e.code === 'TOTP_INVALID') { otp?.focus(); otp?.select(); } } });
  }
  function renderChangePassword() {
    app.innerHTML = `<div class="login-shell"><form class="login-card" id="change-password-form"><div class="brand">${brandMark()}<div><h1>设置新密码</h1><small>首次登录需要完成此步骤</small></div></div><p style="color:var(--muted);font-size:13px;line-height:1.6">为了保护你的 NexTerm 管理员账户，请先将初始密码修改为仅你知道的新密码。</p><div class="field"><label>当前密码</label><input name="currentPassword" type="password" autocomplete="current-password" required /></div><div class="field"><label>新密码（至少 12 位）</label><input name="newPassword" type="password" autocomplete="new-password" minlength="12" required /></div><div class="field"><label>确认新密码</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></div><div class="error" id="change-password-error"></div><button class="primary" type="submit">保存并进入工作区</button><button class="ghost-btn" id="change-logout" type="button" style="width:100%;margin-top:10px">退出登录</button></form></div>`;
    $('#change-logout').onclick = logout;
    $('#change-password-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const error = $('#change-password-error'); error.textContent = ''; try { await api('/api/auth/change-password', { method:'POST', body: JSON.stringify(Object.fromEntries(form)) }); await loadWorkspace(); } catch (e) { error.textContent = e.message; } });
  }
  function statusPercent(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }
  function renderSystemStatus() {
    const status = state.systemStatus; if (!status) return;
    const hostName = $('[data-host-name]');
    if (hostName) { const value = String(status.name || '部署服务器'); hostName.textContent = value; hostName.title = value; }
    const entries = [['cpu', status.cpu?.usage], ['memory', status.memory?.usage], ['disk', status.disk?.usage]];
    entries.forEach(([name, value]) => {
      const percent = statusPercent(value); const label = $(`[data-host-${name}]`); const bar = $(`[data-host-${name}-bar]`);
      if (label) label.textContent = `${percent.toFixed(0)}%`; if (bar) bar.style.width = `${percent}%`;
    });
    const version = $('[data-host-version]'); if (version) version.textContent = String(status.version || '未知');
  }
  async function refreshSystemStatus() {
    try { state.systemStatus = await api('/api/system/status'); renderSystemStatus(); }
    catch (error) { if (state.user) notify(error.message || '主机状态读取失败', 'error'); }
  }
  function startSystemStatusPolling() {
    if (state.systemStatusTimer) clearInterval(state.systemStatusTimer);
    refreshSystemStatus(); state.systemStatusTimer = setInterval(refreshSystemStatus, SYSTEM_STATUS_POLL_MS);
  }
  function renderServerStatuses() {
    document.querySelectorAll('[data-server-status]').forEach((container) => {
      const status = state.serverStatuses.get(container.dataset.serverStatus); const available = status?.available === true;
      container.classList.toggle('unavailable', !available);
      container.setAttribute('aria-label', available ? `CPU ${statusPercent(status.cpu).toFixed(0)}%，内存 ${statusPercent(status.memory).toFixed(0)}%，磁盘 ${statusPercent(status.disk).toFixed(0)}%` : '服务器资源状态暂不可用');
      ['cpu','memory','disk'].forEach((metric) => {
        const meter = container.querySelector(`[data-server-metric="${metric}"]`); if (!meter) return;
        const percent = available ? statusPercent(status[metric]) : 0; const label = { cpu:'CPU', memory:'内存', disk:'磁盘' }[metric];
        meter.querySelector('i').style.height = `${percent}%`;
        meter.classList.toggle('is-high', available && percent >= 85);
        meter.title = available ? `${label} ${percent.toFixed(0)}%` : `${label} 状态暂不可用`;
        if (available) meter.setAttribute('aria-valuenow', percent.toFixed(0)); else meter.removeAttribute('aria-valuenow');
      });
    });
  }
  async function refreshServerStatuses() {
    if (state.serverStatusRefreshing || !state.user) return;
    state.serverStatusRefreshing = true;
    try {
      const result = await api('/api/servers/status');
      state.serverStatuses = new Map((Array.isArray(result?.servers) ? result.servers : []).map((status) => [status.id, status]));
      renderServerStatuses();
    } catch { /* individual bars remain unavailable until the next poll */ }
    finally { state.serverStatusRefreshing = false; }
  }
  function startServerStatusPolling() {
    if (state.serverStatusTimer) clearInterval(state.serverStatusTimer);
    refreshServerStatuses(); state.serverStatusTimer = setInterval(refreshServerStatuses, SERVER_STATUS_POLL_MS);
  }
  async function loadWorkspace() { state.servers = await api('/api/servers'); await refreshApprovalModels(); applyUserPreferences(); renderShell(); startSystemStatusPolling(); startServerStatusPolling(); await restoreSessions(); if (state.previousLogin) { const previous = state.previousLogin; state.previousLogin = null; notify(`上次登录：${previous.at ? new Date(previous.at).toLocaleString() : '首次登录'}${previous.ip ? ` · ${previous.ip}` : ''}`); } }
  function renderShell() {
    app.innerHTML = `<div class="app-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
      <header class="topbar"><div class="brand">${brandMark('top-brand-mark')}<div><h1 style="font-size:17px">NexTerm</h1><small style="font-size:11px">Remote dev workspace</small></div></div><div class="top-actions"><span class="user-chip" id="user-name">${escapeHtml(state.user?.username || '')}</span><div class="user-menu-wrap"><button class="avatar-button" id="user-menu-btn" type="button" aria-label="打开用户菜单" aria-expanded="false">${avatarMarkup()}</button><div class="user-menu hidden" id="user-menu"><button type="button" data-user-about>${ICONS.about}<span>关于</span></button><button type="button" data-user-evolution><span>🧬</span><span>进化</span></button><button type="button" data-user-settings>${ICONS.settings}<span>设置</span></button><button type="button" data-user-logout>${ICONS.logout}<span>注销</span></button></div></div></div></header>
      <div class="workspace"><button class="icon-btn sidebar-control sidebar-expand" id="expand-sidebar" type="button" title="展开服务器列表" aria-label="展开服务器列表">›</button><aside class="sidebar" id="sidebar">
        <div class="section-head"><span class="sidebar-title"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></svg><span>服务器</span><span class="server-count" id="server-count">${state.servers.length}</span></span><span class="sidebar-head-actions"><button class="icon-btn sidebar-control" id="add-server" title="添加服务器" aria-label="添加服务器">＋</button><button class="icon-btn sidebar-control" id="collapse-sidebar" title="隐藏服务器列表" aria-label="隐藏服务器列表">‹</button></span></div>
        <div class="server-list" id="server-list"></div><div class="empty" id="server-empty">添加你的第一台开发服务器，密码或私钥仅以加密形式保存。</div>
        <div class="host-status" aria-label="当前部署服务器资源使用率"><div class="host-status-title"><span data-host-name>部署服务器</span><span class="host-live-dot" aria-hidden="true"></span></div>${[['cpu','CPU'],['memory','内存'],['disk','磁盘']].map(([key, label]) => `<div class="host-metric"><div><span>${label}</span><strong data-host-${key}>--</strong></div><span class="host-meter"><i data-host-${key}-bar></i></span></div>`).join('')}<div class="host-version"><span>Version: <strong data-host-version>--</strong></span></div></div>
      </aside><main class="main"><div class="tab-strip"><button type="button" class="tab-scroll tab-scroll-left" data-tab-scroll="-1" title="向左查看更多标签" aria-label="向左查看更多标签">‹</button><nav class="tabs" id="tabs" aria-label="终端标签"></nav><button type="button" class="tab-scroll tab-scroll-right" data-tab-scroll="1" title="向右查看更多标签" aria-label="向右查看更多标签">›</button><button type="button" class="tab-add" data-tab-add title="新建 SSH 终端" aria-label="选择服务器并新建 SSH 终端">＋</button></div><section class="content" id="content"><div class="welcome"><div class="welcome-card">${brandMark('welcome-brand-mark')}<h2>随时随地，连接你的开发环境</h2><p>从左侧选择服务器开启终端。会话在服务器端保持，切换标签不会中断 Codex 或 OpenCode。</p><button class="primary" id="welcome-add" style="width:auto">添加服务器</button></div></div></section></main></div>
    </div>`;
    const menuButton = $('#user-menu-btn'); const menu = $('#user-menu');
    menuButton.onclick = (event) => { event.stopPropagation(); const open = menu.classList.toggle('hidden') === false; menuButton.setAttribute('aria-expanded', String(open)); if (open) setTimeout(() => document.addEventListener('click', () => { menu.classList.add('hidden'); menuButton.setAttribute('aria-expanded', 'false'); }, { once:true }), 0); };
    menu.onclick = (event) => event.stopPropagation();
    $('[data-user-about]', menu).onclick = () => { menu.classList.add('hidden'); openAboutModal(); };
    $('[data-user-evolution]', menu).onclick = () => { menu.classList.add('hidden'); openEvolutionModal(); };
    $('[data-user-settings]', menu).onclick = () => { menu.classList.add('hidden'); openSettingsModal(); };
    $('[data-user-logout]', menu).onclick = logout;
    $('#collapse-sidebar').onclick = () => setSidebarVisible(false); $('#expand-sidebar').onclick = () => setSidebarVisible(true); $('#add-server').onclick = () => openServerModal(); $('#welcome-add').onclick = () => openServerModal(); renderServers(); renderTabs(); renderSystemStatus();
  }
  function setSidebarVisible(visible) {
    const shell = $('.app-shell'); const sidebar = $('#sidebar'); if (!shell || !sidebar) return;
    if (innerWidth <= 760) { state.sidebarOpen = visible; sidebar.classList.toggle('open', visible); shell.classList.toggle('sidebar-open', visible); return; }
    state.sidebarCollapsed = !visible; localStorage.setItem(SIDEBAR_STORAGE_KEY, state.sidebarCollapsed ? '1' : '0'); shell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  }
  function fitTerminal(tab) {
    if (!tab?.terminal || tab.restoring) return;
    const dimensions = tab.fit?.proposeDimensions?.();
    if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) { tab.fit?.fit(); return; }
    // FitAddon rounds the available width down, but fractional font metrics,
    // fallback CJK fonts and the scrollbar can still clip a double-width glyph
    // at the edge. Keep a full wide-character cell as a safety gutter so the
    // remote PTY wraps before Chinese text reaches the visible boundary.
    const cols = Math.max(2, Math.floor(dimensions.cols) - TERMINAL_SAFE_COLUMNS);
    const rows = Math.max(1, Math.floor(dimensions.rows));
    if (tab.terminal.cols !== cols || tab.terminal.rows !== rows) tab.terminal.resize(cols, rows);
  }
  function scheduleTerminalFit(tab) {
    if (!tab?.terminal || tab.resizeFrame) return;
    tab.resizeFrame = requestAnimationFrame(() => {
      tab.resizeFrame = null;
      if (tab.id !== state.activeTab || tab.view?.classList.contains('hidden')) return;
      fitTerminal(tab); sendResize(tab);
    });
  }
  let tabDrag = null;
  let serverDrag = null;
  let serverGroupDrag = null;
  function stopTabDrag() {
    const drag = tabDrag; if (!drag) return;
    clearTimeout(drag.timer);
    try { drag.handle.releasePointerCapture?.(drag.pointerId); } catch { /* pointer already released */ }
    drag.item?.classList.remove('dragging'); drag.list?.classList.remove('tab-dragging');
    tabDrag = null;
  }
  function reorderTabsAtPointer(drag, clientX) {
    const bounds = drag.list.getBoundingClientRect(); const edge = 42;
    if (clientX < bounds.left + edge) drag.list.scrollLeft -= 14;
    else if (clientX > bounds.right - edge) drag.list.scrollLeft += 14;
    const others = [...drag.list.querySelectorAll(':scope > .tab[data-tab]')].filter((item) => item !== drag.item);
    const before = others.find((item) => { const itemBounds = item.getBoundingClientRect(); return clientX < itemBounds.left + itemBounds.width / 2; });
    if (before) drag.list.insertBefore(drag.item, before); else drag.list.appendChild(drag.item);
  }
  function handleTabDragPointerDown(event, handle, list) {
    if (event.button !== undefined && event.button !== 0) return;
    stopTabDrag();
    const item = handle.closest('.tab[data-tab]'); if (!item || state.tabs.size < 2) return;
    const drag = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, handle, item, list, dragging:false, timer:null };
    drag.timer = setTimeout(() => {
      if (tabDrag !== drag) return;
      drag.dragging = true; handle._suppressClick = true;
      item.classList.add('dragging'); list.classList.add('tab-dragging');
    }, 280);
    tabDrag = drag;
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* pointer capture unavailable */ }
  }
  function handleTabDragPointerMove(event) {
    const drag = tabDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) stopTabDrag();
      return;
    }
    event.preventDefault(); reorderTabsAtPointer(drag, event.clientX);
  }
  function handleTabDragPointerUp(event) {
    const drag = tabDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) { stopTabDrag(); return; }
    event.preventDefault(); drag.handle._suppressClick = true;
    const ids = [...drag.list.querySelectorAll(':scope > .tab[data-tab]')].map((item) => item.dataset.tab);
    const oldIds = [...state.tabs.keys()]; const changed = ids.some((id, index) => oldIds[index] !== id);
    stopTabDrag();
    if (changed) { const current = state.tabs; state.tabs = new Map(ids.map((id) => [id, current.get(id)]).filter(([, tab]) => tab)); persistSessions(); }
  }
  function handleTabDragPointerCancel(event) {
    const drag = tabDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.dragging; stopTabDrag(); if (wasDragging) renderTabs();
  }
  function stopServerDrag({ restore = false } = {}) {
    const drag = serverDrag; if (!drag) return;
    clearTimeout(drag.timer);
    try { drag.handle.releasePointerCapture?.(drag.pointerId); } catch { /* pointer already released */ }
    drag.item?.classList.remove('dragging'); drag.list?.classList.remove('server-dragging');
    serverDrag = null;
    if (restore && drag.oldOrder) { state.servers = drag.oldOrder; renderServers(); }
  }
  function stopServerGroupDrag({ restore = false } = {}) {
    const drag = serverGroupDrag; if (!drag) return;
    clearTimeout(drag.timer);
    try { drag.handle.releasePointerCapture?.(drag.pointerId); } catch { /* pointer already released */ }
    drag.group?.classList.remove('dragging'); drag.list?.classList.remove('group-dragging');
    serverGroupDrag = null;
    if (restore && drag.oldOrder) { state.servers = drag.oldOrder; renderServers(); }
  }
  async function saveServerOrder(previousOrder) {
    try {
      await api('/api/servers/reorder', { method:'POST', body:JSON.stringify({ ids:state.servers.map((server) => server.id) }) });
    } catch (error) {
      state.servers = previousOrder;
      renderServers();
      notify(error.message || '服务器排序保存失败，已恢复原顺序', 'error');
    }
  }
  function reorderServersAtPointer(drag, clientY) {
    const source = drag.item;
    // Groups are a presentation of the persisted server.group value.  Keep a
    // drag reorder inside its current group so sorting never temporarily (or
    // permanently) separates servers from their group.
    const container = source.parentElement?.classList.contains('server-group-items') ? source.parentElement : drag.list;
    const items = [...container.querySelectorAll(':scope > [data-server]')];
    const others = items.filter((item) => item !== source);
    const before = others.find((item) => { const bounds = item.getBoundingClientRect(); return clientY < bounds.top + bounds.height / 2; });
    if (before) container.insertBefore(source, before); else container.appendChild(source);
    const ids = [...drag.list.querySelectorAll('[data-server]')].map((item) => item.dataset.server);
    const byId = new Map(state.servers.map((server) => [server.id, server]));
    state.servers = ids.map((id) => byId.get(id)).filter(Boolean);
  }
  function reorderServerGroupsAtPointer(drag, clientY) {
    const groups = [...drag.list.querySelectorAll(':scope > .server-group')];
    const others = groups.filter((group) => group !== drag.group);
    const before = others.find((group) => { const bounds = group.getBoundingClientRect(); return clientY < bounds.top + bounds.height / 2; });
    if (before) drag.list.insertBefore(drag.group, before); else drag.list.appendChild(drag.group);
    const ids = [...drag.list.querySelectorAll('[data-server]')].map((item) => item.dataset.server);
    const byId = new Map(state.servers.map((server) => [server.id, server]));
    state.servers = ids.map((id) => byId.get(id)).filter(Boolean);
  }
  function handleServerGroupPointerDown(event, handle, list) {
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation(); stopServerGroupDrag(); stopServerDrag();
    const group = handle.closest('.server-group'); if (!group) return;
    const oldOrder = [...state.servers];
    const drag = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, handle, group, list, oldOrder, dragging:false, timer:null };
    drag.timer = setTimeout(() => {
      if (serverGroupDrag !== drag) return;
      drag.dragging = true; handle._suppressClick = true;
      group.classList.add('dragging'); list.classList.add('group-dragging');
    }, 280);
    serverGroupDrag = drag;
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* pointer capture unavailable */ }
  }
  function handleServerGroupPointerMove(event) {
    const drag = serverGroupDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) stopServerGroupDrag();
      return;
    }
    event.preventDefault(); reorderServerGroupsAtPointer(drag, event.clientY);
  }
  function handleServerGroupPointerUp(event) {
    const drag = serverGroupDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) { stopServerGroupDrag(); return; }
    event.preventDefault(); drag.handle._suppressClick = true;
    const changed = drag.oldOrder.some((server, index) => state.servers[index]?.id !== server.id);
    stopServerGroupDrag(); if (changed) saveServerOrder(drag.oldOrder);
  }
  function handleServerEditPointerDown(event, handle, list) {
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation();
    stopServerDrag();
    const item = handle.closest('[data-server]'); if (!item) return;
    const id = item.dataset.server;
    const oldOrder = [...state.servers];
    const drag = { id, pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, handle, item, list, oldOrder, dragging:false, timer:null };
    drag.timer = setTimeout(() => {
      if (serverDrag !== drag) return;
      drag.dragging = true;
      handle._suppressClick = true;
      item.classList.add('dragging'); list.classList.add('server-dragging');
    }, 280);
    serverDrag = drag;
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* pointer capture unavailable */ }
  }
  function handleServerEditPointerMove(event) {
    const drag = serverDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance > 8) stopServerDrag();
      return;
    }
    event.preventDefault(); reorderServersAtPointer(drag, event.clientY);
  }
  function handleServerEditPointerUp(event) {
    const drag = serverDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) { stopServerDrag(); return; }
    event.preventDefault(); drag.handle._suppressClick = true;
    const changed = drag.oldOrder.some((server, index) => state.servers[index]?.id !== server.id);
    stopServerDrag();
    if (changed) saveServerOrder(drag.oldOrder);
  }
  function renderServers() {
    const list = $('#server-list'); if (!list) return;
    stopServerDrag(); stopServerGroupDrag();
    const groups = new Map();
    state.servers.forEach((server) => {
      const group = String(server.group || '').trim();
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(server);
    });
    const serverMarkup = (server) => {
      const color = server.color || '';
      const style = color ? ` style="--server-bg:${color};--server-fg:${serverForeground(color)}"` : '';
      const meters = ['cpu','memory','disk'].map((metric) => `<span class="server-resource-meter ${metric}" data-server-metric="${metric}" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></span>`).join('');
      const osLabel = serverOsLabel(server); const osKey = detectServerOs(server);
      return `<button class="server-item ${color ? 'has-color' : ''}" data-server="${server.id}"${style}><span class="server-meta"><span class="server-name">${escapeHtml(server.name)}</span><span class="server-host">${escapeHtml(server.username)}@${escapeHtml(server.host)}:${server.port}</span></span><span class="server-monitor"><span class="server-resource-bars unavailable" data-server-status="${server.id}">${meters}</span><span class="server-edit server-os-icon" data-edit="${server.id}" data-server-os="${osKey}" title="${escapeHtml(osLabel)}；点击编辑；长按后拖动排序" aria-label="${escapeHtml(osLabel)}图标；点击编辑，长按拖动排序">${serverOsIcon(server)}</span></span></button>`;
    };
    list.innerHTML = [...groups.entries()].map(([group, servers]) => {
      const collapsed = state.collapsedServerGroups.has(group);
      const label = group || '未分组';
      return `<section class="server-group" data-group="${escapeHtml(group)}"><button type="button" class="server-group-head" data-group-toggle="${escapeHtml(group)}" aria-expanded="${String(!collapsed)}"><span class="server-group-chevron" aria-hidden="true">${collapsed ? '›' : '⌄'}</span><span class="server-group-name">${escapeHtml(label)}</span><span class="server-group-count" data-group-drag="${escapeHtml(group)}" title="点击折叠；长按后拖动分组" aria-label="${escapeHtml(label)} 分组，共 ${servers.length} 台服务器；长按拖动排序">${servers.length}</span></button><div class="server-group-items${collapsed ? ' hidden' : ''}">${servers.map(serverMarkup).join('')}</div></section>`;
    }).join('');
    const count = $('#server-count'); if (count) count.textContent = String(state.servers.length); $('#server-empty').classList.toggle('hidden', state.servers.length > 0);
    list.querySelectorAll('[data-group-toggle]').forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const group = button.dataset.groupToggle || '';
        if (state.collapsedServerGroups.has(group)) state.collapsedServerGroups.delete(group); else state.collapsedServerGroups.add(group);
        localStorage.setItem(SERVER_GROUPS_STORAGE_KEY, JSON.stringify([...state.collapsedServerGroups]));
        renderServers();
      };
    });
    list.querySelectorAll('[data-server]').forEach((button) => { button.onclick = (event) => { if (event.target.closest('[data-edit]')) return; openTab(button.dataset.server); if (innerWidth <= 760) setSidebarVisible(false); }; });
    list.querySelectorAll('[data-group-drag]').forEach((handle) => {
      handle.onpointerdown = (event) => handleServerGroupPointerDown(event, handle, list);
      handle.onpointermove = handleServerGroupPointerMove;
      handle.onpointerup = handleServerGroupPointerUp;
      handle.onpointercancel = () => stopServerGroupDrag();
      handle.onclick = (event) => {
        event.stopPropagation();
        if (handle._suppressClick) { handle._suppressClick = false; event.preventDefault(); return; }
        handle.closest('[data-group-toggle]')?.click();
      };
    });
    list.querySelectorAll('[data-edit]').forEach((handle) => {
      handle.onpointerdown = (event) => handleServerEditPointerDown(event, handle, list);
      handle.onpointermove = handleServerEditPointerMove;
      handle.onpointerup = handleServerEditPointerUp;
      handle.onpointercancel = () => stopServerDrag();
      handle.onclick = (event) => {
        event.stopPropagation();
        if (handle._suppressClick) { handle._suppressClick = false; event.preventDefault(); return; }
        const server = state.servers.find((item) => item.id === handle.dataset.edit); if (server) openServerModal(server);
      };
    });
    renderServerStatuses();
  }
  function uniqueServerTabName(serverName) {
    const names = new Set([...state.tabs.values()].map((tab) => tab.name));
    if (!names.has(serverName)) return serverName;
    let number = 2; while (names.has(`${serverName} ${number}`)) number += 1;
    return `${serverName} ${number}`;
  }
  function openNewTab(serverId) {
    const server = state.servers.find((item) => item.id === serverId); if (!server) return;
    const kind = server.protocol === 'vnc' ? 'vnc' : 'ssh';
    const tab = createTabState(server, { name:uniqueServerTabName(server.name) + (kind === 'vnc' ? ' · 桌面' : ''), kind, initialCwd:'' });
    state.tabs.set(tab.id, tab); persistSessions(); activateTab(tab.id); connectTab(tab);
  }
  function dismissServerPicker() { document.querySelector('.tab-server-picker')?.remove(); }
  function openServerPicker(button) {
    dismissServerPicker();
    if (!state.servers.length) { notify('请先添加服务器'); return; }
    const menu = document.createElement('div'); menu.className = 'tab-context-menu tab-server-picker'; menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div class="tab-server-picker-title">新建 SSH 终端</div>${state.servers.map((server) => `<button type="button" data-open-server="${server.id}" style="--picker-server-color:${server.color || '#66e3b4'}"><span><i class="server-color-dot"></i>${escapeHtml(server.name)}</span><small>${escapeHtml(server.username)}@${escapeHtml(server.host)}</small></button>`).join('')}`;
    document.body.appendChild(menu); const anchor = button.getBoundingClientRect(); const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - bounds.height - 8))}px`;
    menu.onclick = (event) => {
      const serverId = event.target.closest('[data-open-server]')?.dataset.openServer; if (!serverId) return;
      dismissServerPicker(); openNewTab(serverId);
    };
  }
  function updateTabOverflowControls() {
    const tabs = $('#tabs'); const strip = tabs?.closest('.tab-strip'); if (!tabs || !strip) return;
    const add = $('[data-tab-add]', strip); const style = getComputedStyle(strip);
    const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const availableWithoutArrows = Math.max(0, strip.clientWidth - horizontalPadding - Number(add?.offsetWidth || 0));
    const tabsWidth = [...tabs.querySelectorAll(':scope > .tab[data-tab]')].reduce((width, tab) => width + tab.offsetWidth, 0);
    const overflowing = tabsWidth > availableWithoutArrows + 1;
    strip.classList.toggle('has-tab-overflow', overflowing);
    const maxScroll = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
    const left = $('[data-tab-scroll="-1"]', strip); const right = $('[data-tab-scroll="1"]', strip);
    if (left) left.disabled = !overflowing || tabs.scrollLeft <= 1;
    if (right) right.disabled = !overflowing || tabs.scrollLeft >= maxScroll - 1;
  }
  function scrollTabStrip(direction) {
    const tabs = $('#tabs'); if (!tabs) return;
    tabs.scrollBy({ left:direction * Math.max(180, tabs.clientWidth * 0.72), behavior:'smooth' });
  }
  function revealActiveTab() {
    const tabs = $('#tabs'); const active = tabs?.querySelector('.tab.active'); if (!tabs || !active) return;
    const viewport = tabs.getBoundingClientRect(); const bounds = active.getBoundingClientRect();
    if (bounds.left < viewport.left) tabs.scrollLeft -= viewport.left - bounds.left;
    else if (bounds.right > viewport.right) tabs.scrollLeft += bounds.right - viewport.right;
  }
  function renderTabs() {
    const tabs = $('#tabs'); if (!tabs) return; stopTabDrag(); const scrollLeft = tabs.scrollLeft;
    const tabMarkup = [...state.tabs.values()].map((tab) => { const server = state.servers.find((item) => item.id === tab.serverId); return `<div class="tab ${tab.id === state.activeTab ? 'active' : ''}${tab.approvalEnabled ? ' auto-approval' : ''}${tab.taskWasWorking ? ' working' : ''}" data-tab="${tab.id}" title="${escapeHtml(tab.name)}"><button type="button" class="tab-drag-handle${tab.approvalEnabled ? ' auto' : ''}" data-tab-drag data-approval-toggle="${tab.id}" title="${tab.approvalEnabled ? '自动审批已开启，点击关闭（长按可拖动排序）' : '点击开启自动审批（长按可拖动排序）'}" aria-label="长按拖动 ${escapeHtml(tab.name)} 标签排序" aria-pressed="${tab.approvalEnabled ? 'true' : 'false'}">${connectionIcon(tab.connected, tab.needsAttention, server?.color, tab.approvalEnabled)}</button>${tab.taskWasWorking ? '<span class="tab-working-dot" title="Codex 正在运行" aria-label="Codex 正在运行"></span>' : ''}<span class="tab-name">${escapeHtml(tab.name)}</span><button type="button" class="close" data-close="${tab.id}" title="关闭 ${escapeHtml(tab.name)}" aria-label="关闭 ${escapeHtml(tab.name)}">×</button></div>`; }).join('');
    tabs.innerHTML = tabMarkup; tabs.scrollLeft = scrollLeft;
    tabs.querySelectorAll('[data-tab]').forEach((node) => node.onclick = (event) => {
      if (event.target.closest('[data-close]')) return;
      const handle = event.target.closest('[data-tab-drag]');
      if (handle?._suppressClick) { handle._suppressClick = false; event.preventDefault(); return; }
      const clickedTab = state.tabs.get(node.dataset.tab);
      if (handle?.dataset.approvalToggle) {
        event.preventDefault();
        if (clickedTab && clickedTab.id === state.activeTab && !clickedTab.approvalEnabled && clickedTab.approvalStopReason) { openApprovalHistoryModal(); return; }
        toggleTabApproval(clickedTab); return;
      }
      activateTab(node.dataset.tab);
    });
    tabs.querySelectorAll('[data-tab-drag]').forEach((handle) => { handle.onpointerdown = (event) => handleTabDragPointerDown(event, handle, tabs); handle.onpointermove = handleTabDragPointerMove; handle.onpointerup = handleTabDragPointerUp; handle.onpointercancel = handleTabDragPointerCancel; });
    tabs.querySelectorAll('[data-close]').forEach((node) => node.onclick = (event) => { event.stopPropagation(); closeTab(node.dataset.close); });
    const strip = tabs.closest('.tab-strip'); const add = $('[data-tab-add]', strip);
    if (add) add.onclick = (event) => { event.stopPropagation(); const open = document.querySelector('.tab-server-picker'); if (open) dismissServerPicker(); else openServerPicker(event.currentTarget); };
    strip?.querySelectorAll('[data-tab-scroll]').forEach((button) => { button.onclick = () => scrollTabStrip(Number(button.dataset.tabScroll)); });
    tabs.onscroll = updateTabOverflowControls;
    tabs.onwheel = (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || tabs.scrollWidth <= tabs.clientWidth) return;
      event.preventDefault(); tabs.scrollLeft += event.deltaY;
    };
    if (!tabs._overflowObserver && window.ResizeObserver) {
      tabs._overflowObserver = new ResizeObserver(updateTabOverflowControls); tabs._overflowObserver.observe(tabs);
    }
    requestAnimationFrame(updateTabOverflowControls);
  }
  function openTab(serverId) {
    const server = state.servers.find((item) => item.id === serverId); if (!server) return;
    if (server.protocol === 'vnc') { openNewTab(serverId); return; }
    let tab = [...state.tabs.values()].find((item) => item.serverId === serverId);
    if (!tab) { tab = createTabState(server); state.tabs.set(tab.id, tab); persistSessions(); }
    activateTab(tab.id); connectTab(tab);
  }
  function activateTab(tabId) {
    if (!state.tabs.has(tabId)) return;
    state.activeTab = tabId;
    const tab = state.tabs.get(tabId);
    if (tab) {
      tab.needsAttention = false;
      if (tab.attentionTimer) clearTimeout(tab.attentionTimer);
      tab.attentionTimer = null;
      const status = latestCodexStatus(tab);
      if (status.codexActive) { tab.taskWasWorking = true; tab.lastCompletionKey = ''; }
      else if (status.completionKey) tab.lastCompletionKey = status.completionKey;
    }
    updateAttentionTitle();
    persistSessions(); renderTabs();
    requestAnimationFrame(() => requestAnimationFrame(() => { revealActiveTab(); updateTabOverflowControls(); }));
    [...state.tabs.values()].forEach((item) => { if (item.view) item.view.classList.toggle('hidden', item.id !== tabId); });
    // xterm measures its canvas from the visible DOM.  Two animation frames
    // avoid sending a transient 0x0/1x1 resize to full-screen programs.
    if (tab?.terminal) requestAnimationFrame(() => requestAnimationFrame(() => {
      if (state.activeTab !== tabId || !tab.view || tab.view.classList.contains('hidden')) return;
      // A forced pin here would erase the scroll position they left behind,
      // and a resize can clamp the viewport back to the bottom on its own.
      // Only re-assert the live tail while the reader is still following it.
      fitTerminal(tab); sendResize(tab);
      tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1)); scrollTerminalToBottom(tab, tab.id === state.activeTab);
      tab.terminal.focus();
    }));
  }
  function defaultApprovalModelId() {
    const models = state.user?.approvalModels || [];
    return state.user?.preferences?.approvalDefaultModelId && models.some((item) => item.id === state.user.preferences.approvalDefaultModelId)
      ? state.user.preferences.approvalDefaultModelId
      : (models.find((item) => item.enabled !== false)?.id || models[0]?.id || '');
  }
  function approvalModelLabel(modelId) {
    const model = (state.user?.approvalModels || []).find((item) => item.id === modelId);
    return model ? `${model.name} · ${model.model}` : '';
  }
  function approvalBadgeLabel(tab) {
    if (tab.approvalEnabled) return tab.approvalStatus || (tab.approvalRememberAll ? '自动审批（不再询问）' : '自动审批已开启');
    if (tab.approvalStopReason) return '自动审批已停止';
    return '';
  }
  function setTabApprovalStatus(tab, text, tone = 'info', holdMs = 0) {
    if (!tab) return;
    if (tab.approvalStatusTimer) { clearTimeout(tab.approvalStatusTimer); tab.approvalStatusTimer = null; }
    tab.approvalStatus = text ? String(text) : '';
    tab.approvalTone = tone;
    if (holdMs > 0 && text) tab.approvalStatusTimer = setTimeout(() => { tab.approvalStatusTimer = null; if (tab.approvalStatus === text) { tab.approvalStatus = ''; tab.approvalTone = 'info'; updateApprovalIndicators(); } }, holdMs);
    updateApprovalIndicators();
  }
  function updateApprovalIndicators() {
    renderTabs();
    state.tabs.forEach((tab) => {
      const badge = tab.view ? $('.approval-badge', tab.view) : null;
      if (!badge) return;
      const label = approvalBadgeLabel(tab);
      badge.classList.toggle('hidden', !label);
      badge.textContent = label;
      badge.classList.toggle('working', Boolean(tab.approvalStatus) && tab.approvalTone === 'info');
      badge.classList.toggle('danger', tab.approvalTone === 'error');
      const historyLink = tab.view ? $('[data-approval-history]', tab.view) : null;
      if (historyLink && historyLink !== badge) {
        historyLink.classList.toggle('hidden', !label);
        historyLink.classList.toggle('danger', tab.approvalTone === 'error');
        historyLink.title = tab.approvalTone === 'error' ? '高危提示等待处理 · 点击查看审批记录' : '查看自动审批记录';
      }
    });
  }
  function sendApprovalControl(tab, action, extra = {}) {
    if (!tab.ws || tab.ws.readyState !== WebSocket.OPEN) return false;
    tab.ws.send(JSON.stringify({ type:'approval', action, ...extra }));
    return true;
  }
  async function enableTabApproval(tab, options = {}) {
    if (!tab || !state.tabs.has(tab.id)) return;
    const models = state.user?.approvalModels || [];
    if (!models.length) {
      tab.approvalEnabled = false; persistSessions(); renderTabs();
      if (!options.silent) { notify('请先在「设置 → 自动审批模型」中配置大模型', 'error'); openApprovalSettings(); }
      else setTabApprovalStatus(tab, '未配置审批模型', 'error', 4000);
      return;
    }
    const modelId = tab.approvalModelId && models.some((item) => item.id === tab.approvalModelId) ? tab.approvalModelId : defaultApprovalModelId();
    if (!modelId) { tab.approvalEnabled = false; persistSessions(); renderTabs(); return; }
    tab.approvalModelId = modelId;
    if (!sendApprovalControl(tab, 'enable', { modelId })) {
      if (!options.silent) notify('终端未连接，无法开启自动审批', 'error');
      setTabApprovalStatus(tab, '终端未连接', 'error', 4000);
      return;
    }
    tab.approvalEnabled = true;
    setTabApprovalStatus(tab, `已开启 · ${approvalModelLabel(modelId)}`, 'info', 4000);
    persistSessions(); renderTabs();
    if (!options.silent) notify(`已开启自动审批（${approvalModelLabel(modelId)}）`);
  }
  function disableTabApproval(tab, options = {}) {
    if (!tab) return;
    sendApprovalControl(tab, 'disable');
    tab.approvalEnabled = false; tab.approvalRememberAll = false;
    tab.highRiskWaiting = null;
    setTabApprovalStatus(tab, '', 'info');
    persistSessions(); renderTabs();
    if (!options.silent) notify('已关闭自动审批');
  }
  function toggleTabApproval(tab) {
    if (!tab) return;
    if (tab.approvalEnabled) disableTabApproval(tab); else void enableTabApproval(tab);
  }
  function rearmTabApproval(tab) {
    if (!tab || tab.kind !== 'ssh') return;
    if (tab.approvalEnabled) return;
    tab.approvalStopReason = ''; tab.approvalStopReasonMessage = '';
    void enableTabApproval(tab, { silent: true });
  }
  function handleApprovalMessage(tab, message) {
    if (!tab) return;
    const action = message.action;
    if (action === 'state') {
      tab.approvalEnabled = message.enabled === true;
      tab.approvalModelId = message.modelId || tab.approvalModelId;
      tab.approvalRememberAll = Boolean(message.rememberAll);
      if (tab.approvalEnabled) { tab.approvalStopReason = ''; tab.approvalStopReasonMessage = ''; }
      else if (message.reason && message.reason !== 'client-disabled') { tab.approvalStopReason = message.reason; tab.approvalStopReasonMessage = message.message || ''; }
      setTabApprovalStatus(tab, '', 'info');
      persistSessions(); updateApprovalIndicators();
    } else if (action === 'evaluating') {
      setTabApprovalStatus(tab, '正在让模型评估…', 'info');
    } else if (action === 'acted') {
      const reason = message.reason ? ` · ${message.reason}` : '';
      setTabApprovalStatus(tab, `已按下 ${message.label}${reason}`, message.choice === 'deny' ? 'error' : 'info', 6000);
      if (message.choice === 'approve_always') tab.approvalRememberAll = true;
    } else if (action === 'need_human') {
      if (message.highRisk === true) {
        // High-risk prompts wait for the human: keep the red warning until the
        // terminal prompt is answered, then record the manual outcome.
        setTabApprovalStatus(tab, `${message.message || '高危提示需要人工处理'}（在终端输入 1/2/3 后消失）`, 'error', 0);
        tab.highRiskWaiting = { promptKey: message.promptKey || '', reason: message.reason || '', since: Date.now() };
        notify(`${tab.name}：${message.message || '高危提示需要人工处理'}`, 'error');
        markTabAttention(tab, 'input');
      } else {
        setTabApprovalStatus(tab, message.message || '已交回人工处理', 'error', 8000);
        // Only terminal reasons are tracked as the "last stop"; model_error here
        // is a transient retry that the state event will overwrite when it
        // actually gives up after APPROVAL_MAX_ATTEMPTS.
        if (message.reason && message.reason !== 'model_error') { tab.approvalStopReason = message.reason; tab.approvalStopReasonMessage = message.message || ''; updateApprovalIndicators(); }
        notify(`${tab.name}：${message.message || '自动审批已交回人工处理'}`, 'error');
      }
    } else if (action === 'high_risk_resolved') {
      tab.highRiskWaiting = null;
      setTabApprovalStatus(tab, `高危已处理：${message.label || ''}`, message.choice === 'deny' ? 'error' : 'info', 8000);
    } else if (action === 'resolved') {
      if (tab.highRiskWaiting && message.promptKey && message.promptKey !== tab.highRiskWaiting.promptKey) tab.highRiskWaiting = null;
      else if (!tab.highRiskWaiting) setTabApprovalStatus(tab, '提示已消失', 'info', 3000);
      else { tab.highRiskWaiting = null; setTabApprovalStatus(tab, '提示已消失', 'info', 3000); }
    } else if (action === 'error') {
      tab.approvalEnabled = false; persistSessions();
      setTabApprovalStatus(tab, message.message || '自动审批不可用', 'error', 6000);
      notify(message.message || '自动审批不可用', 'error');
    }
  }
  function markTabAttention(tab, reason = 'input') {
    if (!tab || !tab.connected || tab.id === state.activeTab || tab.needsAttention || !state.tabs.has(tab.id)) return;
    tab.needsAttention = true;
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const message = reason === 'complete' ? '任务已完成' : '正在等待确认';
      try { new Notification('NexTerm 需要操作', { body: `${tab.name} 中的 Codex ${message}` }); } catch { /* notifications may be blocked by the browser */ }
    }
    updateAttentionTitle();
    renderTabs();
  }
  // Mirror the live Codex status of every tab into cheap UI signals:
  // the tab-strip "working" dot, the browser tab title, and the animated
  // favicon.  Called on every recognized status transition.
  function refreshRunningIndicators() {
    if (typeof renderTabs === 'function') renderTabs();
    let workingTabs = [];
    let waitingTabs = [];
    if (typeof latestCodexStatus === 'function') {
      for (const item of state.tabs.values()) {
        if (!item?.connected || !item?.terminal) continue;
        const status = latestCodexStatus(item);
        if (status.codexActive && !status.inputRequired) workingTabs.push(item);
        else if (status.inputRequired) waitingTabs.push(item);
      }
    }
    if (typeof renderRunningFavicon === 'function') renderRunningFavicon(workingTabs.length, waitingTabs.length);
    const workingName = workingTabs.length === 1 ? ` ${workingTabs[0].name} 工作中` : workingTabs.length > 1 ? ` ${workingTabs.length} 个标签工作中` : '';
    document.title = state.takenOverTabs.size ? '会话已接力 · NexTerm' : waitingTabs.length ? '⚡ 需要操作 · NexTerm' : workingTabs.length ? `⏳${workingName} · NexTerm` : 'NexTerm · Web SSH Workspace';
  }
  function updateAttentionTitle() { refreshRunningIndicators(); }
  function clearTabAttention(tab) {
    if (!tab?.needsAttention) return;
    tab.needsAttention = false;
    updateAttentionTitle();
    renderTabs();
  }
  // Programmatic follow must never outrank an in-flight user scroll. xterm only
  // marks the buffer as user-scrolled while the viewport sits above the live
  // tail, so that flag is the authoritative "the reader is in control" signal.
  function terminalUserScrolling(tab) {
    try { return tab?.terminal?._core?._bufferService?.isUserScrolling === true; } catch { return false; }
  }
  function terminalAtBottom(tab) {
    const terminal = tab?.terminal; const buffer = terminal?.buffer?.active;
    if (!buffer) return false;
    return Number(buffer.viewportY) >= Number(buffer.baseY) + Number(terminal.rows || 0) - 1;
  }
  function scrollTerminalToBottom(tab, force = false) {
    if (!tab?.terminal || (!force && tab.followOutput === false)) return;
    if (terminalUserScrolling(tab)) return;
    tab.terminal.scrollToBottom?.();
    requestAnimationFrame(() => { if ((force || tab.followOutput !== false) && !terminalUserScrolling(tab)) tab.terminal?.scrollToBottom?.(); });
  }
  // A live output frame must only pin the viewport to the tail while the
  // reader is still following it.  Force-fitting the bottom on every frame
  // cancels a wheel scrollback the moment Codex (or any program) keeps
  // printing, which is why history above the prompt could not be read until
  // the session was re-entered.
  function terminalFollowsLiveTail(tab) {
    return Boolean(tab?.terminal) && tab.followOutput !== false && !terminalUserScrolling(tab) && terminalAtBottom(tab);
  }
  function refreshTerminalTail(tab) {
    if (!terminalFollowsLiveTail(tab)) return;
    tab.terminal.scrollToBottom?.();
    tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1));
  }
  // A programmatic completion/idle hint may re-assert the live tail, but only
  // while the reader is still following it. xterm itself already pins the
  // viewport on each output frame unless the reader scrolled up, so the only
  // case that can stick is a full redraw (snapshot restore / terminal reset)
  // while a new prompt is on its way: force the bottom once on the active
  // tab, but never over an in-flight wheel scrollback.
  function reassertTerminalLiveTail(tab) {
    if (tab.id === state.activeTab && !terminalUserScrolling(tab)) scrollTerminalToBottom(tab, true);
  }
  function terminalViewportText(tab) {
    const terminal = tab?.terminal; const buffer = terminal?.buffer?.active;
    if (!terminal || !buffer) return '';
    // Hidden tabs can report viewportY=0 even while the prompt is at the end
    // of the scrollback.  Inspect the newest lines instead of only the pixels
    // currently visible in the active tab.
    const viewportEnd = buffer.length;
    const viewportStart = Math.max(0, viewportEnd - Math.max(80, Number(terminal.rows || 1) * 4));
    const lines = [];
    for (let index = viewportStart; index < viewportEnd; index += 1) {
      const line = buffer.getLine(index);
      if (!line) continue;
      // xterm stores a visual wrap as a separate buffer line.  Joining wrapped
      // rows makes the Codex status matcher see the same logical line as the
      // user sees, even when a large font leaves only a few columns.
      const text = line.translateToString(true) || '';
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return lines.join('\n');
  }
  function terminalTailText(tab) {
    const text = terminalViewportText(tab);
    const limit = Math.max(32, Number(tab?.terminal?.rows || 1) * 2);
    return text.split('\n').slice(-limit).join('\n');
  }
  function latestCodexStatus(tab) {
    const text = terminalTailText(tab);
    const lastMatch = (pattern) => {
      const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let match; let result = { index:-1, text:'' };
      while ((match = globalPattern.exec(text))) {
        result = { index:match.index, text:match[0] };
        if (!match[0]) globalPattern.lastIndex += 1;
      }
      return result;
    };
    const matches = { input:lastMatch(INPUT_REQUIRED_PATTERN), active:lastMatch(CODEX_ACTIVE_PATTERN), complete:lastMatch(CODEX_COMPLETE_PATTERN), idle:lastMatch(CODEX_IDLE_PATTERN) };
    const indexes = Object.fromEntries(Object.entries(matches).map(([name, match]) => [name, match.index]));
    const latest = Math.max(...Object.values(indexes));
    if (latest < 0) return { inputRequired:false, codexActive:false, codexCompleted:false, codexIdle:false, completionKey:'' };
    // Codex prints the idle prompt immediately after "Worked for ...".  Keep
    // that completion visible to the state machine even though idle is the
    // newest recognized line, then deduplicate it with completionKey.
    const completionAfterActive = indexes.complete >= 0 && indexes.complete > indexes.active;
    return {
      inputRequired: indexes.input === latest,
      codexActive: indexes.active === latest,
      codexCompleted: indexes.complete === latest || completionAfterActive,
      codexIdle: indexes.idle === latest,
      completionKey: matches.complete.text.replace(/\s+/g, ' ').trim()
    };
  }
  function trackTabOutput(tab, replay = false) {
    if (!tab?.terminal) return;
    const status = latestCodexStatus(tab);
    const { inputRequired, codexActive, codexCompleted } = status;
    const newCompletion = codexCompleted && status.completionKey && status.completionKey !== tab.lastCompletionKey;
    // Resolve redraw residue by using the newest matching status line.  A
    // stale approval prompt must not keep the icon flashing after Working
    // appears again; conversely, a newer prompt still wins over the spinner.
    if (codexActive && !inputRequired) {
      if (!tab.taskWasWorking) tab.lastCompletionKey = '';
      tab.taskWasWorking = true;
      if (tab.attentionTimer) clearTimeout(tab.attentionTimer);
      tab.attentionTimer = null;
      // A redraw can replace a prompt/finished line with the live Working
      // status.  Clear any attention flag that was set by the older frame.
      clearTabAttention(tab);
      refreshRunningIndicators();
      return;
    }
    const codexReturnedIdle = tab.taskWasWorking && status.codexIdle;
    if (tab.id === state.activeTab) {
      if (newCompletion) tab.lastCompletionKey = status.completionKey;
      if (inputRequired || newCompletion || codexReturnedIdle) {
        tab.taskWasWorking = false;
        // A finished session that returned to the idle prompt repaints most of
        // the screen.  When the reader owns the view, re-assert the live tail so
        // the new prompt renders immediately instead of waiting for F5.
        // Only a finished session / fresh idle prompt needs the nudge: while the
        // model auto-presses Enter an input prompt also matches this branch, and
        // re-pinning the viewport on every one of those would cancel an in-flight
        // scroll.  xterm already follows the live tail in the normal cases.
        if (newCompletion || codexReturnedIdle) requestAnimationFrame(() => { reassertTerminalLiveTail(tab); });
      }
      clearTabAttention(tab);
      refreshRunningIndicators();
      return;
    }
    if (!inputRequired && !newCompletion && !codexReturnedIdle) return;
    if (tab.attentionTimer) clearTimeout(tab.attentionTimer);
    tab.attentionTimer = setTimeout(() => {
      tab.attentionTimer = null;
      if (tab.id === state.activeTab || !tab.connected) return;
      const latestStatus = latestCodexStatus(tab);
      if (latestStatus.codexActive && !latestStatus.inputRequired) { if (!tab.taskWasWorking) tab.lastCompletionKey = ''; tab.taskWasWorking = true; clearTabAttention(tab); refreshRunningIndicators(); return; }
      const latestInputRequired = latestStatus.inputRequired;
      const latestCompleted = latestStatus.codexCompleted && latestStatus.completionKey && latestStatus.completionKey !== tab.lastCompletionKey;
      const latestReturnedIdle = tab.taskWasWorking && latestStatus.codexIdle;
      if (latestInputRequired || latestCompleted || latestReturnedIdle) { if (latestCompleted) tab.lastCompletionKey = latestStatus.completionKey; tab.taskWasWorking = false; markTabAttention(tab, latestInputRequired ? 'input' : 'complete'); }
      refreshRunningIndicators();
    }, 500);
  }
  function resolveCwdRequests(tab, fallback = '') {
    tab.cwdRequests?.forEach((pending) => { clearTimeout(pending.timer); pending.resolve(fallback); });
    tab.cwdRequests?.clear();
  }
  function requestTabCwd(tab) {
    const fallback = tab.currentDirectory || tab.initialCwd || '';
    if (!tab.ws || tab.ws.readyState !== WebSocket.OPEN) return Promise.resolve(fallback);
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { tab.cwdRequests.delete(requestId); resolve(fallback); }, 3500);
      tab.cwdRequests.set(requestId, { resolve, timer });
      tab.ws.send(JSON.stringify({ type:'cwd', requestId }));
    });
  }
  function uniqueCloneName(sourceName) {
    const base = `${sourceName} 副本`;
    const names = new Set([...state.tabs.values()].map((tab) => tab.name));
    if (!names.has(base)) return base;
    let number = 2; while (names.has(`${base} ${number}`)) number += 1;
    return `${base} ${number}`;
  }
  async function cloneTab(tabId) {
    const source = state.tabs.get(tabId); if (!source) return;
    const server = state.servers.find((item) => item.id === source.serverId); if (!server) return;
    const currentDirectory = await requestTabCwd(source);
    if (!state.tabs.has(tabId)) return;
    const clone = createTabState(server, { name:uniqueCloneName(source.name), initialCwd:currentDirectory });
    state.tabs.set(clone.id, clone); persistSessions(); activateTab(clone.id); connectTab(clone);
  }
  function openTabSftp(tabId) {
    const tab = state.tabs.get(tabId); if (!tab) return;
    activateTab(tabId);
    // The SFTP panel only needs the /files REST API, not a live shell/desktop.
    // For SSH tabs we still connect so the panel can start at the terminal cwd;
    // for Windows(VNC) tabs the view (and thus the panel) may already exist, in
    // which case skip the VNC handshake entirely.
    if (!(tab.kind === 'vnc' && tab.view && tab.openSftp)) connectTab(tab);
    tab.openSftp?.();
  }
  function reconnectTab(tab) {
    if (!tab || !state.tabs.has(tab.id)) return;
    tab.manualClose = false; tab.reconnectBlocked = false;
    if (tab.reconnectTimer) { clearTimeout(tab.reconnectTimer); tab.reconnectTimer = null; }
    tab.reconnectAttempt = 0;
    tab.lastSeq = 0;
    if (tab.kind === 'vnc') disposeVnc(tab);
    // Close the old socket without waiting for its onclose callback: that
    // handler would otherwise schedule another reconnect and race with the
    // fresh connection, so the button looked unresponsive.
    const oldSocket = tab.ws; tab.ws = null; tab.wsGeneration += 1;
    if (oldSocket) { oldSocket.onopen = null; oldSocket.onmessage = null; oldSocket.onclose = null; oldSocket.onerror = null; try { oldSocket.close(); } catch { /* socket already closed */ } }
    connectTab(tab);
  }
  function currentTakenOverTabs() {
    const tabs = [...state.takenOverTabs].map((id) => state.tabs.get(id)).filter((tab) => tab?.reconnectBlocked);
    state.takenOverTabs = new Set(tabs.map((tab) => tab.id)); return tabs;
  }
  function dismissSessionTakeoverDialog() {
    document.querySelector('[data-takeover-dialog]')?.remove(); state.takenOverTabs.clear(); updateAttentionTitle();
  }
  function refreshSessionTakeoverDialog() {
    const affected = currentTakenOverTabs(); const backdrop = document.querySelector('[data-takeover-dialog]');
    if (!affected.length) { backdrop?.remove(); updateAttentionTitle(); return; }
    updateAttentionTitle(); if (!backdrop) return;
    $('[data-takeover-message]', backdrop).textContent = affected.length === 1 ? `“${affected[0].name}” 已在另一台设备或浏览器页面中继续。` : `${affected.length} 个终端会话已在另一台设备或浏览器页面中继续。`;
    $('[data-takeover-list]', backdrop).innerHTML = affected.slice(0, 4).map((tab) => `<span>${escapeHtml(tab.name)}</span>`).join('') + (affected.length > 4 ? `<span>另有 ${affected.length - 4} 个标签</span>` : '');
  }
  function showSessionTakeoverDialog(tab) {
    state.takenOverTabs.add(tab.id);
    let backdrop = document.querySelector('[data-takeover-dialog]');
    if (!backdrop) {
      backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.dataset.takeoverDialog = '';
      backdrop.innerHTML = '<div class="modal confirm-modal takeover-modal" role="alertdialog" aria-modal="true" aria-labelledby="takeover-dialog-title"><div class="modal-head"><h3 id="takeover-dialog-title">会话已在其他设备继续</h3><button type="button" class="icon-btn" data-takeover-dismiss aria-label="关闭">×</button></div><div class="modal-body dialog-body"><p class="dialog-message" data-takeover-message></p><div class="takeover-session-list" data-takeover-list></div><p class="dialog-note">远端终端和正在运行的命令不会结束，但本页面已停止收发数据。在本设备继续会断开另一台设备上的对应标签。</p></div><div class="modal-actions"><button type="button" class="secondary" data-takeover-dismiss>保持断开</button><button type="button" class="primary" data-takeover-resume>在本设备继续</button></div></div>';
      backdrop.querySelectorAll('[data-takeover-dismiss]').forEach((button) => button.onclick = dismissSessionTakeoverDialog);
      $('[data-takeover-resume]', backdrop).onclick = () => { const affected = currentTakenOverTabs(); dismissSessionTakeoverDialog(); affected.forEach(reconnectTab); };
      document.body.appendChild(backdrop); $('[data-takeover-dismiss]', backdrop)?.focus();
    }
    refreshSessionTakeoverDialog();
  }
  function scheduleReconnect(tab, immediate = false) { if (tab.manualClose || tab.reconnectTimer || !state.tabs.has(tab.id)) return; const delay = immediate ? 0 : Math.min(15000, 1000 * (2 ** Math.min(tab.reconnectAttempt++, 4))); tab.reconnectTimer = setTimeout(() => { tab.reconnectTimer = null; connectTab(tab); }, delay); }
  // Codex CLI prints "Goodbye!" when the user types /exit (or the shell ends with
// exit/EOF). Watch for it so we can clear this tab's approval history and drop
// the reconnect loop.
const CODEX_GOODBYE_PATTERN = /Goodbye!\s*$/i;
let terminalExitDetectedAt = new Map(); // tabId -> timestamp
function detectTerminalExit(tab) {
  if (tab.kind !== 'ssh') return;
  const terminal = tab?.terminal;
  if (!terminal) return;
  try {
    const buffer = terminal.buffer?.active;
    if (!buffer) return;
    const end = buffer.length;
    const start = Math.max(0, end - 8);
    let tail = '';
    for (let i = start; i < end; i += 1) {
      const line = buffer.getLine(i);
      if (!line) continue;
      tail += line.translateToString(true) + '\n';
    }
    if (!CODEX_GOODBYE_PATTERN.test(tail)) return;
    const last = terminalExitDetectedAt.get(tab.id) || 0;
    if (Date.now() - last < 10_000) return;
    terminalExitDetectedAt.set(tab.id, Date.now());
    // Only clear when the user initiated the exit; a server-side crash or
    // network drop will show a reconnect banner and the user can retry.
    if (tab.connected) void clearTabApprovalHistory(tab).then(() => {
      closeTab(tab.id);
    });
  } catch { /* buffer access is best-effort */ }
}
// Empties this tab's approval history on the server side and locally.
// Called when the tab is closed manually or its shell exits.
async function clearTabApprovalHistory(tab) {
  if (tab?.kind !== 'ssh') return;
  // Stop the auto-approval loop so the server does not keep evaluating prompts.
  if (tab.ws && tab.ws.readyState === WebSocket.OPEN && tab.approvalEnabled) {
    try { tab.ws.send(JSON.stringify({ type: 'approval', action: 'disable' })); } catch { /* socket may be closing */ }
  }
  tab.approvalEnabled = false; tab.approvalStatus = ''; tab.approvalTone = 'info';
  tab.approvalStopReason = ''; tab.approvalStopReasonMessage = ''; tab.approvalNotice = '';
  try {
    await api('/api/approval-history/clear', { method: 'POST', body: JSON.stringify({ sessionId: tab.id, sessionName: tab.name || '' }) });
  } catch (e) {
    // Best-effort; the tab may already be gone.
  }
}
function closeTab(tabId) { const tab = state.tabs.get(tabId); if (!tab) return; tab.manualClose = true; if (tab.kind === 'vnc') disposeVnc(tab); else void clearTabApprovalHistory(tab); tab.upload?.currentXhr?.abort(); if (tab.reconnectTimer) clearTimeout(tab.reconnectTimer); if (tab.attentionTimer) clearTimeout(tab.attentionTimer); if (tab.approvalStatusTimer) clearTimeout(tab.approvalStatusTimer); resolveCwdRequests(tab); tab.reconnectTimer = null; tab.attentionTimer = null; tab.approvalStatusTimer = null; if (tab.ws && tab.ws.readyState <= WebSocket.OPEN) { tab.ws.send(JSON.stringify({ type:'close' })); tab.ws.close(); } tab.view?.remove(); state.tabs.delete(tabId); state.takenOverTabs.delete(tabId); refreshSessionTakeoverDialog(); const next = state.tabs.keys().next().value; state.activeTab = next || null; persistSessions(); renderTabs(); if (next) activateTab(next); else $('#content').innerHTML = '<div class="welcome"><div class="welcome-card"><h2>选择服务器开始</h2><p>你的会话会显示在这里。</p></div></div>'; renderServers(); }
  function restoreTerminalSnapshot(tab, message, isCurrentSocket) {
    const terminal = tab.terminal; if (!terminal) return;
    const generation = tab.restoreGeneration = (tab.restoreGeneration || 0) + 1;
    tab.restoring = true; tab.lastSeq = Number(message.seq || 0);
    if (terminal.element) terminal.element.style.visibility = 'hidden';
    // Parse the reset and the complete frame in one ordered write. A direct
    // reset() could race with writes still queued from the previous connection.
    const data = Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0));
    const frame = new Uint8Array(data.length + 2); frame.set([0x1b, 0x63]); frame.set(data, 2);
    terminal.resize(message.cols, message.rows);
    terminal.write(frame, () => {
      if (!isCurrentSocket() || tab.restoreGeneration !== generation || tab.manualClose) return;
      tab.restoring = false;
      if (tab.id === state.activeTab) { fitTerminal(tab); sendResize(tab); }
      terminal.refresh(0, terminal.rows - 1);
      if (terminal.element) terminal.element.style.visibility = '';
      scrollTerminalToBottom(tab, true); trackTabOutput(tab, true);
    });
  }
  function connectTab(tab) {
    if (tab.manualClose || tab.reconnectBlocked || (tab.ws && tab.ws.readyState <= WebSocket.OPEN)) return;
    const server = state.servers.find((item) => item.id === tab.serverId); if (!server) return;
    if (tab.kind === 'vnc') { if (!tab.view || !tab.vnc) createTabView(tab); return connectVncTab(tab, server); }
    if (!tab.view) createTabView(tab);
    watchTerminalSelection(tab);
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'; const ws = new WebSocket(`${protocol}://${location.host}/ws`); const generation = ++tab.wsGeneration; tab.ws = ws;
    const isCurrentSocket = () => tab.ws === ws && tab.wsGeneration === generation;
    ws.onopen = () => { if (!isCurrentSocket()) return ws.close(); tab.reconnectAttempt = 0; if (tab.id === state.activeTab) fitTerminal(tab); const dimensions = tab.terminal ? { cols: tab.terminal.cols, rows: tab.terminal.rows } : {}; ws.send(JSON.stringify({ type:'connect', serverId:tab.serverId, sessionId:tab.id, lastSeq:tab.lastSeq, initialCwd:tab.initialCwd || '', tabName:tab.name || '', tabId:tab.id, ...dimensions })); };
    // xterm follows the live tail on its own while the reader is not scrolling, so forcing the viewport to the bottom on every output frame would cancel an in-flight upward scroll and hide the newest frame (a finished Codex session, a fresh prompt) until the reader hits F5.  Re-assert it next frame, guarded by the user-scroll flag.
    ws.onmessage = (event) => { if (!isCurrentSocket()) return; let message; try { message = JSON.parse(event.data); } catch { return; } if (message.type === 'connected') { if (!message.resumed && tab.lastSeq) tab.lastSeq = 0; tab.reconnectBlocked = false; state.takenOverTabs.delete(tab.id); refreshSessionTakeoverDialog(); tab.connected = true; if (!message.resumed) { if (tab.attentionTimer) clearTimeout(tab.attentionTimer); tab.attentionTimer = null; tab.taskWasWorking = false; tab.lastCompletionKey = ''; } tab.reconnectAttempt = 0; renderTabs(); refreshTabCwd(tab); if (tab.approvalEnabled) requestAnimationFrame(() => enableTabApproval(tab, { silent:true })); } else if (message.type === 'snapshot') { restoreTerminalSnapshot(tab, message, isCurrentSocket); } else if (message.type === 'output') { if (message.seq && message.seq <= tab.lastSeq) return; tab.lastSeq = Math.max(tab.lastSeq, Number(message.seq || 0)); const bytes = Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0)); tab.terminal?.write(bytes, () => { if (!isCurrentSocket() || tab.restoring) return; trackTabOutput(tab); detectTerminalExit(tab); requestAnimationFrame(() => { refreshTerminalTail(tab); }); }); } else if (message.type === 'cwd') { const pending = tab.cwdRequests?.get(message.requestId); if (!pending) return; clearTimeout(pending.timer); tab.cwdRequests.delete(message.requestId); const directory = String(message.path || ''); if (directory.startsWith('/')) { tab.currentDirectory = directory; persistSessions(); updateTabNames(); } pending.resolve(directory || tab.currentDirectory || tab.initialCwd || ''); } else if (message.type === 'approval') { handleApprovalMessage(tab, message); } else if (message.type === 'error') { tab.connected = false; tab.terminal?.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`); notify(message.message, 'error'); renderTabs(); } else if (message.type === 'closed') { tab.connected = false; if (message.reason === 'remote-closed') { closeTab(tab.id); return; } renderTabs(); } };
    ws.onclose = (event) => { if (!isCurrentSocket()) return; tab.ws = null; tab.connected = false; tab.restoring = false; if (tab.terminal?.element) tab.terminal.element.style.visibility = ''; resolveCwdRequests(tab, tab.currentDirectory || tab.initialCwd || ''); renderTabs(); if (event.code === 4401) { clearClientSession(); return; } if (event.code === 4000) { tab.reconnectBlocked = true; showSessionTakeoverDialog(tab); return; } if (!tab.manualClose) scheduleReconnect(tab, event.code === 4402); };
    ws.onerror = () => { if (isCurrentSocket() && !tab.manualClose && tab.connected) notify('连接暂时中断，远端会话将保留并自动重连', 'error'); };
  }
  // 惰性桥接通道：让 RFB 构造函数拿到一个"看似合法"的通道对象（属性代理到内部引用），
  // WebSocket onopen 后由 attach() 注入真实通道，noVNC 的 Websock.attach 随即接管。
  const VNC_LAZY_CHANNEL_PROPS = ['send', 'close', 'binaryType', 'onerror', 'onmessage', 'onopen', 'onclose', 'protocol', 'readyState'];
  function createVncLazyChannel(tab) {
    const holder = { ws: null, armed: false };
    const channel = {};
    for (const prop of VNC_LAZY_CHANNEL_PROPS) {
      Object.defineProperty(channel, prop, {
        get: () => {
          if (holder.ws) {
            // send/close 是浏览器品牌化方法，裸返回方法引用后以惰性通道
            // 为 this 调用会抛 Illegal invocation；必须绑定到真实 ws。
            if (prop === 'send' || prop === 'close') return holder.ws[prop].bind(holder.ws);
            return holder.ws[prop];
          }
          if (!holder.armed) {
            // 未就绪：让 new RFB 的 _connect 把通道视作"正在连接"的空占位，
            // 既不 attach 到 Websock（避免 _socketOpen→_fail 进入永久
            // disconnected），也不暴露 closed 状态（避免抛 "already closed"）。
            if (prop === 'readyState') return WebSocket.CONNECTING;
            if (prop === 'send' || prop === 'close') return () => {};
          }
          if (prop === 'readyState') return WebSocket.CONNECTING;
          if (prop === 'send' || prop === 'close') return () => {};
          return null;
        },
        set: (value) => { if (holder.ws) holder.ws[prop] = value; },
        enumerable: true,
        configurable: true
      });
    }
    channel._arm = () => { holder.armed = true; };
    channel.attach = (ws) => { holder.ws = ws; };
    channel.onclose = null;
    channel._forwardClose = (event) => {
      const ws = holder.ws;
      if (!ws || ws.onclose === channel.onclose) return;
      try { channel.onclose?.(event); } catch { /* ignore */ }
    };
    channel._vncLazy = true;
    return channel;
  }
  function disposeVnc(tab) {
    const vnc = tab?.vnc;
    if (!vnc) return;
    tab.vnc = null;
    try { vnc.rfb?.disconnect(); } catch { /* already closed */ }
  }
  function createVncTabView(tab, server) {
    // 注意：不能在这里 disposeVnc。disposeVnc 只调 rfb.disconnect()，
    // 而 _socketClose 只在真实 ws 的 close 事件到达后才解绑 _sock 的
    // close 监听并清空 _rawChannel；提前 dispose 会让旧 RFB 残留
    // _rawChannel 引用，下一轮惰性通道复用时 Websock.attach 校验
    // 属性枚举失败，_websocket 停留在旧惰性对象，flush 触发
    // "Illegal invocation"。视图重建只需替换 DOM，旧 RFB 的 canvas
    // 随旧 view 一起被移除即可。
    const view = document.createElement('div');
    view.className = tab.id === state.activeTab ? 'session session-vnc' : 'session session-vnc hidden';
    view.dataset.sessionId = tab.id;
    view.innerHTML = `<div class="vnc-wrap"><div class="vnc-stage"></div></div><div class="sftp-panel hidden">${sftpPanelMarkup()}</div><div class="session-bar"><span>${ICONS.desktop}${escapeHtml(server.name)} · Windows 远程桌面</span><span class="grow"></span><button class="ghost-btn session-action" data-sftp title="打开 SFTP 文件传输">${ICONS.sftp}<span>SFTP</span></button><button class="ghost-btn session-action" data-vnc-fs title="全屏"><span>全屏</span></button><button class="ghost-btn session-action" data-vnc-reconnect title="重新连接远程桌面">${ICONS.reconnect}<span>重新连接</span></button></div>`;
    $('#content').appendChild(view);
    tab.view = view;
    const stage = $('.vnc-stage', view);
    // 每一轮都新建惰性通道 + RFB：noVNC 的 'disconnected' 状态不可逆
    // （_updateConnectionState 拒绝从 disconnected 转出），一旦某轮握手失败
    // 进入 disconnected，复用旧对象会让后续所有字节被静默丢弃。
    // 惰性通道构造时未 arm，new RFB 只是把它当占位，不会提前触发 _fail。
    const lazyChannel = createVncLazyChannel(tab);
    tab._lazyChannel = lazyChannel;
    const rfb = new RFB(stage, lazyChannel, { shared: false });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    // Windows 端 TightVNC/UltraVNC 可能下发全透明光标（不画光标），
    // 开启 showDotCursor 作为兜底：透明光标时显示一个小圆点，避免鼠标"消失"。
    rfb.showDotCursor = true;
    const vnc = { rfb };
    tab.vnc = vnc;
    const wireEvents = () => {
      rfb.addEventListener('connect', () => { tab.connected = true; renderTabs(); });
      rfb.addEventListener('disconnect', (event) => {
        tab.connected = false;
        renderTabs();
        // 重连走 reconnectTab：先 disposeVnc 再重建 view/RFB/惰性通道，
        // 不复用已 disconnected 的旧对象（其状态机不可逆）。
        if (!tab.manualClose && tab.reconnectAttempt < 6) scheduleReconnect(tab);
        const detail = event?.detail || {};
        if (detail.clean || tab.manualClose) return;
        const initState = rfb._rfbInitState || '';
        const scheme = rfb._rfbAuthScheme;
        let message = '远程桌面连接失败';
        if (initState === 'Authentication' && scheme === 16) {
          message = 'VNC 安全协商失败：该 TightVNC 服务端仅支持 DES 等 noVNC 未实现的认证方式。请在 Windows 端 VNC 服务设置中将 Security 改为 "None" 或 "VNCAuth" 后重试。';
        } else if (initState === 'Security' || initState === 'Authentication') {
          message = 'VNC 安全协商失败，请检查 Windows 端 VNC 服务的认证设置。';
        }
        notify(message, 'error');
      });
    };
    wireEvents();
    view.querySelectorAll('[data-vnc-reconnect]').forEach((button) => { button.onclick = () => reconnectTab(tab); });
    view.querySelectorAll('[data-vnc-fs]').forEach((button) => { button.onclick = () => { const target = view.closest('.main') || view; if (document.fullscreenElement) document.exitFullscreen?.(); else target.requestFullscreen?.(); }; });
    // Windows hosts have no SSH terminal, so the SFTP panel starts at the
    // configured Windows root (shown as "/" in the panel).
    const sftpReady = () => {
      if (server.sftpBridgeEnabled) return Promise.resolve('/');
      // No SFTP bridge configured: show a friendly hint instead of a broken
      // directory listing, and keep the panel open so the user can fix config.
      const panel = $('.sftp-panel', view);
      if (panel) { $('[data-files]', panel).innerHTML = '<div class="empty danger">尚未启用 SFTP 文件传输。请在“编辑服务器”里勾选“启用 SFTP 文件传输”，并填写 Windows 上 SFTP 服务的端口、根目录与凭据。</div>'; }
      notify('该 Windows 主机尚未启用 SFTP 文件传输', 'error');
      return Promise.resolve(null);
    };
    wireSftpPanel(tab, view, sftpReady);
    return view;
  }

  let rfbLoadReported = false;
  const reportRfbLoadError = (error) => {
    if (rfbLoadReported) return;
    rfbLoadReported = true;
    console.error('noVNC 模块加载失败:', error || 'unknown');
    const cause = (error && error.message) ? error.message : String(error || '未知错误');
    notify(`远程桌面组件加载失败：${cause}（请刷新页面；若刚发布过新版本，请强制刷新 Ctrl+Shift+R / ⌘+Shift+R，仍未恢复请查看浏览器控制台）`, 'error');
  };
  window.addEventListener('nexterm-rfb-load-failed', (event) => {
    const message = event?.detail?.message || 'RFB 构造函数不可用（模块可能未加载）';
    reportRfbLoadError(new Error(message));
  });
  function ensureRfbReady(tab, server, callback) {
    if (typeof window.RFB === 'function') return callback();
    const start = Date.now();
    const timer = setInterval(() => {
      if (typeof window.RFB === 'function') { clearInterval(timer); callback(); }
      else if (tab.manualClose || !state.tabs.has(tab.id) || Date.now() - start > 10000) { clearInterval(timer); reportRfbLoadError(new Error('noVNC 模块在 10 秒内未就绪（可能被旧版缓存或网络中断阻塞）')); }
    }, 100);
  }
  function connectVncTab(tab, server) {
    ensureRfbReady(tab, server, () => {
    if (!tab.view || !tab.vnc) createTabView(tab);
    const vnc = tab.vnc;
    if (!vnc || !vnc.rfb) return;
    const rfb = vnc.rfb;
    // 清理上一轮未收尾的 WebSocket：它若处于 CLOSING/CLOSED，惰性通道的
    // readyState 会暴露为 closed，导致 new RFB 的 _connect 抛出
    // "Cannot use already closed WebSocket/RTCDataChannel"。
    const staleSocket = tab.ws;
    if (staleSocket) {
      staleSocket.onopen = null; staleSocket.onmessage = null; staleSocket.onclose = null; staleSocket.onerror = null;
      try { staleSocket.close(); } catch { /* already closed */ }
      tab.ws = null;
    }
    const generation = ++tab.wsGeneration;
    const isCurrent = () => tab.wsGeneration === generation && !tab.manualClose;
    const attachSocket = (ws) => {
      if (!isCurrent()) { try { ws.close(); } catch { /* ignore */ } return; }
      const handle = (raw) => {
        if (!isCurrent()) return;
        // 诊断：跟踪 RFB 状态机变化，定位握手卡点
        const r = rfb;
        const key = (r._rfbConnectionState || '') + '|' + (r._rfbInitState || '');
        if (handle._lastState !== key) {
          handle._lastState = key;
          const disp = r._display ? (r._display.width + 'x' + r._display.height) : '?';
          console.info('[nexterm-vnc] RFB 状态:', key, 'display:', disp);
        }
        if (typeof raw !== 'string' || raw.length > 512 * 1024) return;
        let message; try { message = JSON.parse(raw); } catch { return; }
        if (!message || message.type !== 'vnc-data' || typeof message.data !== 'string') return;
        let bytes;
        try { bytes = Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0)); } catch { return; }
        const sock = rfb._sock;
        // 守卫：Websock 未初始化（_sQ 未分配）说明该 RFB 尚未真正接管
        // 通道（惰性通道未 arm 就被访问），直接忽略本帧。
        // 注意：握手期间 noVNC 会持续向发送队列写入协议帧（版本/安全/
        // 认证应答），_sQlen 常态非空，不能作为废弃判据。
        if (!sock || sock.readyState !== 'open' || !sock._sQ) {
          handle._guardSkips = (handle._guardSkips || 0) + 1;
          if (handle._guardSkips <= 3) console.warn('[nexterm-vnc] 守卫拦截 vnc-data（sock=' + Boolean(sock) + ' rs=' + (sock && sock.readyState) + ' sQ=' + Boolean(sock && sock._sQ) + '）');
          return;
        }
        handle._pushes = (handle._pushes || 0) + 1;
        try {
          // 通过 noVNC 自己的接收入口入队：它会处理队列压缩/扩容并触发
          // message handler。直接递增 _rQlen 会绕过这些逻辑，长时间运行
          // 后接收缓冲区会持续膨胀。
          sock._recvMessage({ data: bytes.buffer });
          if (handle._pushes <= 5) console.info('[nexterm-vnc] 推入 rQ #'+handle._pushes+' ('+bytes.length+'B) 首字节='+(bytes[0]||0)+' 状态='+rfb._rfbConnectionState+'|'+rfb._rfbInitState);
        } catch (pushError) {
          console.error('[nexterm-vnc] 推入 RFB 字节失败:', pushError,
            'rfbState=' + rfb._rfbConnectionState,
            'sockRS=' + sock.readyState,
            'rQlen=' + sock._rQlen);
        }
        // 诊断：记录 noVNC 发出的字节（拦截 sQpushString）
        if (!handle._patchedSQ) {
          handle._patchedSQ = true;
          const origPushString = sock.sQpushString.bind(sock);
          sock.sQpushString = (str) => {
            if (handle._sends <= 5) console.info('[nexterm-vnc] sQpushString: '+JSON.stringify(str)+' ('+str.length+'B) 状态='+rfb._rfbConnectionState+'|'+rfb._rfbInitState);
            handle._sends = (handle._sends || 0) + 1;
            return origPushString(str);
          };
          const origFlush = sock.flush.bind(sock);
          sock.flush = () => {
            if (sock._sQlen > 0 && sock.readyState === 'open') {
              const data = new Uint8Array(sock._sQ.buffer, 0, sock._sQlen);
              if (handle._flushes <= 5) console.info('[nexterm-vnc] flush 发送 '+data.length+'B: '+Array.from(data.slice(0,20)).map(b=>b.toString(16)).join(' ')+' 状态='+rfb._rfbConnectionState+'|'+rfb._rfbInitState);
              handle._flushes = (handle._flushes || 0) + 1;
            }
            return origFlush();
          };
        }
      };
      ws.binaryType = 'arraybuffer';
      let onWsClose;
      ws.onopen = () => {
        if (!isCurrent()) return;
        tab.reconnectAttempt = 0;
        // 此刻才把真实 ws 注入惰性通道：new RFB 构造时通道尚未 arm，
        // _connect 只是把它当占位、未 attach 到 Websock，因此 RFB 状态仍停在
        // connecting。
        tab._lazyChannel?._arm?.();
        tab._lazyChannel?.attach(ws);
        // 先通知服务端建立 VNC 会话，再推进 RFB 状态机。
        // _socketOpen → _negotiateProtocolVersion 会发客户端版本帧，
        // 若此时服务端尚未建立 VNC 会话，版本帧发到空管道会丢失。
        ws.send(JSON.stringify({ type: 'connect', kind: 'vnc', serverId: tab.serverId, sessionId: tab.id, tabName: tab.name || '' }));
        if (rfb._rfbConnectionState === 'connecting') {
          try { RFB.prototype._socketOpen.call(rfb); }
          catch (openError) { console.error('VNC 通道接管失败:', openError); notify('远程桌面通道初始化失败，请重新连接', 'error'); try { ws.close(); } catch { /* ignore */ } }
        }
      };
      ws.onmessage = (event) => {
        handle(String(event.data));
      };
      onWsClose = (event) => {
        if (!isCurrent()) return;
        tab.connected = false;
        renderTabs();
        if (event.code === 4401) { clearClientSession(); return; }
        if (event.code === 4000) { tab.reconnectBlocked = true; showSessionTakeoverDialog(tab); return; }
        if (!tab.manualClose) scheduleReconnect(tab, event.code === 4402);
      };
      ws.onclose = (event) => {
        tab._lazyChannel?._forwardClose?.(event);
        onWsClose(event);
      };
      ws.onerror = () => { /* onclose handles reconnection */ };
    };
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${location.host}/ws`);
      tab.ws = ws;
      attachSocket(ws);
    });
  }

  function sendResize(tab) { if (!tab.restoring && tab.ws?.readyState === WebSocket.OPEN && tab.terminal) tab.ws.send(JSON.stringify({ type:'resize', cols:tab.terminal.cols, rows:tab.terminal.rows })); }
  function createTabView(tab) {
    const server = state.servers.find((item) => item.id === tab.serverId);
    if (tab.kind === 'vnc') return createVncTabView(tab, server);
    const view = document.createElement('div'); view.className = tab.id === state.activeTab ? 'session' : 'session hidden'; view.dataset.sessionId = tab.id; view.innerHTML = `<div class="terminal-wrap"><div class="terminal"></div></div><div class="keybar"><button data-key="\u001b">ESC</button><button data-key="\t">TAB</button><button data-key="\u0003">CTRL+C</button><button data-key="\u0004">CTRL+D</button><button data-key="\u0009">⇥</button><button data-key="\u001b[A">↑</button><button data-key="\u001b[B">↓</button><button data-key="\u001b[D">←</button><button data-key="\u001b[C">→</button></div><div class="session-bar"><span>${escapeHtml(server.host)} · ${escapeHtml(server.username)}</span><span class="approval-badge hidden" role="button" tabindex="0" data-approval-history title="点击查看自动审批记录" aria-label="查看自动审批记录"></span><button class="approval-history-link hidden" data-approval-history title="查看自动审批记录（点击展开）" aria-label="查看自动审批记录">记录</button><span class="grow"></span><button class="ghost-btn session-action" data-sftp title="打开 SFTP 文件管理">${ICONS.sftp}<span>SFTP</span></button><button class="ghost-btn session-action" data-reconnect title="重新连接 SSH 会话">${ICONS.reconnect}<span>重新连接</span></button></div><div class="sftp-panel hidden"><div class="sftp-toolbar"><button class="ghost-btn" data-up>←</button><input class="path-input" value="/" /><button class="ghost-btn" data-refresh>刷新</button><button class="ghost-btn" data-mkdir>新建目录</button><label class="ghost-btn" style="cursor:pointer">上传<input type="file" data-upload multiple hidden /></label><label class="ghost-btn" style="cursor:pointer">上传文件夹<input type="file" data-upload-directory webkitdirectory directory multiple hidden /></label><button class="ghost-btn" type="button" data-sftp-close title="关闭文件面板">关闭</button></div><div class="upload-status hidden" data-upload-status role="status" aria-live="polite"><div class="upload-meta"><span data-upload-label>准备上传</span><span class="upload-percent" data-upload-percent>0%</span><button class="secondary danger" type="button" data-upload-cancel>取消上传</button></div><progress data-upload-progress max="100" value="0"></progress><div class="upload-detail" data-upload-detail></div></div><div class="file-list"><div class="file-row head"><span>名称</span><span>大小</span><span>修改时间</span><span></span></div><div data-files></div></div></div>`;
    $('#content').appendChild(view); tab.view = view; const terminalElement = $('.terminal', view); tab.terminal = window.Terminal ? new window.Terminal({ cursorBlink:true, scrollback:10000, fontSize:Math.max(11, Math.min(24, Number(state.user?.preferences?.terminalFontSize) || 13)), fontFamily:'"SFMono-Regular",Consolas,"Liberation Mono","Noto Sans Mono CJK SC",monospace', rescaleOverlappingGlyphs:true, rightClickSelectsWord:false, theme:{ background:'#0b1119', foreground:'#d8e4f0', cursor:'#66e3b4', selectionBackground:'#27536a' }, convertEol:true }) : null; if (tab.terminal) { tab.fit = window.FitAddon ? new window.FitAddon.FitAddon() : null; tab.fit && tab.terminal.loadAddon(tab.fit); tab.terminal.open(terminalElement); tab.terminal.attachCustomKeyEventHandler((event) => { if (event.type !== 'keydown') return true; const key = String(event.key || '').toLowerCase(); const modifier = event.ctrlKey || event.metaKey; const plainCopy = (event.ctrlKey && event.shiftKey || event.metaKey && !event.ctrlKey) && key === 'c'; const copySelection = modifier && key === 'c' && !event.shiftKey && !event.altKey && !!String(tab.terminal?.getSelection?.() || ''); if (plainCopy || copySelection) { event.preventDefault(); event.stopPropagation(); void copyTerminalSelection(tab); return false; } if (modifier && key === 'v' && !event.altKey) { event.preventDefault(); event.stopPropagation(); void (async () => { let clipboardText = ''; try { if (navigator.clipboard?.readText) clipboardText = await navigator.clipboard.readText(); } catch { clipboardText = ''; } if (!clipboardText) { notify('无法读取剪贴板，请使用鼠标右键粘贴', 'error'); return; } if (hasMultipleLines(clipboardText) && !(await confirmMultilinePaste(clipboardText))) return; pasteIntoTerminal(tab, clipboardText); })(); return false; } return true; }); if (tab.id === state.activeTab) requestAnimationFrame(() => requestAnimationFrame(() => { if (!view.classList.contains('hidden')) { fitTerminal(tab); sendResize(tab); scrollTerminalToBottom(tab, true); } })); tab.terminal.onData((data) => { if (tab.restoring) return; if (terminalUserScrolling(tab)) return; tab.followOutput = true; if (tab.ws?.readyState === WebSocket.OPEN) tab.ws.send(JSON.stringify({ type:'input', data:btoa(unescape(encodeURIComponent(data))) })); if (!terminalAtBottom(tab)) requestAnimationFrame(() => { if (tab.followOutput !== false && !terminalUserScrolling(tab)) { tab.terminal?.scrollToBottom?.(); tab.terminal?.refresh(0, Math.max(0, tab.terminal.rows - 1)); } }); });
      // Scrolling the scrollback has to win against the live tail, otherwise the
      // view snaps back down on the next output chunk and upward wheel/touch
      // motion looks completely dead.  That fight is decided here:
      // - xterm only marks the buffer as user-scrolled while the viewport sits
      //   above the live tail, so isUserScrolling is the authoritative signal
      //   that the reader is in control.  Every programmatic follow path checks
      //   it and stands down, which keeps Magic Mouse momentum flicks alive.
      // - The follow flag is re-derived from the live viewport instead of from
      //   wheel-event timing, because macOS momentum phases, coalesced events
      //   and deltaMode differences make delta-based heuristics unreliable.
      // - xterm hard-stops a negative scroll at the top of the scrollback.
      //   Magic Mouse momentum keeps firing after that stop, and the leftover
      //   events clamp the viewport back to the live tail - the "cannot scroll
      //   up on a Magic Mouse" symptom.  A capture listener absorbs momentum
      //   that has no scrollback left to consume and holds the position until
      //   the flick is over, so the next frame cannot drag the view back.
      // The whole block must stay inside the "if (tab.terminal) {" that opens on
      // the appendChild line: a stray brace there silently turned all of this
      // into dead code and upward scrolling looked completely dead again.
      const scrollState = { holdUntil:0, momentumPaused:false, pendingMomentum:0, momentumFrame:null };
      const scrollHistoryDepth = () => {
        const buffer = tab.terminal?.buffer?.active;
        if (!buffer) return 0;
        return Math.max(0, Number(buffer.ybase) - Number(buffer.viewportY));
      };
      const scheduleMomentum = () => {
        if (scrollState.momentumFrame) return;
        scrollState.momentumFrame = requestAnimationFrame(() => {
          scrollState.momentumFrame = null;
          if (!scrollState.momentumPaused) { scrollState.pendingMomentum = 0; return; }
          const amount = Math.round(scrollState.pendingMomentum / 6);
          if (amount) { tab.terminal?.scrollLines?.(-amount); scrollState.pendingMomentum -= amount * 6; }
          if (scrollState.pendingMomentum && scrollHistoryDepth() > 0) { scheduleMomentum(); return; }
          // The whole flick cannot be shown: keep the view where it is instead
          // of letting xterm re-clamp it to the tail on the next frame.
          if (scrollState.pendingMomentum && terminalAtBottom(tab)) tab.terminal?.scrollLines?.(-1);
          scrollState.pendingMomentum = 0;
          scrollState.holdUntil = Date.now() + 900;
        });
      };
      const syncTerminalFollowFromViewport = () => {
        if (Date.now() < scrollState.holdUntil) return;
        const following = terminalAtBottom(tab);
        tab.followOutput = following;
        if (following && !tab.restoring && tab.id === state.activeTab && !terminalUserScrolling(tab)) tab.terminal?.scrollToBottom?.();
      };
      const attachViewportFollow = () => {
        const viewport = terminalElement.querySelector('.xterm-viewport'); if (!viewport || viewport._nextermFollowWired) return;
        viewport._nextermFollowWired = true;
        // xterm's own wheel handler lives on the .xterm element and bubbles up, so
        // a capture-phase listener on the wrapper runs first.  That is the only
        // reliable place to drop followOutput before xterm clamps the viewport
        // back to the live tail.
        viewport.addEventListener('scroll', syncTerminalFollowFromViewport, { passive:true });
        terminalElement.addEventListener('wheel', (event) => {
          if (!event.deltaY) return;
          // Scrolling back down to the live tail re-arms follow; anything else is
          // the reader taking control. macOS momentum keeps firing after the
          // gesture ends, so follow must not be re-derived from delta signs.
          tab.followOutput = event.deltaY > 0 && terminalAtBottom(tab);
          if (event.deltaY >= 0 || !terminalUsesMouseReporting(tab)) return;
          // Terminal mouse reporting (Codex, htop, less) owns the viewport, so
          // native scrolling stays the normal path there.
          if (scrollState.momentumPaused) { scrollState.pendingMomentum += event.deltaY; scheduleMomentum(); return; }
          if (scrollHistoryDepth() <= 0) {
            scrollState.momentumPaused = true;
            scrollState.pendingMomentum = event.deltaY;
            event.preventDefault();
            event.stopImmediatePropagation();
            scheduleMomentum();
          }
        }, { capture:true, passive:false });
      };
      attachViewportFollow();
      tab.terminal.onScroll(() => { attachViewportFollow(); syncTerminalFollowFromViewport(); });
      new MutationObserver(attachViewportFollow).observe(terminalElement, { childList:true, subtree:true });
      terminalElement.addEventListener('paste', async (event) => { const text = event.clipboardData?.getData('text/plain') || ''; if (!hasMultipleLines(text)) return; event.preventDefault(); event.stopImmediatePropagation(); if (await confirmMultilinePaste(text)) pasteIntoTerminal(tab, text); }, true); const resizeObserver = new ResizeObserver(() => { if (tab.id !== state.activeTab || view.classList.contains('hidden') || !terminalElement.offsetWidth || !terminalElement.offsetHeight) return; scheduleTerminalFit(tab); }); resizeObserver.observe(terminalElement); terminalElement.parentElement && resizeObserver.observe(terminalElement.parentElement); if (document.fonts?.ready) document.fonts.ready.then(() => { if (tab.id === state.activeTab) scheduleTerminalFit(tab); }); }
    view.querySelectorAll('[data-key]').forEach((button) => button.onclick = () => { if (tab.restoring) return; const value = button.dataset.key; tab.terminal?.focus(); if (tab.ws?.readyState === WebSocket.OPEN) tab.ws.send(JSON.stringify({ type:'input', data:btoa(unescape(encodeURIComponent(value))) })); });
    const toggleSftp = async (open = !tab.sftp) => {
      tab.sftp = open;
      const panel = $('.sftp-panel', view);
      panel.classList.toggle('hidden', !tab.sftp);
      if (!tab.sftp) return;
      $('[data-files]', panel).innerHTML = '<div class="empty">正在定位终端当前目录…</div>';
      const currentDirectory = await requestTabCwd(tab);
      if (!tab.sftp || !state.tabs.has(tab.id)) return;
      loadFiles(tab, currentDirectory || tab.currentDirectory || tab.initialCwd || $('.path-input', panel).value || '/');
    }; tab.openSftp = () => toggleSftp(true);
    $('[data-approval-history]', view).onclick = () => openApprovalHistoryModal();
    const badge = $('.approval-badge', view);
    if (badge) badge.onclick = () => openApprovalHistoryModal();
    $('[data-sftp]', view).onclick = () => toggleSftp(); $('[data-sftp-close]', view).onclick = () => toggleSftp(false); $('[data-reconnect]', view).onclick = () => reconnectTab(tab); $('[data-refresh]', view).onclick = () => loadFiles(tab, $('.path-input', view).value); $('[data-up]', view).onclick = () => { const current = sftpPath($('.path-input', view).value); loadFiles(tab, current === '/' ? '/' : current.split('/').slice(0,-1).join('/') || '/'); }; $('[data-mkdir]', view).onclick = async () => { const name = prompt('目录名称'); if (!name) return; try { await api(`/api/servers/${tab.serverId}/files/mkdir`, { method:'POST', body:JSON.stringify({ path:$('.path-input', view).value, name }) }); loadFiles(tab, $('.path-input', view).value); } catch (e) { notify(e.message, 'error'); } }; const handleUploadSelection = (event) => { const input = event.currentTarget; const files = [...input.files]; if (!files.length) return; startUploads(tab, files, view, input); }; $('[data-upload]', view).onchange = handleUploadSelection; $('[data-upload-directory]', view).onchange = handleUploadSelection;
  }
  function uploadErrorMessage(xhr) {
    try { const body = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText || '{}'); return body?.error || '上传失败'; } catch { return '上传失败'; }
  }
  function setUploadStatus(view, { label, percent, detail, active = true, cancellable = false }) {
    const status = $('[data-upload-status]', view); if (!status) return;
    status.classList.toggle('hidden', !active); if (!active) return;
    $('[data-upload-label]', status).textContent = label; $('[data-upload-percent]', status).textContent = `${Math.max(0, Math.min(100, percent))}%`;
    $('[data-upload-progress]', status).value = Math.max(0, Math.min(100, percent)); $('[data-upload-detail]', status).textContent = detail || '';
    const cancel = $('[data-upload-cancel]', status); if (cancel) cancel.disabled = !cancellable;
  }
  function finishUpload(tab, view, input, message, type = 'info') {
    if (view.uploadHideTimer) clearTimeout(view.uploadHideTimer);
    const cancelled = type === 'cancelled';
    setUploadStatus(view, { label: message, percent: type === 'error' || cancelled ? 0 : 100, detail: type === 'error' ? '请检查连接或重试。' : cancelled ? '本次上传未写入完整文件。' : '文件已写入远端目录。' });
    if (input) input.value = '';
    tab.upload = null;
    view.uploadHideTimer = setTimeout(() => setUploadStatus(view, { active: false }), 2600);
    notify(message, type);
  }
  function startUploads(tab, files, view, input) {
    if (tab.upload?.active) { notify('已有文件正在上传，请先取消当前上传', 'error'); input.value = ''; return; }
    if (view.uploadHideTimer) { clearTimeout(view.uploadHideTimer); view.uploadHideTimer = null; }
    const rootPath = sftpPath($('.path-input', view).value); const uploadSession = `upload-${Date.now().toString(36)}`; const isDirectoryPick = input.hasAttribute('data-upload-directory'); const entries = files.map((file, index) => { const baseName = String(file.name || '').replace(/[\/:*?"<>|]/g, '_') || 'file'; const rawRelative = String(file.webkitRelativePath || '').replace(/\\/g, '/'); const segments = rawRelative.split('/').filter((segment) => segment && segment !== '.'); const relativePath = isDirectoryPick && segments.length ? segments.join('/') : `${uploadSession}/upload-${index + 1}-${baseName}`; return { file, relativePath }; });
    const upload = { active: true, currentXhr: null, cancelled: false, index: 0, totalBytes: entries.reduce((sum, entry) => sum + entry.file.size, 0), sentBytes: 0 }; tab.upload = upload;
    const cancelButton = $('[data-upload-cancel]', view); if (cancelButton) cancelButton.onclick = () => { if (tab.upload !== upload) return; upload.cancelled = true; cancelButton.disabled = true; upload.currentXhr?.abort(); };
    const sendNext = () => {
      if (tab.upload !== upload) return;
      if (upload.cancelled) { tab.upload = null; finishUpload(tab, view, input, '上传已取消', 'cancelled'); return; }
      const entry = entries[upload.index]; if (!entry) { tab.upload = null; finishUpload(tab, view, input, `上传完成（${entries.length} 个文件）`); loadFiles(tab, rootPath); return; }
      const form = new FormData(); form.append('file', entry.file); form.append('path', rootPath); form.append('relativePath', entry.relativePath);
      const xhr = new XMLHttpRequest(); upload.currentXhr = xhr; const fileNumber = upload.index + 1; setUploadStatus(view, { label: `上传 ${entry.relativePath}`, percent: upload.totalBytes ? Math.round((upload.sentBytes / upload.totalBytes) * 100) : 0, detail: `${fileNumber} / ${entries.length} · ${formatSize(upload.sentBytes)} / ${formatSize(upload.totalBytes)}`, cancellable: true });
      xhr.open('POST', `/api/servers/${tab.serverId}/files/upload`); xhr.withCredentials = true; if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken); xhr.responseType = 'json';
      xhr.upload.onprogress = (event) => { if (!event.lengthComputable || tab.upload !== upload) return; const loaded = upload.sentBytes + event.loaded; const percent = upload.totalBytes ? Math.round((loaded / upload.totalBytes) * 100) : 0; setUploadStatus(view, { label: `上传 ${entry.relativePath}`, percent, detail: `${fileNumber} / ${entries.length} · ${formatSize(loaded)} / ${formatSize(upload.totalBytes)}`, cancellable: true }); };
      xhr.onload = () => { if (tab.upload !== upload) return; if (xhr.status === 401) { finishUpload(tab, view, input, '登录已过期，请重新登录', 'error'); logout(); return; } if (xhr.status >= 200 && xhr.status < 300) { upload.sentBytes += entry.file.size; upload.index += 1; sendNext(); } else { tab.upload = null; finishUpload(tab, view, input, uploadErrorMessage(xhr), 'error'); } };
      xhr.onerror = () => { if (tab.upload === upload) { tab.upload = null; finishUpload(tab, view, input, '上传失败，请检查网络连接', 'error'); } };
      xhr.onabort = () => { if (tab.upload !== upload) return; if (tab.manualClose) { tab.upload = null; if (input) input.value = ''; return; } if (upload.cancelled) { tab.upload = null; finishUpload(tab, view, input, '上传已取消', 'cancelled'); } else { tab.upload = null; finishUpload(tab, view, input, '上传已中止', 'error'); } };
      xhr.send(form);
    };
    sendNext();
  }
  function sftpPath(value) { const parts = String(value || '/').split('/').filter(Boolean); const out=[]; parts.forEach((part) => part === '..' ? out.pop() : part !== '.' && out.push(part)); return '/' + out.join('/'); }
  const SFTP_FILE_ICONS = {
    directory:'<path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><path d="M2.5 10.5h18"/>',
    file:'<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5"/>',
    markdown:'<rect x="2.75" y="5" width="18.5" height="14" rx="2.25"/><path d="M6.25 15v-6l2.75 3 2.75-3v6M15.5 9v6m-2.25-2.25L15.5 15l2.25-2.25"/>',
    code:'<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5M9 12.5 6.75 15 9 17.5m6-5 2.25 2.5L15 17.5m-3.5.5 1.25-6"/>',
    terminal:'<rect x="2.75" y="4" width="18.5" height="16" rx="2.25"/><path d="m6.5 9 3 3-3 3m5.5 0h5"/>',
    config:'<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5M8 12.5h6m-6 3h8m-8 3h5"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2.25"/><circle cx="8.25" cy="9" r="1.5"/><path d="m4.5 17 4.75-4.75 3.25 3.25 2.25-2.25L19.5 18"/>',
    archive:'<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5M10.5 5h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2"/>',
    pdf:'<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5"/><text x="11" y="17.25" text-anchor="middle" class="sftp-icon-text">PDF</text>',
    sheet:'<rect x="3.25" y="3.25" width="17.5" height="17.5" rx="2"/><path d="M3.25 8.5h17.5M8.75 8.5v12.25m5.75-12.25v12.25M3.25 14.5h17.5"/>',
    database:'<ellipse cx="12" cy="5.75" rx="7.75" ry="3"/><path d="M4.25 5.75v6.25c0 1.65 3.47 3 7.75 3s7.75-1.35 7.75-3V5.75M4.25 12v6.25c0 1.65 3.47 3 7.75 3s7.75-1.35 7.75-3V12"/>',
    media:'<rect x="3" y="4" width="18" height="16" rx="2.25"/><path d="m10 8 6 4-6 4V8Z"/>',
    document:'<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v5h5M8 12h7m-7 3h7m-7 3h4"/>'
  };
  const SFTP_HIDDEN_BADGE = '<circle class="sftp-icon-badge-bg" cx="17.25" cy="17.25" r="5"/><path class="sftp-icon-badge" d="M13.65 17.25s1.3-2 3.6-2 3.6 2 3.6 2-1.3 2-3.6 2-3.6-2-3.6-2Z"/><path class="sftp-icon-badge" d="m14.15 14.15 6.2 6.2"/>';
  function sftpFilePresentation(item) {
    const name = String(item?.name || ''); const directory = item?.type === 'd'; const hidden = name.startsWith('.');
    if (directory) return { icon:'directory', kind:hidden ? 'hidden-directory' : 'directory', hidden, directory };
    if (hidden) return { icon:'file', kind:'hidden-file', hidden, directory };
    const lower = name.toLowerCase(); const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    const exact = lower === 'dockerfile' || lower === 'makefile' || lower === 'procfile';
    const groups = [
      ['markdown', ['md','markdown','mdx']],
      ['terminal', ['sh','bash','zsh','fish','ps1','bat','cmd']],
      ['code', ['js','jsx','mjs','cjs','ts','tsx','vue','svelte','html','htm','css','scss','sass','less','py','rb','php','java','c','h','cpp','hpp','cs','go','rs','swift','kt','kts','lua']],
      ['config', ['json','jsonc','yaml','yml','toml','ini','conf','cfg','xml','lock','properties']],
      ['image', ['png','jpg','jpeg','gif','webp','svg','ico','bmp','avif','tif','tiff']],
      ['archive', ['zip','tar','gz','tgz','bz2','xz','rar','7z']],
      ['pdf', ['pdf']],
      ['sheet', ['csv','xls','xlsx','ods']],
      ['database', ['sql','db','sqlite','sqlite3']],
      ['media', ['mp3','wav','ogg','flac','m4a','mp4','webm','mov','avi','mkv']],
      ['document', ['txt','log','rtf','doc','docx','odt']]
    ];
    const match = groups.find(([, extensions]) => extensions.includes(extension)); const kind = exact ? 'config' : (match?.[0] || 'file');
    return { icon:kind, kind, hidden, directory };
  }
  function sftpFileIcon(presentation) {
    const body = SFTP_FILE_ICONS[presentation.icon] || SFTP_FILE_ICONS.file; const badge = presentation.hidden ? SFTP_HIDDEN_BADGE : '';
    return `<span class="sftp-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${body}${badge}</svg></span>`;
  }
  async function downloadFile(tab, remotePath, filename) { try { const response = await fetch(`/api/servers/${tab.serverId}/files/download?path=${encodeURIComponent(remotePath)}`, { credentials:'same-origin' }); if (!response.ok) { let body={}; try { body=await response.json(); } catch { /* empty */ } if (response.status === 401) clearClientSession(); throw new Error(body.error || '下载失败'); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { notify(error.message, 'error'); } }
  async function loadFiles(tab, directory) {
    if (!tab.view) return;
    const panel = $('.sftp-panel', tab.view); const pathInput = $('.path-input', panel); const files = $('[data-files]', panel); const target = sftpPath(directory);
    pathInput.value = target; files.innerHTML = '<div class="empty">读取中…</div>';
    try {
      const result = await api(`/api/servers/${tab.serverId}/files?path=${encodeURIComponent(target)}`);
      files.innerHTML = result.items.map((item) => {
        const presentation = sftpFilePresentation(item); const dir = presentation.directory; const size = dir ? '—' : formatSize(item.size); const name = escapeHtml(item.name);
        return `<div class="file-row file-kind-${presentation.kind}${presentation.hidden ? ' is-hidden' : ''}"><span class="file-name${dir ? ' is-directory' : ''}" data-file="${name}" data-dir="${dir}" title="${dir ? '打开目录：' : ''}${name}">${sftpFileIcon(presentation)}<span class="file-name-label">${name}</span></span><span class="file-meta">${size}</span><span class="file-meta">${new Date(item.modifyTime || Date.now()).toLocaleString()}</span><span class="file-actions">${!dir ? `<button data-download="${name}" title="下载 ${name}" aria-label="下载 ${name}">↓</button>` : ''}<button data-delete="${name}" title="删除 ${name}" aria-label="删除 ${name}">×</button></span></div>`;
      }).join('') || '<div class="empty">目录为空</div>';
      files.querySelectorAll('[data-file]').forEach((node) => node.onclick = () => node.dataset.dir === 'true' && loadFiles(tab, sftpPath(`${target}/${node.dataset.file}`)));
      files.querySelectorAll('[data-download]').forEach((node) => node.onclick = () => downloadFile(tab, sftpPath(`${target}/${node.dataset.download}`), node.dataset.download));
      files.querySelectorAll('[data-delete]').forEach((node) => node.onclick = async () => { if (!confirm(`删除 ${node.dataset.delete}？`)) return; try { await api(`/api/servers/${tab.serverId}/files?path=${encodeURIComponent(sftpPath(`${target}/${node.dataset.delete}`))}`, { method:'DELETE' }); loadFiles(tab, target); } catch (e) { notify(e.message, 'error'); } });
    } catch (e) { files.innerHTML = `<div class="empty danger">${escapeHtml(e.message)}</div>`; }
  }
  function formatSize(size) { if (!size) return '0 B'; const units=['B','KB','MB','GB']; let n=size, i=0; while(n>=1024&&i<units.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${units[i]}`; }
  function renderUserHeader() { const name = $('#user-name'); const avatar = $('#user-menu-btn'); if (name) name.textContent = state.user?.username || ''; if (avatar) avatar.innerHTML = avatarMarkup(); applyUserPreferences(); }
  async function openAboutModal() {
    let version = '未知';
    try { const result = await api('/api/version'); version = String(result.version || version); } catch (error) { notify(error.message, 'error'); return; }
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<div class="modal about-modal"><div class="modal-head"><h3>关于 NexTerm</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div><div class="modal-body about-body">${brandMark('about-mark')}<h4>NexTerm</h4><p>Remote dev workspace</p><p class="about-version">当前版本 <strong>${escapeHtml(version)}</strong></p></div></div>`;
    document.body.appendChild(backdrop); $('[data-close]', backdrop).onclick = () => backdrop.remove();
  }
  const EVOLUTION_STATUS_LABELS = { pending:'待处理', fixed:'待你确认', verified:'已确认闭环', rejected:'未修复 / 不接受' };
  const evolutionStatusIcon = (status) => status === 'verified' ? '<span class="evolution-mark verified" title="已确认闭环">✔</span>' : status === 'fixed' ? '<span class="evolution-mark fixed" title="AI 已修复，待你确认">✓</span>' : status === 'rejected' ? '<span class="evolution-mark rejected" title="未修复或不接受">✕</span>' : '<span class="evolution-mark pending" title="待处理">•</span>';
  function openEvolutionModal() {
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal evolution-modal"><div class="modal-head"><h3>进化</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div><div class="modal-body"><p class="evolution-hint">每一行提交一条改进建议或一个 bug 描述，提交后保存在服务器数据库中；AI IDE 会在下次开发时读取并针对性优化。AI 标记「已修复」后记录会显示为「待你确认」，请点击「确认已修复」才算闭环；如果问题仍在，点「仍未修复」会退回待处理并累计次数。</p><form id="evolution-form"><div class="field"><label>改进建议 / bug 描述（每行一条）</label><textarea name="text" rows="4" data-evolution-input placeholder="每行一条，例如：&#10;终端在手机上无法滚动&#10;建议：服务器列表支持按名称搜索" maxlength="20000"></textarea></div><div class="evolution-form-foot"><span class="evolution-count" data-evolution-count>0 条</span><button class="primary evolution-submit" type="submit">提交</button></div><div class="error" data-evolution-error></div></form><div class="evolution-list-head"><h4>提交记录</h4><span class="evolution-list-tools"><span class="evolution-pager" data-evolution-pager></span><button class="secondary" type="button" data-evolution-refresh>刷新</button></span></div><div class="evolution-list" data-evolution-list><div class="empty">正在加载…</div></div></div></div>`;
    document.body.appendChild(backdrop);
    const list = $('[data-evolution-list]', backdrop); const form = $('#evolution-form', backdrop); const input = $('[data-evolution-input]', backdrop); const error = $('[data-evolution-error]', backdrop); const count = $('[data-evolution-count]', backdrop); const submit = $('.evolution-submit', form); const pager = $('[data-evolution-pager]', backdrop);
    const PAGE_SIZE = 10;
    let allItems = []; let page = 1; let expandedId = '';
    const lineCount = () => input.value.split('\n').map((line) => line.trim()).filter(Boolean).length;
    const updateCount = () => { count.textContent = `${lineCount()} 条`; };
    input.oninput = updateCount;
    // Sort: pending/fixed (needs attention) first, then by newest.
    const statusRank = (status) => status === 'pending' ? 0 : status === 'fixed' ? 1 : status === 'verified' ? 2 : 3;
    const sortedItems = () => [...allItems].sort((a, b) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      const ta = new Date(a.createdAt || 0).getTime(); const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
    const renderPager = () => {
      const total = allItems.length;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      page = Math.min(Math.max(1, page), pages);
      if (total <= PAGE_SIZE) { pager.innerHTML = total ? `<span>共 ${total} 条</span>` : ''; return; }
      pager.innerHTML = `<button type="button" class="evolution-page" data-page-prev ${page === 1 ? 'disabled' : ''}>‹</button><span>第 ${page} / ${pages} 页 · 共 ${total} 条</span><button type="button" class="evolution-page" data-page-next ${page === pages ? 'disabled' : ''}>›</button>`;
      $('[data-page-prev]', backdrop).onclick = () => { page = Math.max(1, page - 1); renderPage(); };
      $('[data-page-next]', backdrop).onclick = () => { page = Math.min(pages, page + 1); renderPage(); };
    };
    const renderPage = () => {
      renderPager();
      if (!allItems.length) { list.innerHTML = '<div class="empty">还没有提交过建议或 bug 描述。</div>'; return; }
      const items = sortedItems();
      const start = (page - 1) * PAGE_SIZE;
      const slice = items.slice(start, start + PAGE_SIZE);
      list.innerHTML = slice.map((item) => {
        const expanded = item.id === expandedId;
        const reopenLabel = item.status === 'pending' && item.reopenCount > 0 ? ` · ${item.reopenCount} 次仍未修复` : '';
        const actions = item.status === 'fixed'
          ? '<div class="evolution-actions"><button class="primary evolution-confirm" type="button" data-evolution-verify="' + escapeHtml(item.id) + '" data-action="confirm">确认已修复</button><button class="secondary" type="button" data-evolution-verify="' + escapeHtml(item.id) + '" data-action="reopen">仍未修复</button></div>'
          : item.status === 'verified'
            ? '<div class="evolution-actions"><button class="secondary" type="button" data-evolution-verify="' + escapeHtml(item.id) + '" data-action="reopen">重新打开</button></div>'
            : '';
        const meta = `<span class="evolution-kind ${escapeHtml(item.kind)}">${item.kind === 'bug' ? 'bug' : '建议'}</span><span>${escapeHtml(EVOLUTION_STATUS_LABELS[item.status] || '待处理')}${reopenLabel ? escapeHtml(reopenLabel) : ''}</span><span>${escapeHtml(new Date(item.createdAt).toLocaleString())}</span>`;
        const detail = `<div class="evolution-detail"><p class="evolution-item-text">${escapeHtml(item.text)}</p><div class="evolution-item-meta">${meta}${item.fixedVersion ? `<span>修复于 ${escapeHtml(item.fixedVersion)}</span>` : ''}${item.verifiedAt ? `<span>确认于 ${escapeHtml(new Date(item.verifiedAt).toLocaleString())}</span>` : ''}${item.note ? `<span class="evolution-note">${escapeHtml(item.note)}</span>` : ''}</div>${actions}</div>`;
        return `<div class="evolution-item ${escapeHtml(item.status)}${expanded ? ' expanded' : ''}" data-evolution-id="${escapeHtml(item.id)}">${evolutionStatusIcon(item.status)}<div class="evolution-item-main"><button type="button" class="evolution-summary" data-evolution-toggle="${escapeHtml(item.id)}"><span class="evolution-summary-text">${escapeHtml(item.text)}</span><span class="evolution-caret">${expanded ? '▾' : '▸'}</span></button>${expanded ? detail : `<div class="evolution-item-meta collapsed">${meta}</div>`}</div></div>`;
      }).join('');
      list.querySelectorAll('[data-evolution-toggle]').forEach((button) => {
        button.onclick = () => { const target = button.dataset.evolutionToggle; expandedId = expandedId === target ? '' : target; renderPage(); };
      });
      list.querySelectorAll('[data-evolution-verify]').forEach((button) => {
        button.onclick = async () => {
          button.disabled = true;
          try {
            await api(`/api/evolutions/${encodeURIComponent(button.dataset.evolutionVerify)}/verify`, { method:'POST', body:JSON.stringify({ action:button.dataset.action }) });
            notify(button.dataset.action === 'reopen' ? '已退回待处理，AI IDE 下次开发会重新处理' : '已确认修复，该条记录闭环');
            await loadList();
          } catch (e) { notify(e.message, 'error'); button.disabled = false; }
        };
      });
    };
    const loadList = async () => {
      try { const result = await api('/api/evolutions'); allItems = Array.isArray(result?.items) ? result.items : []; renderPage(); }
      catch (e) { list.innerHTML = `<div class="empty danger">${escapeHtml(e.message)}</div>`; }
    };
    form.onsubmit = async (event) => {
      event.preventDefault(); error.textContent = '';
      const text = input.value; if (!lineCount()) { error.textContent = '请至少输入一条建议或 bug 描述'; return; }
      submit.disabled = true;
      try {
        const result = await api('/api/evolutions', { method:'POST', body:JSON.stringify({ text }) });
        input.value = ''; updateCount();
        notify(`已提交 ${result?.count ?? 0} 条，AI IDE 将在下次开发时处理`);
        page = 1; await loadList();
      } catch (e) { error.textContent = e.message; }
      finally { submit.disabled = false; input.focus(); }
    };
    $('[data-evolution-refresh]', backdrop).onclick = () => loadList();
    backdrop.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => backdrop.remove());
    updateCount(); loadList(); input.focus();
  }
  const APPROVAL_PRESETS = [
    { label:'TokenMeter 网关（本机 9080）', baseUrl:'https://127.0.0.1:9080/v1', model:'<在 TokenMeter 中绑定的模型>' },
    { label:'LM Studio（本机）', baseUrl:'http://127.0.0.1:1234/v1', model:'<LM Studio 已加载模型>' },
    { label:'Ollama（本机）', baseUrl:'http://127.0.0.1:11434/v1', model:'qwen2.5:7b' },
    { label:'vLLM', baseUrl:'http://127.0.0.1:8000/v1', model:'<vLLM 服务模型>' },
    { label:'OpenAI', baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini' }
  ];
  const APPROVAL_CHOICE_LABELS = { approve_once:'按 1（本次批准）', approve_always:'按 2（不再询问）', deny:'交回人工（建议拒绝）', unsafe:'交回人工（危险）', unknown:'交回人工（不确定）' };
  const APPROVAL_STOP_LABELS = {
    deny: '模型判定为「拒绝」，已停止并交回人工，请在终端自行选择',
    unsafe: '模型判定该操作为高危/危险，已停止并交回人工',
    unknown: '模型无法判断该操作是否安全，已停止并交回人工',
    model_error: '审批模型调用失败（网络/超时/返回无法解析），重试达到上限后已停止',
    no_model: '未配置可用的审批模型',
    rate_limited: '审批模型调用过于频繁，触发限流保护',
    upstream_failures: '审批模型连续多次调用失败，已进入冷却保护',
    write_failed: '向终端写入按键失败（终端可能已断开）',
    client_disabled: '已按你的操作关闭',
    stopped: '自动审批已停止'
  };
  const approvalStopLabel = (reason, message) => message || APPROVAL_STOP_LABELS[reason] || (reason ? `自动审批已停止（${reason}）` : '自动审批已停止');
  async function refreshApprovalModels() {
    try { const result = await api('/api/approval-models'); if (state.user) state.user.approvalModels = result.models || []; return result.models || []; }
    catch (error) { notify(error.message, 'error'); return []; }
  }
  function openApprovalSettings() {
    console.info('[NexTerm] build', CLIENT_BUILD_TAG);
    void (async () => {
      const models = await refreshApprovalModels();
      const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal approval-modal"><div class="modal-head"><h3>自动审批模型</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div><div class="modal-body"><p class="settings-note">终端里出现 Codex 等 CLI 的确认提示时，由这里配置的大模型判断该按 1、2 还是 3。兼容 OpenAI Chat Completions 协议的服务都可以用，例如 TokenMeter 网关、LM Studio、Ollama、vLLM、OpenAI。密钥只保存在服务端并加密，不会下发到浏览器。</p><div class="approval-default" data-approval-default></div><div class="approval-list" data-approval-list></div><div class="approval-editor" data-approval-editor></div></div><div class="modal-actions"><button type="button" class="secondary" data-close>关闭</button><button type="button" class="primary" data-add>添加模型</button></div></div>`;
      document.body.appendChild(backdrop);
      const list = $('[data-approval-list]', backdrop); const editor = $('[data-approval-editor]', backdrop); const defaultSlot = $('[data-approval-default]', backdrop);
      const closeEditor = () => { editor.innerHTML = ''; editor.dataset.editing = ''; };
      const renderList = () => {
        const currentDefault = state.user?.preferences?.approvalDefaultModelId || '';
        list.innerHTML = models.length ? models.map((model) => `<div class="approval-item${model.enabled === false ? ' disabled' : ''}${model.id === currentDefault ? ' is-default' : ''}" data-approval-item="${model.id}"><div class="approval-item-main"><strong>${escapeHtml(model.name)}${model.id === currentDefault ? ' <span class="approval-default-tag">（默认）</span>' : ''}</strong><small>${escape(maskApprovalSecrets(model.baseUrl))} · ${escape(maskApprovalSecrets(model.model))}</small><small>${model.hasKey ? `密钥已隐藏` : '未设置密钥'}${model.enabled === false ? ' · 已停用' : ''}</small></div><div class="approval-item-actions"><button type="button" class="secondary" data-default="${model.id}" data-is-default="${model.id === currentDefault ? '1' : '0'}">${model.id === currentDefault ? '取消默认' : '设为默认'}</button><button type="button" class="secondary" data-test="${model.id}">测试</button><button type="button" class="secondary" data-edit="${model.id}">编辑</button><button type="button" class="secondary danger" data-delete="${model.id}">删除</button></div><div class="approval-test-result" data-test-result="${model.id}"></div></div>`).join('') : '<div class="empty">还没有审批模型。点击「添加模型」接入 TokenMeter 或 LM Studio。</div>';
        renderDefault();
      };
      const renderDefault = () => {
        const current = state.user?.preferences?.approvalDefaultModelId || '';
        defaultSlot.innerHTML = models.length
          ? `<label class="approval-default-label">默认审批模型</label><div class="approval-default-status${current ? ' is-active' : ''}" data-approval-default-status></div><small>点击终端闪电图标时未单独指定模型的标签会使用这个默认模型。请在下方模型上点击「设为默认」。</small>${current ? '<button type="button" class="secondary" data-reset-default>恢复自动选择</button>' : ''}`
          : '';
        updateDefaultStatus(current, false);
      };
      const updateDefaultStatus = (modelId, changed) => {
        const status = $('[data-approval-default-status]', defaultSlot);
        if (!status) return;
        const model = models.find((m) => m.id === modelId);
        if (!modelId) { status.textContent = '当前为自动选择（列表中的第一个已启用模型）'; status.classList.remove('is-active'); return; }
        status.textContent = `当前默认：${maskApprovalSecrets(model ? model.name : modelId)}`;
        status.classList.add('is-active');
        if (changed) { status.classList.remove('just-set'); void status.offsetWidth; status.classList.add('just-set'); setTimeout(() => status.classList.remove('just-set'), 900); }
      };
      const syncDefaultMarks = (currentDefault) => {
        list.querySelectorAll('.approval-item').forEach((el) => {
          const id = el.dataset.approvalItem || '';
          const isDefault = id === currentDefault;
          el.classList.toggle('is-default', isDefault);
          const btn = el.querySelector('[data-default]');
          if (btn) { btn.textContent = isDefault ? '取消默认' : '设为默认'; btn.dataset.isDefault = isDefault ? '1' : '0'; if (btn.dataset.busy === '1') btn.textContent = isDefault ? '取消中…' : '设置中…'; }
          let tag = el.querySelector('.approval-default-tag');
          if (isDefault && !tag) {
            const strong = el.querySelector('.approval-item-main strong');
            if (strong) { const t = document.createElement('span'); t.className = 'approval-default-tag'; t.textContent = '（默认）'; strong.appendChild(t); }
          } else if (!isDefault && tag) { tag.remove(); }
        });
      };
      const setApprovalDefault = async (id, changed) => {
        const currentDefault = state.user?.preferences?.approvalDefaultModelId || '';
        syncDefaultMarks(currentDefault);
        updateDefaultStatus(currentDefault, false);
        renderDefault();
        if (changed) {
          const item = $(`.approval-item.is-default[data-test-result="${currentDefault}"]`, list);
          const status = $('[data-approval-default-status]', defaultSlot);
          const model = models.find((m) => m.id === currentDefault);
          notify(currentDefault ? `默认审批模型已切换为「${model ? model.name : currentDefault}」` : '已恢复自动选择审批模型');
          if (item) { item.classList.add('just-set'); item.scrollIntoView({ block:'nearest', behavior:'smooth' }); setTimeout(() => item.classList.remove('just-set'), 900); }
          if (status) { status.classList.add('just-set'); setTimeout(() => status.classList.remove('just-set'), 900); }
        }
      };
      const changeDefault = async (id) => {
        if (!state.user) state.user = {};
        if (!state.user.preferences) state.user.preferences = {};
        const was = state.user.preferences.approvalDefaultModelId || '';
        try {
          const result = await api('/api/approval-models/default', { method:'PUT', body:JSON.stringify({ modelId:id }) });
          if (result.preferences) state.user.preferences = result.preferences;
          state.user.approvalModels = result.models || state.user.approvalModels;
          models = result.models || models;
          const now = state.user.preferences.approvalDefaultModelId || '';
          const changed = now !== was;
          await setApprovalDefault(id, true);
          if (!changed) {
            const model = models.find((m) => m.id === now);
            notify(now ? `「${model ? model.name : now}」已是默认审批模型` : '当前已是自动选择');
          }
        } catch (e) { console.error('[approval-default] 设置默认失败', e); notify(e && e.message ? e.message : '设置默认审批模型失败', 'error'); }
      };
      const renderEditor = (model = null) => {
        editor.dataset.editing = model?.id || '';
        editor.innerHTML = `<form class="approval-form" data-approval-form><h4>${model ? '编辑模型' : '添加模型'}</h4><div class="field"><label>名称</label><input name="name" maxlength="64" required value="${escapeHtml(cleanApprovalField(model?.name))}" placeholder="例如：本机 LM Studio" /></div><div class="field"><label>Base URL</label><input name="baseUrl" required value="${escapeHtml(cleanApprovalField(model?.baseUrl))}" placeholder="http://127.0.0.1:1234/v1" /><small>通常以 /v1 结尾；TokenMeter 用 https://HOST:9080/v1</small></div><div class="field"><label>模型 ID</label><input name="model" maxlength="256" required value="${escapeHtml(cleanApprovalField(model?.model))}" placeholder="例如：qwen2.5-coder-7b" /></div><div class="field"><label>API Key${model?.hasKey ? '（留空保持不变）' : '（本地服务可留空）'}</label><input name="apiKey" type="password" autocomplete="off" value="" placeholder="${model?.hasKey ? model.keyHint : 'sk-...'}" /></div><label class="approval-enabled"><input name="enabled" type="checkbox" ${model?.enabled === false ? '' : 'checked'} /><span>启用此模型</span></label><div class="approval-presets"><span>快速填充：</span>${APPROVAL_PRESETS.map((preset, index) => `<button type="button" class="secondary" data-preset="${index}">${escapeHtml(preset.label)}</button>`).join('')}</div><div class="error" data-editor-error></div><div class="modal-actions inline"><button type="button" class="secondary" data-editor-cancel>取消</button><button type="submit" class="primary">${model ? '保存修改' : '保存模型'}</button></div></form>`;
        editor.scrollIntoView({ block:'end', behavior:'smooth' });
        const form = $('[data-approval-form]', editor);
        backdrop.querySelectorAll('[data-preset]').forEach((button) => button.onclick = () => {
          const preset = APPROVAL_PRESETS[Number(button.dataset.preset)]; if (!preset) return;
          if (!form.baseUrl.value || /\/v1$/.test(form.baseUrl.value)) form.baseUrl.value = preset.baseUrl;
          if (!form.model.value) form.model.value = preset.model;
        });
        $('[data-editor-cancel]', editor).onclick = closeEditor;
        form.onsubmit = async (event) => {
          event.preventDefault();
          const error = $('[data-editor-error]', editor); error.textContent = '';
          const body = JSON.stringify({ name:form.name.value, baseUrl:form.baseUrl.value, model:form.model.value, enabled:form.enabled.checked, ...(form.apiKey.value ? { apiKey:form.apiKey.value } : {}) });
          const editing = editor.dataset.editing;
          try {
            const result = await api(editing ? `/api/approval-models/${editing}` : '/api/approval-models', { method: editing ? 'PUT' : 'POST', body });
            state.user.approvalModels = result.models || [];
            closeEditor(); renderList(); notify(editing ? '审批模型已更新' : '审批模型已添加');
          } catch (e) { error.textContent = e.message; }
        };
      };
      const runDefaultToggle = async (button) => {
        const id = button.dataset.default;
        if (button.dataset.busy === '1') return;
        button.dataset.busy = '1';
        button.textContent = button.dataset.isDefault === '1' ? '取消中…' : '设置中…';
        const currentDefault = state.user?.preferences?.approvalDefaultModelId || '';
        try {
          await changeDefault(id === currentDefault ? '' : id);
        } catch (err) {
          console.error('[approval-default] 点击设为默认异常', err);
          notify('设置默认审批模型失败', 'error');
        } finally {
          delete button.dataset.busy;
          if (button.isConnected) syncDefaultMarks(state.user?.preferences?.approvalDefaultModelId || '');
        }
      };
      list.onclick = async (event) => {
        const defaultButton = event.target.closest('[data-default]');
        if (defaultButton) { await runDefaultToggle(defaultButton); return; }
        const id = event.target.closest('[data-edit]')?.dataset.edit || event.target.closest('[data-delete]')?.dataset.delete || event.target.closest('[data-test]')?.dataset.test;
        if (!id) return;
        const model = models.find((item) => item.id === id);
        if (event.target.closest('[data-edit]')) { renderEditor(model); return; }
        if (event.target.closest('[data-delete]')) {
          if (!confirm(`删除审批模型「${model?.name || ''}」？`)) return;
          try { const result = await api(`/api/approval-models/${id}`, { method:'DELETE' }); state.user.approvalModels = result.models || []; models = state.user.approvalModels; if (result.preferences) state.user.preferences = result.preferences; closeEditor(); renderList(); notify('审批模型已删除'); }
          catch (e) { notify(e.message, 'error'); }
          return;
        }
        const slot = $(`[data-test-result="${id}"]`, list);
        if (slot) slot.innerHTML = '<span class="approval-testing">正在请求模型…</span>';
        try {
          const result = await api(`/api/approval-models/${id}/test`, { method:'POST', body:'{}' });
          if (slot) slot.innerHTML = result.ok
            ? `<span class="approval-ok">可用（${Number(result.latencyMs || 0)} ms）：${escapeHtml(APPROVAL_CHOICE_LABELS[result.decision?.choice] || result.decision?.choice || '')}${result.decision?.reason ? ` · ${escapeHtml(result.decision.reason)}` : ''}</span>`
            : `<span class="approval-fail">${escapeHtml(result.error || '测试失败')}</span>`;
        } catch (e) { if (slot) slot.innerHTML = `<span class="approval-fail">${escapeHtml(e.message)}</span>`; }
      };
      defaultSlot.onclick = async (event) => {
        if (event.target.closest('[data-reset-default]')) { await changeDefault(''); }
      };
      backdrop.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => backdrop.remove());
      $('[data-add]', backdrop).onclick = () => renderEditor();
      renderList();
    })();
  }
  // Upstream API keys can appear in the captured prompt block when a model is
  // configured with credentials embedded in its Base URL. Never echo them back
  // to the browser in the approval history.
  const APPROVAL_SECRET_MASK_RE = [
    /\bBearer\s+[A-Za-z0-9\-_.~+\/]+={0,2}/gi,
    /\b(?:sk|pk|gsk|tm|key|token)_[A-Za-z0-9]{8,}/g,
    /\b[A-Za-z0-9]{16,}(?:[+/][A-Za-z0-9]+)*(?:={0,2})\b/g,
    /[+\/]{2,}[A-Za-z0-9+/=]{16,}/g,
    /(?<=[?:=])\s*['"]?[A-Za-z0-9+/=_\-]{20,}['"]?/g,
    /[A-Za-z0-9+/=_\-]{16,}(:[A-Za-z0-9+/=_\-]+){2,}/g,
    /Bearer%20[A-Za-z0-9%\-_.~+]{8,}/gi,
    /\b(?:sk|pk|gsk|tm|key|token)%5F[A-Za-z0-9]{8,}/gi,
    /\b[A-Za-z0-9]{16,}(?:%2F[0-9A-Za-z]+)*\b/g,
    /%2F{2,}[0-9A-Za-z%]{16,}/g
  ];
  const maskApprovalSecrets = (text) => {
    const value = String(text || '');
    if (!value) return value;
    let masked = value;
    for (const pattern of APPROVAL_SECRET_MASK_RE) { pattern.lastIndex = 0; masked = masked.replace(pattern, '••••（已隐藏）'); }
    return masked;
  };
  // Values can arrive percent-encoded (legacy data or a paste from an address
  // bar). Decode for display/editing only; the save path re-validates.
  const cleanApprovalField = (value) => { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } };
  function openApprovalHistoryModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const live = state.activeTab ? state.tabs.get(state.activeTab) : null;
    const scopeSessionId = live ? live.id : '';
    const scopeSessionName = live ? (live.name || '') : '';
    const scopeHost = live ? (state.servers.find((item) => item.id === live.serverId)?.host || '') : '';
    const scopeLabel = scopeHost ? `${scopeSessionName || '当前标签'} · ${scopeHost}` : (scopeSessionName || '当前标签');
    backdrop.innerHTML = `<div class="modal approval-modal"><div class="modal-head"><h3>自动审批记录 · <small style="font-weight:500;color:var(--muted)">${escapeHtml(scopeLabel)}</small></h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div><div class="modal-body"><div class="approval-history"><h4>最近一次停止</h4><div class="approval-history-list" data-history-stop><div class="empty">正在加载…</div></div><h4>高危人工处理</h4><div class="approval-history-list" data-history-high><div class="empty">正在加载…</div></div><h4>最近模型决定</h4><div class="approval-history-list" data-history-decisions><div class="empty">正在加载…</div></div></div></div><div class="modal-actions"><button type="button" class="secondary" data-close>关闭</button></div></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => backdrop.remove());
    const escape = escapeHtml;
    const fmtTime = (value) => { try { return new Date(value).toLocaleString(); } catch { return String(value || ''); } };
    const RISK_LABELS = { low:'低', medium:'中', high:'高', critical:'严重' };
    const choiceLabel = (choice, fallback = '') => APPROVAL_CHOICE_LABELS[choice] || fallback || choice || '—';
    const blockHtml = (block) => {
      const text = String(block || '').trim();
      if (!text) return '';
      return `<details class="approval-history-block"><summary>待确认内容</summary><pre>${escape(maskApprovalSecrets(text.slice(0, 1200)))}</pre></details>`;
    };
    void (async () => {
      let result;
      const qs = new URLSearchParams();
      if (scopeSessionId) qs.set('sessionId', scopeSessionId);
      if (scopeSessionName && !scopeSessionId) qs.set('sessionName', scopeSessionName);
      const qsString = qs.toString();
      try { result = await api(`/api/approval-history${qsString ? `?${qsString}` : ''}`); } catch (e) { $('[data-history-high]', backdrop).innerHTML = `<div class="empty">${escape(e.message)}</div>`; $('[data-history-decisions]', backdrop).innerHTML = '<div class="empty">无记录</div>'; return; }
      let stopReason = live ? (live.approvalStopReason || '') : '';
      let stopMessage = live ? (live.approvalStopReasonMessage || '') : '';
      let stopModel = ''; let stopRememberAll = false; let liveEnabled = false;
      if (live && live.kind === 'ssh') {
        try {
          const st = await new Promise((resolve) => { let settled = false; let timer = null; const done = (value) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(value); }; timer = setTimeout(() => done(null), 1500); const ws = live.ws; if (!ws || ws.readyState !== WebSocket.OPEN) return done(null); ws.onmessage = (event) => { try { const msg = JSON.parse(event.data); if (msg && msg.type === 'approval' && msg.action === 'state') done(msg); } catch { /* ignore */ } }; sendApprovalControl(live, 'status'); });
          if (st && st.action === 'state') { stopReason = st.stopReason || stopReason; stopMessage = st.message || stopMessage; stopModel = st.modelName ? `${st.modelName} · ${st.model}` : (st.model || ''); stopRememberAll = Boolean(st.rememberAll); liveEnabled = st.enabled === true; }
        } catch { /* status fetch is best-effort */ }
      }
      const stopHost = live ? (state.servers.find((item) => item.id === live.serverId)?.host || live.name || '') : '';
      const stopLabel = approvalStopLabel(stopReason, stopMessage);
      $('[data-history-stop]', backdrop).innerHTML = live
        ? (liveEnabled
            ? `<div class="approval-history-item"><div class="approval-history-item-head"><span>${escape(stopHost)}</span><span class="risk-tag risk-low">运行中</span></div><small>自动审批当前已开启${stopModel ? `（${escape(maskApprovalSecrets(stopModel))}）` : ''}。</small></div>`
            : stopReason
              ? `<div class="approval-history-item"><div class="approval-history-item-head"><span>${escape(stopHost)}</span><span class="risk-tag risk-medium">已停止</span></div><small>${escape(stopLabel)}</small>${stopModel ? `<small>使用模型：${escape(maskApprovalSecrets(stopModel))}${stopRememberAll ? ' · 已记住同类操作' : ''}</small>` : ''}<div class="approval-history-actions"><button type="button" class="primary" data-rearm-approval>重新开启自动审批</button><button type="button" class="secondary" data-approval-settings>更换/配置模型</button></div></div>`
              : '<div class="empty">该标签尚未触发过自动审批停止。</div>')
        : '<div class="empty">当前没有已连接的终端标签。</div>';
      const rearmBtn = $('[data-rearm-approval]', backdrop);
      if (rearmBtn) rearmBtn.onclick = () => { rearmTabApproval(live); backdrop.remove(); };
      const cfgBtn = $('[data-approval-settings]', backdrop);
      if (cfgBtn) cfgBtn.onclick = () => { backdrop.remove(); openApprovalSettings(); };
      const highRisk = Array.isArray(result.highRisk) ? result.highRisk : [];
      $('[data-history-high]', backdrop).innerHTML = highRisk.length ? highRisk.map((entry) => {
        const risk = entry.risk ? `<span class="risk-tag risk-${escape(entry.risk)}">${escape(RISK_LABELS[entry.risk] || entry.risk)}</span>` : '';
        const model = entry.modelReason ? `<small>模型：${escape(maskApprovalSecrets(choiceLabel(entry.choice, entry.modelReason)))} · ${escape(maskApprovalSecrets(entry.modelReason))}</small>` : '';
        const human = entry.humanChoice
          ? `<small class="human-resolved">人工处理：${escape(entry.humanChoiceLabel || entry.humanChoice)}${entry.resolvedAt ? ` · ${escape(fmtTime(entry.resolvedAt))}` : ''}</small>`
          : `<small class="human-pending">人工处理：未记录${entry.resolvedAt ? ` · ${escape(fmtTime(entry.resolvedAt))}` : ''}</small>`;
        return `<div class="approval-history-item"><div class="approval-history-item-head"><span>${escape(fmtTime(entry.time))}</span>${risk}</div>${model}${human}${blockHtml(entry.block)}</div>`;
      }).join('') : '<div class="empty">暂无高危处理记录。遇到高危提示时会自动记录你的人工选择。</div>';
      const decisions = Array.isArray(result.decisions) ? result.decisions : [];
      $('[data-history-decisions]', backdrop).innerHTML = decisions.length ? decisions.map((item) => {
        const risk = item.risk ? `<span class="risk-tag risk-${escape(item.risk)}">${escape(RISK_LABELS[item.risk] || item.risk)}</span>` : '';
        const summary = item.type === 'approval.auto_key'
          ? `自动执行：${escape(maskApprovalSecrets(item.message || ''))}`
          : `模型决定：${escape(maskApprovalSecrets(choiceLabel(item.choice, item.reason)))}${item.reason ? ` · ${escape(maskApprovalSecrets(item.reason))}` : ''}`;
        return `<div class="approval-history-item"><div class="approval-history-item-head"><span>${escape(fmtTime(item.time))}</span>${risk}</div><small>${summary}</small>${blockHtml(item.promptBlock)}</div>`;
      }).join('') : '<div class="empty">暂无模型决定记录。</div>';
    })();
  }
  function openSettingsModal() {
    const preferences = state.user?.preferences || {}; const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<form class="modal settings-modal" id="profile-settings"><div class="modal-head"><h3>个人设置</h3><button type="button" class="icon-btn" data-close>×</button></div><div class="modal-body"><div class="settings-grid"><section><h4>头像</h4><div class="avatar-editor"><canvas width="256" height="256" data-avatar-canvas></canvas><div class="avatar-editor-actions"><label class="secondary" style="cursor:pointer">选择图片<input type="file" accept="image/png,image/jpeg,image/webp" data-avatar-file hidden /></label><button class="secondary" type="button" data-avatar-remove>移除头像</button></div><div class="field"><label>缩放</label><input type="range" min="1" max="3" step="0.01" value="1" data-avatar-zoom /></div><small>拖动头像调整位置，使用滑块缩放；保存时裁剪为正方形。</small></div></section><section><h4>界面与终端</h4><div class="field"><label>全局界面字体</label><select name="fontFamily"><option value="system">系统默认</option><option value="modern">现代无衬线</option><option value="serif">衬线字体</option><option value="monospace">等宽字体</option></select></div><div class="field"><label>终端字号 <span data-terminal-size>${Number(preferences.terminalFontSize || 13)} px</span></label><input name="terminalFontSize" type="range" min="11" max="24" step="1" value="${Number(preferences.terminalFontSize || 13)}" /></div><p class="settings-note">字体设置保存在账户中，对所有服务器标签全局生效。</p><button class="secondary" type="button" data-approval-settings>自动审批模型（大模型）</button><button class="secondary" type="button" data-security-settings>双因素认证与受信任设备</button></section></div><div class="error" data-settings-error></div></div><div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button type="submit" class="primary">保存设置</button></div></form>`;
    document.body.appendChild(backdrop); const form = $('#profile-settings', backdrop); const canvas = $('[data-avatar-canvas]', backdrop); const context = canvas.getContext('2d'); const zoomInput = $('[data-avatar-zoom]', backdrop); const fileInput = $('[data-avatar-file]', backdrop); const fontSelect = $('[name="fontFamily"]', form); fontSelect.value = preferences.fontFamily || 'system';
    const editor = { image:null, zoom:1, offsetX:0, offsetY:0, dragging:false, lastX:0, lastY:0, removed:!state.user?.avatar };
    const drawAvatar = () => { context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#172332'; context.fillRect(0, 0, canvas.width, canvas.height); if (!editor.image) { context.fillStyle = '#66e3b4'; context.font = '700 72px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(userInitials(), 128, 132); return; } const base = Math.max(canvas.width / editor.image.naturalWidth, canvas.height / editor.image.naturalHeight); const scale = base * editor.zoom; const width = editor.image.naturalWidth * scale; const height = editor.image.naturalHeight * scale; const maxX = Math.max(0, (width - canvas.width) / 2); const maxY = Math.max(0, (height - canvas.height) / 2); editor.offsetX = Math.max(-maxX, Math.min(maxX, editor.offsetX)); editor.offsetY = Math.max(-maxY, Math.min(maxY, editor.offsetY)); context.drawImage(editor.image, (canvas.width - width) / 2 + editor.offsetX, (canvas.height - height) / 2 + editor.offsetY, width, height); };
    const loadEditorImage = (source) => { const image = new Image(); image.onload = () => { editor.image = image; editor.zoom = 1; editor.offsetX = 0; editor.offsetY = 0; editor.removed = false; zoomInput.value = '1'; drawAvatar(); }; image.onerror = () => notify('头像图片读取失败', 'error'); image.src = source; };
    if (state.user?.avatar) loadEditorImage(state.user.avatar); else drawAvatar();
    fileInput.onchange = () => { const file = fileInput.files[0]; if (!file) return; if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) { notify('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片', 'error'); fileInput.value = ''; return; } const reader = new FileReader(); reader.onload = () => loadEditorImage(reader.result); reader.readAsDataURL(file); };
    zoomInput.oninput = () => { editor.zoom = Number(zoomInput.value); drawAvatar(); }; canvas.onpointerdown = (event) => { if (!editor.image) return; editor.dragging = true; editor.lastX = event.clientX; editor.lastY = event.clientY; canvas.setPointerCapture(event.pointerId); }; canvas.onpointermove = (event) => { if (!editor.dragging) return; const factor = canvas.width / canvas.clientWidth; editor.offsetX += (event.clientX - editor.lastX) * factor; editor.offsetY += (event.clientY - editor.lastY) * factor; editor.lastX = event.clientX; editor.lastY = event.clientY; drawAvatar(); }; canvas.onpointerup = canvas.onpointercancel = () => { editor.dragging = false; };
    $('[data-avatar-remove]', backdrop).onclick = () => { editor.image = null; editor.removed = true; editor.zoom = 1; editor.offsetX = 0; editor.offsetY = 0; zoomInput.value = '1'; drawAvatar(); };
    const terminalSize = $('[name="terminalFontSize"]', form); terminalSize.oninput = () => { $('[data-terminal-size]', form).textContent = `${terminalSize.value} px`; };
    backdrop.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => backdrop.remove()); $('[data-approval-settings]', backdrop).onclick = () => { backdrop.remove(); openApprovalSettings(); }; $('[data-security-settings]', backdrop).onclick = () => { backdrop.remove(); openSecurityModal(); };
    form.onsubmit = async (event) => { event.preventDefault(); const error = $('[data-settings-error]', form); error.textContent = ''; const avatar = editor.image ? canvas.toDataURL('image/jpeg', 0.88) : ''; try { const result = await api('/api/auth/profile', { method:'PUT', body:JSON.stringify({ avatar, preferences:{ fontFamily:fontSelect.value, terminalFontSize:Number(terminalSize.value) } }) }); state.user = result.user; renderUserHeader(); backdrop.remove(); notify('个人设置已保存'); } catch (e) { error.textContent = e.message; } };
  }
  async function openSecurityModal() {
    let status; try { status = await api('/api/auth/2fa/status'); } catch (e) { notify(e.message, 'error'); return; }
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    const events = Array.isArray(status.recentEvents) && status.recentEvents.length ? `<div class="security-event-list"><h4>最近安全事件</h4>${status.recentEvents.map((item) => `<div class="security-event"><strong>${escapeHtml(item.message || item.type)}</strong><span>${escapeHtml(new Date(item.time).toLocaleString())}${item.ip ? ` · ${escapeHtml(item.ip)}` : ''}</span></div>`).join('')}</div>` : '';
    const render = (content) => { backdrop.innerHTML = `<div class="modal"><div class="modal-head"><h3>安全设置</h3><button type="button" class="icon-btn" data-close>×</button></div><div class="modal-body">${content}${events}</div></div>`; backdrop.querySelector('[data-close]').onclick = () => backdrop.remove(); };
    const showSetup = async (credentials, rebind = false) => { const error = $('[data-security-error]', backdrop); if (error) error.textContent = ''; try { const setup = await api('/api/auth/2fa/setup', { method:'POST', body:JSON.stringify(credentials) }); if (!setup?.qrDataUrl) throw new Error('二维码暂不可用，请重建并重启 NexTerm 服务'); const container = $('#setup-2fa', backdrop); container.innerHTML = `<div class="totp-setup"><div class="totp-qr"><img src="${escapeHtml(setup.qrDataUrl)}" alt="扫描此二维码绑定身份验证器" /><small>用 FreeOTP 扫描二维码</small></div><div class="totp-setup-details"><p class="setup-hint">打开 FreeOTP 扫描二维码，再输入应用显示的 6 位验证码。新的 MFA 生效后，旧会话和受信任设备会立即失效。</p><div class="setup-actions"><button type="button" class="secondary" data-copy-secret>复制手动密钥</button><button type="button" class="secondary" data-copy-uri>复制 URI</button></div><div class="field"><label>手动密钥</label><input readonly value="${escapeHtml(setup.secret)}" /></div><div class="field"><label>otpauth URI</label><textarea rows="3" readonly>${escapeHtml(setup.otpauthUrl)}</textarea></div></div></div><form id="enable-2fa"><div class="field"><label>新验证器中的 6 位验证码</label><input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required /></div><div class="error" data-enable-error></div><button class="primary" type="submit">${rebind ? '确认重新绑定' : '确认启用'}</button></form>`; $('[data-copy-secret]', backdrop).onclick = () => copyText(setup.secret, '手动密钥已复制'); $('[data-copy-uri]', backdrop).onclick = () => copyText(setup.otpauthUrl, 'otpauth URI 已复制'); $('#enable-2fa', backdrop).onsubmit = async (event) => { event.preventDefault(); try { await api('/api/auth/2fa/enable', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); backdrop.remove(); notify(rebind ? '双因素认证已重新绑定' : '双因素认证已启用'); } catch (e) { $('[data-enable-error]', backdrop).textContent = e.message; } }; $('#enable-2fa [name="otp"]', backdrop).focus(); } catch (e) { if (error) error.textContent = e.message; else notify(e.message, 'error'); } };
    if (status.enabled) {
      render(`<p style="color:var(--muted);font-size:13px;line-height:1.6">双因素认证已启用。当前有 <strong data-trusted-count>${Number(status.trustedDeviceCount || 0)}</strong> 台受信任设备。重新绑定、停用或撤销设备都必须验证当前密码和旧验证码。</p><form id="manage-2fa"><div class="field"><label>当前密码</label><input name="currentPassword" type="password" autocomplete="current-password" required /></div><div class="field"><label>当前动态验证码</label><input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required /></div><div class="error" data-security-error></div><div class="security-actions"><button class="secondary" type="button" data-rebind>重新绑定验证器</button><button class="secondary" type="button" data-revoke-devices>撤销受信任设备</button><button class="secondary danger" type="submit">停用双因素认证</button></div></form><div id="setup-2fa"></div>`);
      const manageForm = $('#manage-2fa', backdrop); manageForm.onsubmit = async (event) => { event.preventDefault(); try { await api('/api/auth/2fa/disable', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); backdrop.remove(); notify('双因素认证已停用'); } catch (e) { $('[data-security-error]', backdrop).textContent = e.message; } };
      $('[data-revoke-devices]', backdrop).onclick = async () => { const error = $('[data-security-error]', backdrop); error.textContent = ''; if (!manageForm.reportValidity()) return; try { await api('/api/auth/2fa/trusted-devices/revoke', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(manageForm))) }); $('[data-trusted-count]', backdrop).textContent = '0'; notify('所有受信任设备已撤销'); } catch (e) { error.textContent = e.message; } };
      $('[data-rebind]', backdrop).onclick = () => { if (!manageForm.reportValidity()) return; const data = Object.fromEntries(new FormData(manageForm)); showSetup({ currentPassword:data.currentPassword, currentOtp:data.otp }, true); };
    } else {
      render(`<p style="color:var(--muted);font-size:13px;line-height:1.6">启用后，登录需要密码和身份验证器验证码。生成二维码前需要重新验证当前密码。</p><form id="start-2fa-form"><div class="field"><label>当前密码</label><input name="currentPassword" type="password" autocomplete="current-password" required /></div><div class="error" data-security-error></div><button class="primary" type="submit">验证并生成二维码</button></form><div id="setup-2fa"></div>`);
      $('#start-2fa-form', backdrop).onsubmit = (event) => { event.preventDefault(); showSetup(Object.fromEntries(new FormData(event.currentTarget)), false); };
    }
    document.body.appendChild(backdrop);
  }
  function openServerModal(server = null) {
    const editing = Boolean(server); const colors = [{ value:'', label:'无' }, { value:'#ef4444', label:'红' }, { value:'#f97316', label:'橙' }, { value:'#eab308', label:'黄' }, { value:'#22c55e', label:'绿' }, { value:'#06b6d4', label:'青' }, { value:'#3b82f6', label:'蓝' }, { value:'#8b5cf6', label:'紫' }]; let selectedColor = server?.color || '';
    const palette = colors.map((item) => `<button type="button" class="color-swatch ${selectedColor === item.value ? 'active' : ''}" data-color="${item.value}" title="${item.label}" aria-label="${item.label}" ${item.value ? `style="--swatch:${item.value}"` : ''}>${item.value ? '' : '×'}</button>`).join('');
    const osOptions = SERVER_OS_OPTIONS.map((item) => `<option value="${item.value}" ${String(server?.os || '') === item.value ? 'selected' : ''}>${item.label}</option>`).join('');
    const backdrop = document.createElement('div'); backdrop.className='modal-backdrop'; backdrop.innerHTML = `<form class="modal" id="server-form"><div class="modal-head"><h3>${editing ? '编辑服务器' : '添加服务器'}</h3><button type="button" class="icon-btn" data-close>×</button></div><div class="modal-body"><div class="grid-2"><div class="field"><label>显示名称</label><input name="name" value="${escapeHtml(server?.name || '')}" placeholder="家里 AlmaLinux" required /></div><div class="field"><label>分组（可选）</label><input name="group" value="${escapeHtml(server?.group || '')}" placeholder="Personal" /></div><div class="field"><label>主机地址</label><input name="host" value="${escapeHtml(server?.host || '')}" placeholder="192.168.1.20" required /></div><div class="field"><label>端口</label><input name="port" type="number" min="1" max="65535" value="${server?.port || 22}" required /><small>由系统自动决定：SSH 默认 22，Windows 远程桌面(VNC) 默认 5900，可手动修改。</small></div><div class="field"><label>系统（决定图标与连接方式）</label><select name="os">${osOptions}</select><small>选择“自动识别”时，会根据名称和主机地址匹配系统。</small></div></div><div class="field"><label>用户名 <span class="field-tag" data-protocol-tag></span></label><input name="username" value="${escapeHtml(server?.username || '')}" placeholder="root" required /></div><div class="field"><label>SSH 主机指纹（可选）</label><input name="hostFingerprint" value="${escapeHtml(server?.hostFingerprint || '')}" placeholder="SHA256:..." /><small>${server?.hostFingerprint ? `已固定${server.hostKeyPinnedAt ? `于 ${escapeHtml(new Date(server.hostKeyPinnedAt).toLocaleString())}` : ''}。主机地址变化时会自动清空。` : '留空时首次成功连接会自动记录（TOFU），后续指纹变化将拒绝连接。'}</small></div><div class="field"><label>服务器列表背景色</label><div class="color-palette">${palette}</div><small>文字颜色会根据背景亮度自动调整。</small></div><div class="protocol-note" data-protocol-note></div><div class="sftp-bridge ${server?.os !== 'windows' ? 'hidden' : ''}" data-sftp-bridge><label class="sftp-bridge-toggle"><input type="checkbox" name="sftpBridgeEnabled" ${server?.sftpBridgeEnabled ? 'checked' : ''} /> 启用 SFTP 文件传输（Windows 主机）</label><small>启用后，NexTerm 会连接 Windows 上运行的 SFTP 服务（如 Win32-OpenSSH 的 sftp-server.exe、FileZilla Server 或 WinSCP），在标签页里使用与 Linux 相同的 SFTP 文件面板。</small><div class="sftp-bridge-fields"><div class="grid-2"><div class="field"><label>SFTP 端口</label><input name="sftpBridgePort" type="number" min="1" max="65535" value="${server?.sftpBridgePort || 2222}" /><small>Windows 上 SFTP 服务监听端口，默认 2222。</small></div><div class="field"><label>根目录</label><input name="sftpBridgeRoot" value="${escapeHtml(server?.sftpBridgeRoot || 'C:\\')}" placeholder="C:\" /><small>面板中的 "/" 对应此 Windows 目录。</small></div></div><div class="field"><label>SFTP 用户名</label><input name="sftpBridgeUser" value="${escapeHtml(server?.sftpBridgeUser || '')}" placeholder="留空则使用上方用户名" /></div><div class="auth-toggle"><button type="button" data-sftp-auth="password" class="${!server || server.sftpBridgeAuth !== 'key' ? 'active' : ''}">密码</button><button type="button" data-sftp-auth="key" class="${server?.sftpBridgeAuth === 'key' ? 'active' : ''}">私钥</button></div><div class="field sftp-bridge-password ${server?.sftpBridgeAuth === 'key' ? 'hidden' : ''}"><label>SFTP 密码</label><input name="sftpBridgePassword" type="password" autocomplete="new-password" /></div><div class="sftp-bridge-key ${server?.sftpBridgeAuth !== 'key' ? 'hidden' : ''}"><div class="field"><label>SFTP 私钥（PEM）</label><textarea name="sftpBridgePrivateKey" rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></div><div class="field"><label>私钥口令（可选）</label><input name="sftpBridgePassphrase" type="password" /></div></div><div class="field"><label>SFTP 主机指纹（可选）</label><input name="sftpFingerprint" value="${escapeHtml(server?.sftpFingerprint || '')}" placeholder="SHA256:..." /><small>${server?.sftpFingerprint ? `已固定${server.sftpFingerprintPinnedAt ? `于 ${escapeHtml(new Date(server.sftpFingerprintPinnedAt).toLocaleString())}` : ''}。` : '留空时首次连接自动记录（TOFU），指纹变化将拒绝连接。'}</small></div></div></div><div class="auth-toggle"><button type="button" data-auth="password" class="${!server || server.authType === 'password' ? 'active' : ''}">密码认证</button><button type="button" data-auth="key" class="${server?.authType === 'key' ? 'active' : ''}">私钥认证</button></div><div class="field auth-password ${server?.authType === 'key' ? 'hidden' : ''}"><label>密码 ${editing ? '<small>留空则保留原密码</small>' : ''}</label><input name="password" type="password" autocomplete="new-password" /></div><div class="auth-key ${!server || server.authType !== 'key' ? 'hidden' : ''}"><div class="field"><label>私钥内容（PEM）</label><textarea name="privateKey" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></div><div class="field"><label>私钥口令（可选）</label><input name="passphrase" type="password" /></div></div><div class="error" data-form-error></div></div><div class="modal-actions">${editing ? '<button type="button" class="secondary danger" data-delete>删除服务器</button>' : ''}<span style="flex:1"></span><button type="button" class="secondary" data-close>取消</button><button class="primary" type="submit">保存</button></div></form>`;
    document.body.appendChild(backdrop); const form = $('#server-form', backdrop); let authType = server?.authType || 'password';
    // The OS choice decides how we reach the machine: Windows → VNC desktop
    // (default 5900), everything else → SSH terminal (default 22). The port is
    // pre-filled accordingly but stays editable for non-default setups.
    const protocolTag = $('[data-protocol-tag]', backdrop); const protocolNote = $('[data-protocol-note]', backdrop); const portInput = $('[name="port"]', form);
    const osSelect = $('[name="os"]', form);
    const portTouched = { value: Boolean(server) };
    const applyProtocol = (isVnc) => {
      if (protocolTag) protocolTag.textContent = isVnc ? 'VNC 远程桌面' : 'SSH 终端';
      if (protocolNote) protocolNote.textContent = isVnc ? 'Windows 主机走 VNC 远程桌面：浏览器直接操作桌面。端口默认 5900，可在上方“端口”修改。若需在网页里管理 Windows 文件，请启用下方“SFTP 文件传输”。' : '非 Windows 主机走 SSH 终端：标准 xterm 终端 + SFTP 文件传输。端口默认 22，可在上方“端口”自定义。';
      if (!portTouched.value && portInput) portInput.value = isVnc ? '5900' : '22';
    };
    let sftpBridgeBlockRef = $('[data-sftp-bridge]', backdrop);
    const syncProtocolFromOs = () => {
      const chosen = osSelect?.value || '';
      const isWindows = chosen === 'windows' || (chosen === '' && detectServerOs({ name: $('[name="name"]', form)?.value, host: $('[name="host"]', form)?.value }) === 'windows');
      applyProtocol(isWindows);
      if (sftpBridgeBlockRef) sftpBridgeBlockRef.classList.toggle('hidden', !isWindows);
    };
    syncProtocolFromOs();
    if (editing) { const fingerprintInput = $('[name="hostFingerprint"]', form); const resetFingerprintIfEndpointChanged = () => { if ($('[name="host"]', form).value !== server.host || Number($('[name="port"]', form).value) !== Number(server.port || 22)) fingerprintInput.value = ''; }; $('[name="host"]', form).addEventListener('input', resetFingerprintIfEndpointChanged); $('[name="port"]', form).addEventListener('input', resetFingerprintIfEndpointChanged); }
    backdrop.querySelectorAll('[data-auth]').forEach((button) => button.onclick = () => { authType = button.dataset.auth; backdrop.querySelectorAll('[data-auth]').forEach((item) => item.classList.toggle('active', item === button)); $('.auth-password', backdrop).classList.toggle('hidden', authType !== 'password'); $('.auth-key', backdrop).classList.toggle('hidden', authType !== 'key'); });
    let sftpBridgeAuth = server?.sftpBridgeAuth === 'key' ? 'key' : 'password';
    const sftpBridgeBlock = $('[data-sftp-bridge]', backdrop);
    sftpBridgeBlockRef = sftpBridgeBlock;
    const applySftpBridgeAuth = () => { if (!sftpBridgeBlock) return; backdrop.querySelectorAll('[data-sftp-auth]').forEach((item) => item.classList.toggle('active', item.dataset.sftpAuth === sftpBridgeAuth)); $('.sftp-bridge-password', sftpBridgeBlock).classList.toggle('hidden', sftpBridgeAuth !== 'password'); $('.sftp-bridge-key', sftpBridgeBlock).classList.toggle('hidden', sftpBridgeAuth !== 'key'); };
    backdrop.querySelectorAll('[data-sftp-auth]').forEach((button) => { button.onclick = () => { sftpBridgeAuth = button.dataset.sftpAuth; applySftpBridgeAuth(); }; });
    applySftpBridgeAuth();
    const applySftpBridgeVisibility = (isVnc) => { if (sftpBridgeBlock) sftpBridgeBlock.classList.toggle('hidden', !isVnc); };
    applySftpBridgeVisibility(osSelect?.value === 'windows');
    osSelect?.addEventListener('change', () => { applySftpBridgeVisibility(osSelect?.value === 'windows'); });
    osSelect?.addEventListener('change', () => { portTouched.value = false; syncProtocolFromOs(); });
    const autoOsWatch = () => { if ((osSelect?.value || '') === '') syncProtocolFromOs(); };
    $('[name="name"]', form)?.addEventListener('input', autoOsWatch);
    $('[name="host"]', form)?.addEventListener('input', autoOsWatch);
    portInput?.addEventListener('input', () => { portTouched.value = true; });
    backdrop.querySelectorAll('[data-color]').forEach((button) => button.onclick = () => { selectedColor = button.dataset.color; backdrop.querySelectorAll('[data-color]').forEach((item) => item.classList.toggle('active', item === button)); });
    backdrop.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => backdrop.remove());
    $('[data-delete]', backdrop)?.addEventListener('click', async () => { if (!confirm('删除这台服务器？')) return; try { await api(`/api/servers/${server.id}`, { method:'DELETE' }); state.servers = state.servers.filter((item) => item.id !== server.id); state.serverStatuses.delete(server.id); [...state.tabs.values()].filter((tab) => tab.serverId === server.id).forEach((tab) => closeTab(tab.id)); backdrop.remove(); renderServers(); notify('服务器已删除'); } catch (e) { $('[data-form-error]', backdrop).textContent = e.message; } });
    form.addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); data.authType = authType; data.color = selectedColor; const isVnc = osSelect && osSelect.value === 'windows'; data.protocol = isVnc ? 'vnc' : 'ssh'; data.port = Number(data.port || (isVnc ? 5900 : 22)); if (isVnc) { data.vncPort = String(data.port); data.sftpBridgeEnabled = Boolean($('[name="sftpBridgeEnabled"]', form)?.checked); if (data.sftpBridgeEnabled) { data.sftpBridgePort = Number($('[name="sftpBridgePort"]', form)?.value || 2222); data.sftpBridgeRoot = String($('[name="sftpBridgeRoot"]', form)?.value || 'C:\\').trim() || 'C:\\'; data.sftpBridgeUser = String($('[name="sftpBridgeUser"]', form)?.value || '').trim(); data.sftpBridgeAuth = sftpBridgeAuth; data.sftpBridgePassword = String($('[name="sftpBridgePassword"]', form)?.value || ''); data.sftpBridgePrivateKey = String($('[name="sftpBridgePrivateKey"]', form)?.value || ''); data.sftpBridgePassphrase = String($('[name="sftpBridgePassphrase"]', form)?.value || ''); data.sftpFingerprint = String($('[name="sftpFingerprint"]', form)?.value || '').trim(); } } try { const saved = await api(editing ? `/api/servers/${server.id}` : '/api/servers', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(data) }); if (editing) state.servers = state.servers.map((item) => item.id === saved.id ? saved : item); else state.servers.push(saved); state.serverStatuses.delete(saved.id); backdrop.remove(); renderServers(); refreshServerStatuses(); notify(editing ? '服务器已更新' : '服务器已添加'); } catch (e) { $('[data-form-error]', backdrop).textContent = e.message; } });
  }
  function dismissTabContextMenu() { document.querySelector('.tab-context-menu:not(.tab-server-picker)')?.remove(); }
  function openTabContextMenu(event, tabId) {
    const tab = state.tabs.get(tabId); if (!tab) return;
    dismissTabContextMenu(); dismissServerPicker();
    const menu = document.createElement('div'); menu.className = 'tab-context-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = `<button type="button" data-tab-action="rename"><span>重命名</span><small>修改标签名称</small></button><button type="button" data-tab-action="clone"><span>克隆</span><small>当前服务器与目录</small></button><button type="button" data-tab-action="sftp"><span>SFTP</span><small>打开文件传输</small></button><div class="tab-menu-divider"></div><button type="button" class="danger" data-tab-action="close"><span>关闭</span><small>结束此标签会话</small></button>`;
    menu.style.left = `${event.clientX}px`; menu.style.top = `${event.clientY}px`; document.body.appendChild(menu);
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - bounds.height - 8))}px`;
    menu.onclick = async (clickEvent) => {
      const action = clickEvent.target.closest('[data-tab-action]')?.dataset.tabAction; if (!action) return;
      dismissTabContextMenu();
      if (action === 'rename') { const name = prompt('标签名称', tab.name); if (name?.trim()) { tab.name = name.trim().slice(0, 80); persistSessions(); renderTabs(); } }
      else if (action === 'clone') await cloneTab(tabId);
      else if (action === 'sftp') openTabSftp(tabId);
      else if (action === 'close') closeTab(tabId);
    };
  }
  // Capture copy shortcuts before xterm sees them. Full-screen TUIs such as
  // Codex paint their own selection instead of using xterm's selection model,
  // so a recent mouse drag means the TUI must perform the copy for us.
  document.addEventListener('keydown', (event) => {
    const key = String(event.key || '').toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    const terminalTarget = event.target instanceof Element ? event.target.closest('.terminal, .xterm') : null;
    const view = terminalTarget?.closest('.session');
    const tab = view ? state.tabs.get(view.dataset.sessionId) : null;
    if (!tab?.terminal) return;
    if (event.altKey || !modifier || key !== 'c') { terminalSelectionGesture = null; return; }
    const selection = readTerminalSelection(tab);
    const forceCopy = (event.ctrlKey && event.shiftKey) || (event.metaKey && !event.ctrlKey);
    if (!selection && (hasTerminalSelectionGesture(tab) || (forceCopy && terminalUsesMouseReporting(tab)))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      requestTerminalAppCopy(tab);
      return;
    }
    // Plain Ctrl+C without a selection must keep reaching the shell as SIGINT.
    if (!selection && !forceCopy) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void copyTerminalSelection(tab, selection);
  }, true);
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const screen = event.target.closest('.xterm-screen');
    const view = screen?.closest('.session');
    const tab = view ? state.tabs.get(view.dataset.sessionId) : null;
    if (!tab?.terminal) return;
    terminalPointerDrag = { tabId:tab.id, startX:event.clientX, startY:event.clientY, moved:false, detail:event.detail };
  }, true);
  document.addEventListener('mousemove', (event) => {
    const drag = terminalPointerDrag;
    if (!drag || !(event.buttons & 1) || drag.moved) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4) drag.moved = true;
  }, true);
  document.addEventListener('mouseup', (event) => {
    if (event.button === 2 && event.target instanceof Element && event.target.closest('.terminal, .xterm')) event.stopPropagation();
    if (event.button !== 0 || !terminalPointerDrag) return;
    const drag = terminalPointerDrag; terminalPointerDrag = null;
    const selected = drag.moved || event.detail >= 2 || drag.detail >= 2;
    terminalSelectionGesture = selected ? { tabId:drag.tabId, timestamp:Date.now() } : null;
  }, true);
  document.addEventListener('dblclick', (event) => {
    const screen = event.target instanceof Element ? event.target.closest('.xterm-screen') : null;
    const view = screen?.closest('.session');
    const tab = view ? state.tabs.get(view.dataset.sessionId) : null;
    if (tab?.terminal) terminalSelectionGesture = { tabId:tab.id, timestamp:Date.now() };
  }, true);
  document.addEventListener('wheel', (event) => {
    if (event.target instanceof Element && event.target.closest('.terminal, .xterm')) terminalSelectionGesture = null;
  }, { capture:true, passive:true });
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 2 || !(event.target instanceof Element)) return;
    const terminal = event.target.closest('.terminal, .xterm');
    const view = terminal?.closest('.session');
    const tab = view ? state.tabs.get(view.dataset.sessionId) : null;
    if (!tab) { terminalRightClickSnapshot = null; return; }
    let selection = String(tab.terminal?.getSelection?.() || '');
    if (!selection) {
      try {
        const native = document.getSelection?.();
        if (native && !native.isCollapsed && native.anchorNode && tab.view?.contains(native.anchorNode)) selection = String(native.toString() || '');
      } catch { /* the native selection may not be readable */ }
    }
    terminalRightClickSnapshot = { tabId:tab.id, selection, timestamp:Date.now() };
    // Handle the action on mousedown and consume the event before xterm can
    // forward it to Codex. Waiting for contextmenu leaves a window where the
    // TUI receives the same right click and pastes after we copy.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Date.now() - terminalRightClickHandledAt > 750) {
      terminalRightClickHandledAt = Date.now();
      void handleTerminalContextMenu(event);
    }
  }, true);
  // Handle terminal right clicks before xterm's target listener moves the
  // selection into its hidden textarea. Reading the live xterm selection here
  // makes right-click copy deterministic across Chrome, Safari and Firefox.
  document.addEventListener('contextmenu', (event) => {
    const terminal = event.target instanceof Element ? event.target.closest('.terminal, .xterm') : null;
    if (!terminal) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Date.now() - terminalRightClickHandledAt > 750) handleTerminalContextMenu(event);
  }, true);
  document.addEventListener('contextmenu', (event) => {
    const tab = event.target.closest('.tab[data-tab]');
    if (tab && state.tabs.has(tab.dataset.tab)) { event.preventDefault(); openTabContextMenu(event, tab.dataset.tab); return; }
    dismissTabContextMenu();
    event.preventDefault();
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.tab-context-menu')) { dismissTabContextMenu(); dismissServerPicker(); } });
  window.addEventListener('blur', () => { dismissTabContextMenu(); dismissServerPicker(); if (tabDrag) { const wasDragging = tabDrag.dragging; stopTabDrag(); if (wasDragging) renderTabs(); } });
  window.addEventListener('resize', () => { dismissTabContextMenu(); dismissServerPicker(); updateTabOverflowControls(); if (tabDrag) { const wasDragging = tabDrag.dragging; stopTabDrag(); if (wasDragging) renderTabs(); } });
  // Double-click a server item to edit it.
  document.addEventListener('dblclick', (event) => { const item = event.target.closest('[data-server]'); if (!item) return; const server = state.servers.find((entry) => entry.id === item.dataset.server); if (server) openServerModal(server); });
  function resumeSessions() {
    if (document.hidden) return;
    state.tabs.forEach((tab) => {
      if (tab.manualClose) return;
      if (!tab.ws || tab.ws.readyState > WebSocket.OPEN) { if (tab.reconnectTimer) clearTimeout(tab.reconnectTimer); tab.reconnectTimer = null; tab.reconnectAttempt = 0; connectTab(tab); }
      else if (tab.id === state.activeTab) { fitTerminal(tab); sendResize(tab); }
    });
  }
  // Animated favicon: while any Codex session is working the tab icon spins
  // (a 12-position arc); a prompt waiting for input shows a static amber dot.
  // A 300ms interval keeps the motion smooth enough for a 16x16 icon without
  // redrawing every animation frame.
  function currentRunningCounts() {
    let working = 0;
    let waiting = 0;
    for (const item of state.tabs.values()) {
      if (!item?.connected || !item?.terminal) continue;
      const status = latestCodexStatus(item);
      if (status.codexActive && !status.inputRequired) working += 1;
      else if (status.inputRequired) waiting += 1;
    }
    return { working, waiting };
  }
  function paintRunningFavicon(workingCount, waitingCount, phase) {
    const size = 64;
    const cx = size / 2; const cy = size / 2; const r = 21;
    const ring = '<circle cx="32" cy="32" r="21" fill="none" stroke="#243447" stroke-width="7"/>';
    let arc = '';
    if (workingCount > 0) {
      const sweep = workingCount > 1 ? 216 : 132;
      const step = (360 / 12) * phase;
      const start = (-90 + step) * Math.PI / 180;
      const end = (-90 + step + sweep) * Math.PI / 180;
      const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end); const y2 = cy + r * Math.sin(end);
      arc = `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="#66e3b4" stroke-width="7" stroke-linecap="round"/>`;
    } else if (waitingCount > 0) {
      arc = '<circle cx="32" cy="32" r="10" fill="#ffd166"/>';
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${ring}${arc}</svg>`;
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    let link = document.querySelector('link[data-running-favicon]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/svg+xml'; link.dataset.runningFavicon = ''; document.head.appendChild(link); }
    if (link.href !== url) link.href = url;
  }
  let faviconPhase = 0;
  let faviconBusy = false;
  let faviconIdle = false;
  function renderRunningFavicon(workingCount, waitingCount) {
    const busy = workingCount > 0;
    if (busy === faviconBusy && waitingCount === faviconIdle && !busy) return;
    faviconBusy = busy; faviconIdle = busy ? 0 : waitingCount;
    if (busy) paintRunningFavicon(workingCount, 0, faviconPhase);
    else paintRunningFavicon(0, waitingCount, 0);
  }
  setInterval(() => { if (!faviconBusy || document.hidden) return; faviconPhase = (faviconPhase + 1) % 12; const counts = currentRunningCounts(); if (!counts.working) { renderRunningFavicon(0, counts.waiting); return; } paintRunningFavicon(counts.working, 0, faviconPhase); }, 300);
  paintRunningFavicon(0, 0, 0);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateAttentionTitle(); resumeSessions(); } });
  window.addEventListener('focus', resumeSessions);
  window.addEventListener('online', resumeSessions);
  api('/api/auth/me').then((result) => { if (result.user.mustChangePassword) renderChangePassword(); else return loadWorkspace(); }).catch(() => renderLogin());
})();
