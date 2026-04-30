// HumanType — typing engine
if (window.__ht_init) { /* already loaded */ }
else {
window.__ht_init = true;

const state = {
  status:      'idle',
  text:        '',
  speedConfig: { base: 75, varMin: 0.55, varMax: 2.4 },
  position:    0,
  targetEl:    null,
  useDebugger: false,
  useTypos:    false,
  autoPaused:  false, // paused by focus loss, not by user
};

// Nearby keys on a QWERTY layout for realistic typo substitution
const NEARBY = {
  a:['q','s','z'], b:['v','g','n'], c:['x','d','v'], d:['s','e','f','c'],
  e:['w','r','d'], f:['d','r','g','v'], g:['f','t','h','b'], h:['g','y','j','n'],
  i:['u','o','k'], j:['h','u','k','m'], k:['j','i','l'], l:['k','o','p'],
  m:['n','j'], n:['b','h','m'], o:['i','p','l'], p:['o','l'],
  q:['w','a'], r:['e','t','f'], s:['a','w','d','x'], t:['r','y','g'],
  u:['y','i','j'], v:['c','f','b'], w:['q','e','s'], x:['z','s','c'],
  y:['t','u','h'], z:['a','x'],
};

const TYPO_RATE   = 0.028; // ~2.8% chance per alphabetic char
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Gaussian random ──────────────────────────────────────────────────────────

function gaussian(min, max) {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return min + Math.max(0, Math.min(1, (n + 3) / 6)) * (max - min);
}

function charDelay(char, prev, cfg, burst) {
  if (burst) return Math.round(cfg.base * 0.28 * (0.7 + Math.random() * 0.6));
  let d = cfg.base * gaussian(cfg.varMin, cfg.varMax);
  if ('.!?'.includes(prev))      d *= 5 + Math.random() * 7;
  else if (',;:'.includes(prev)) d *= 1.8 + Math.random() * 2.2;
  else if (prev === '\n')        d *= 3 + Math.random() * 4;
  else if (prev === ' ' && Math.random() < 0.10) d *= 2.5 + Math.random();
  if (char !== char.toLowerCase() && char === char.toUpperCase()) d += 20 + Math.random() * 40;
  if (char === '\n') d *= 2 + Math.random() * 2;
  return Math.round(d);
}

// ─── Element detection ────────────────────────────────────────────────────────

const SKIP_TYPES = new Set(['checkbox','radio','button','submit','reset','file','image','range','color']);

function isTextInput(el) {
  return el.tagName === 'INPUT' && !SKIP_TYPES.has((el.type || '').toLowerCase());
}

function findEditable(el) {
  let cur = el;
  while (cur && cur !== document.documentElement) {
    if (cur.tagName === 'TEXTAREA') return cur;
    if (isTextInput(cur))           return cur;
    if (cur.isContentEditable)      return cur;
    cur = cur.parentElement;
  }
  return null;
}

// ─── Character insertion ──────────────────────────────────────────────────────

// Send a char to background for trusted CDP injection
function dbgType(char) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'DBG_TYPE', char }, res => {
      resolve(res?.ok ?? false);
    });
  });
}

function dbgDetach() {
  chrome.runtime.sendMessage({ action: 'DBG_DETACH' });
}

async function insertChar(char) {
  if (state.useDebugger) {
    return dbgType(char);
  }

  if (window.location.hostname === 'docs.google.com') return insertGoogleDocs(char);

  const el = state.targetEl || document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return false;
  if (document.activeElement !== el) el.focus();

  if (el.tagName === 'TEXTAREA' || isTextInput(el)) return insertInInput(el, char);
  if (el.isContentEditable) return insertInContentEditable(el, char);
  return false;
}

async function backspaceChar() {
  if (state.useDebugger) {
    return dbgType('\b');
  }

  if (window.location.hostname === 'docs.google.com') {
    const iframe = document.querySelector('.docs-texteventtarget-iframe');
    if (iframe) {
      try {
        iframe.focus();
        const doc = iframe.contentDocument;
        const opts = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true };
        doc.body.dispatchEvent(new KeyboardEvent('keydown', opts));
        doc.body.dispatchEvent(new KeyboardEvent('keyup',   { ...opts, cancelable: false }));
      } catch {}
    }
    return;
  }

  const el = state.targetEl || document.activeElement;
  if (!el) return;

  if (el.tagName === 'TEXTAREA' || isTextInput(el)) {
    if (document.execCommand('delete')) return;
    const s = el.selectionStart ?? el.value.length;
    if (s > 0) {
      el.value = el.value.slice(0, s - 1) + el.value.slice(s);
      el.setSelectionRange(s - 1, s - 1);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    return;
  }

  if (el.isContentEditable) {
    document.execCommand('delete');
  }
}

