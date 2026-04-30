// HumanType background service worker — Chrome Debugger API

const attached = new Set();

// ─── Attach / detach ─────────────────────────────────────────────────────────

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attached.add(tabId);
}

async function detach(tabId) {
  if (!attached.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  attached.delete(tabId);
}

// ─── Key code helpers ─────────────────────────────────────────────────────────

function getVKCode(char) {
  const u = char.toUpperCase();
  if (/[A-Z]/.test(u)) return u.charCodeAt(0);
  if (/[0-9]/.test(char)) return char.charCodeAt(0);
  return ({
    ' ':32, '`':192,'~':192, '-':189,'_':189, '=':187,'+':187,
    '[':219,'{':219, ']':221,'}':221, '\\':220,'|':220,
    ';':186,':':186, "'":222,'"':222, ',':188,'<':188,
    '.':190,'>':190, '/':191,'?':191,
    '!':49,'@':50,'#':51,'$':52,'%':53,'^':54,'&':55,'*':56,'(':57,')':48,
  })[char] ?? char.charCodeAt(0);
}

function getCode(char) {
  const u = char.toUpperCase();
  if (/[A-Z]/.test(u)) return `Key${u}`;
  if (/[0-9]/.test(char)) return `Digit${char}`;
  return ({
    ' ':'Space', '`':'Backquote','~':'Backquote',
    '-':'Minus','_':'Minus', '=':'Equal','+':'Equal',
    '[':'BracketLeft','{':'BracketLeft', ']':'BracketRight','}':'BracketRight',
    '\\':'Backslash','|':'Backslash', ';':'Semicolon',':':'Semicolon',
    "'":"Quote",'"':"Quote", ',':'Comma','<':'Comma', '.':'Period','>':'Period',
    '/':'Slash','?':'Slash',
    '!':'Digit1','@':'Digit2','#':'Digit3','$':'Digit4','%':'Digit5',
    '^':'Digit6','&':'Digit7','*':'Digit8','(':'Digit9',')':'Digit0',
  })[char] ?? 'Unidentified';
}

const SHIFT_CHARS = new Set('~!@#$%^&*()_+{}|:"<>?ABCDEFGHIJKLMNOPQRSTUVWXYZ');

async function send(tabId, params) {
  return chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', params);
}

// ─── Dispatch a single character via CDP ──────────────────────────────────────

async function typeChar(tabId, char) {
  if (char === '\n') {
    await send(tabId, { type: 'rawKeyDown', key: 'Return',    code: 'Enter',     windowsVirtualKeyCode: 13 });
    await send(tabId, { type: 'keyUp',      key: 'Return',    code: 'Enter',     windowsVirtualKeyCode: 13 });
    return;
  }
  if (char === '\b') {
    await send(tabId, { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send(tabId, { type: 'keyUp',      key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    return;
  }

  const shift = SHIFT_CHARS.has(char);
  const mods  = shift ? 8 : 0;
  const vk    = getVKCode(char);
  const code  = getCode(char);

  await send(tabId, { type: 'rawKeyDown', key: char, code, windowsVirtualKeyCode: vk, modifiers: mods });
  await send(tabId, { type: 'char',       key: char, text: char, unmodifiedText: char.toLowerCase(), modifiers: mods });
  await send(tabId, { type: 'keyUp',      key: char, code, windowsVirtualKeyCode: vk, modifiers: mods });
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.action === 'DBG_TYPE') {
    if (!tabId) { sendResponse({ ok: false }); return true; }
    ensureAttached(tabId)
      .then(() => typeChar(tabId, msg.char))
      .then(() => sendResponse({ ok: true }))
      .catch(e  => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.action === 'DBG_DETACH') {
    const id = tabId ?? msg.tabId;
    if (id) detach(id).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});

// Clean up when a tab closes or navigates away
chrome.tabs.onRemoved.addListener(tabId => detach(tabId));
chrome.debugger.onDetach.addListener(({ tabId }) => attached.delete(tabId));