function insertInInput(el, char) {
  el.focus();
  if (document.execCommand('insertText', false, char)) return true;
  const s = el.selectionStart ?? el.value.length;
  const e = el.selectionEnd   ?? el.value.length;
  el.value = el.value.slice(0, s) + char + el.value.slice(e);
  el.setSelectionRange(s + 1, s + 1);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
  return true;
}

function insertInContentEditable(el, char) {
  el.focus();
  if (document.execCommand('insertText', false, char)) return true;
  const sel = window.getSelection();
  if (!sel) return false;
  if (!sel.rangeCount) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = char === '\n' ? document.createElement('br') : document.createTextNode(char);
  range.insertNode(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
  return true;
}

function insertGoogleDocs(char) {
  const iframe = document.querySelector('.docs-texteventtarget-iframe');
  if (!iframe) return false;
  try {
    const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iDoc?.body) return false;
    iframe.focus();
    iDoc.body.focus();
    if (char === '\n') {
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      iDoc.body.dispatchEvent(new KeyboardEvent('keydown',  opts));
      iDoc.body.dispatchEvent(new KeyboardEvent('keyup',    { ...opts, cancelable: false }));
      return true;
    }
    const cc = char.charCodeAt(0);
    const uc = char.toUpperCase().charCodeAt(0);
    const sh = char !== char.toLowerCase();
    const co = /[a-zA-Z]/.test(char) ? `Key${char.toUpperCase()}` : /[0-9]/.test(char) ? `Digit${char}` : 'Unidentified';
    iDoc.body.dispatchEvent(new KeyboardEvent('keydown',  { key: char, code: co, keyCode: uc, which: uc, shiftKey: sh, bubbles: true, cancelable: true }));
    iDoc.body.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: co, keyCode: cc, which: cc, charCode: cc, shiftKey: sh, bubbles: true, cancelable: true }));
    iDoc.execCommand('insertText', false, char);
    iDoc.body.dispatchEvent(new KeyboardEvent('keyup',    { key: char, code: co, keyCode: uc, which: uc, shiftKey: sh, bubbles: true }));
    return true;
  } catch { return false; }
}

// ─── Typo simulation ──────────────────────────────────────────────────────────

async function maybeTypo(char, cfg) {
  if (!state.useTypos) return false;
  const lower = char.toLowerCase();
  const pool  = NEARBY[lower];
  if (!pool || Math.random() > TYPO_RATE) return false;

  // Pick an adjacent wrong key, preserve case
  const wrong = pool[Math.floor(Math.random() * pool.length)];
  const wrongChar = char === char.toUpperCase() && char !== char.toLowerCase() ? wrong.toUpperCase() : wrong;

  // Type the wrong character
  await insertChar(wrongChar);
  // Pause — simulating the moment you notice the mistake
  await sleep(280 + Math.random() * 420);
  // Delete it
  await backspaceChar();
  await sleep(60 + Math.random() * 90);

  return true; // caller should now type the correct char
}

// ─── Badge ────────────────────────────────────────────────────────────────────

let $badge = null;

function badge(html, accent = '#888') {
  if (!$badge) {
    $badge = document.createElement('div');
    $badge.id = '__ht__';
    Object.assign($badge.style, {
      position: 'fixed', bottom: '20px', right: '20px',
      background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '10px',
      padding: '9px 15px',
      fontFamily: '"SF Mono","Fira Code",Consolas,monospace', fontSize: '12px', lineHeight: '1.5',
      zIndex: '2147483647', boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      transition: 'opacity 0.2s, transform 0.2s', pointerEvents: 'none', userSelect: 'none', maxWidth: '300px',
    });
    (document.body || document.documentElement).appendChild($badge);
  }
  $badge.style.color = accent;
  $badge.style.borderColor = accent + '33';
  $badge.style.opacity = '1';
  $badge.style.transform = 'translateY(0)';
  $badge.innerHTML = html;
}

function hideBadge() {
  if (!$badge) return;
  $badge.style.opacity = '0';
  $badge.style.transform = 'translateY(10px)';
  setTimeout(() => { $badge?.remove(); $badge = null; }, 250);
}

// ─── Typing loop ──────────────────────────────────────────────────────────────

async function runTyping() {
  const cfg  = state.speedConfig;
  const text = state.text;
  let burst = false, burstN = 0, burstLen = 0;

  for (let i = state.position; i < text.length; i++) {
    if (state.status === 'stopped') { cleanup(); return; }

    while (state.status === 'paused') {
      badge('⏸&nbsp; <b>Paused</b>', '#f59e0b');
      await sleep(150);
    }
    if (state.status !== 'typing') { cleanup(); return; }

    const char = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    const pct  = Math.round(((i + 1) / text.length) * 100);
    const left = text.length - i - 1;

    badge(`✍&nbsp; <b>${pct}%</b> &nbsp;<span style="opacity:.4">${left} left</span>`, '#4ade80');

    // Burst mode
    if (!burst && Math.random() < 0.045) { burst = true; burstLen = 3 + Math.floor(Math.random() * 5); burstN = 0; }
    if (burst && ++burstN >= burstLen)   { burst = false; await sleep(cfg.base * (1.2 + Math.random() * 1.5)); }

    // Typo chance (only on alpha, not in burst)
    if (!burst) await maybeTypo(char, cfg);

    await insertChar(char);
    state.position = i + 1;
    syncState();

    await sleep(charDelay(char, prev, cfg, burst));
  }

  state.status = 'done';
  state.position = 0;
  syncState();
  badge('✓&nbsp; <b>Done!</b>', '#4ade80');
  setTimeout(() => { hideBadge(); cleanup(); }, 2500);
}

function cleanup() {
  if (state.useDebugger) dbgDetach();
  state.targetEl = null;
}

// ─── Arming ───────────────────────────────────────────────────────────────────

let clickHandler = null;

function armTyping(text, speedConfig, useDebugger, useTypos) {
  state.text        = text;
  state.speedConfig = speedConfig;
  state.position    = 0;
  state.status      = 'armed';
  state.useDebugger = useDebugger;
  state.useTypos    = useTypos;
  state.targetEl    = null;
  syncState();

  badge('🎯&nbsp; <b>Ready</b> &nbsp;<span style="opacity:.4">click a text field to start</span>', '#f59e0b');

  if (clickHandler) document.removeEventListener('click', clickHandler, true);

  clickHandler = (e) => {
    const onGoogleDocs = window.location.hostname === 'docs.google.com';
    const editable     = findEditable(e.target);

    if (editable || onGoogleDocs) {
      document.removeEventListener('click', clickHandler, true);
      clickHandler = null;
      state.targetEl = editable || null;
      state.status   = 'typing';
      syncState();
      setTimeout(runTyping, 300);
    }
  };

  document.addEventListener('click', clickHandler, true);
}

// ─── State sync ───────────────────────────────────────────────────────────────

function syncState() {
  try {
    chrome.storage.session.set({
      ht: { status: state.status, position: state.position, total: state.text.length }
    });
  } catch {}
}

// ─── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case 'ARM':
      armTyping(msg.text, msg.speedConfig, msg.useDebugger, msg.useTypos);
      sendResponse({ ok: true });
      break;
    case 'PAUSE':
      if (state.status === 'typing') { state.status = 'paused'; syncState(); }
      sendResponse({ ok: true });
      break;
    case 'RESUME':
      if (state.status === 'paused') { state.status = 'typing'; syncState(); }
      sendResponse({ ok: true });
      break;
    case 'STOP':
      state.status = 'stopped';
      if (clickHandler) { document.removeEventListener('click', clickHandler, true); clickHandler = null; }
      hideBadge();
      cleanup();
      syncState();
      sendResponse({ ok: true });
      break;
    case 'STATUS':
      sendResponse({ status: state.status, position: state.position, total: state.text.length });
      break;
  }
  return true;
});

// ─── Focus / visibility guard ─────────────────────────────────────────────────

function onLostFocus() {
  if (state.status === 'typing') {
    state.status     = 'paused';
    state.autoPaused = true;
    syncState();
    badge('⚠️&nbsp; <b>Paused</b> &nbsp;<span style="opacity:.4">come back to this window to resume</span>', '#f59e0b');
  }
}

function onGainedFocus() {
  if (state.status === 'paused' && state.autoPaused) {
    state.status     = 'typing';
    state.autoPaused = false;
    syncState();
  }
}

// Covers: switching tabs, minimizing, clicking another window
window.addEventListener('blur',  onLostFocus);
window.addEventListener('focus', onGainedFocus);

// Covers: switching tabs + minimizing as a second signal (belt-and-suspenders)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onLostFocus();
  else onGainedFocus();
});
} // end __ht_init guard
