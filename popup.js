// HumanType popup controller

let useTypos    = true;
let useDebugger = true;

// Convert slider 0-100 → timing config
// Exponential: 0 = 260ms/char (~28 WPM), 100 = 18ms/char (~300 WPM)
function sliderToConfig(val) {
  const base   = Math.round(260 * Math.pow(18 / 260, val / 100));
  const t      = val / 100;
  const varMin = 0.70 - t * 0.28; // 0.70 → 0.42
  const varMax = 2.90 - t * 1.00; // 2.90 → 1.90
  return { base, varMin, varMax };
}

function sliderToWpm(val) {
  const base = Math.round(260 * Math.pow(18 / 260, val / 100));
  return Math.round(7000 / base);
}
let pollingTimer     = null;

// ─── Chrome helpers ───────────────────────────────────────────────────────────

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendMsg(msg) {
  try {
    const tab = await activeTab();
    if (!tab?.id) return null;
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return null;
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function setStatus(text, type = 'idle') {
  $('status-bar').className = `status-bar ${type}`;
  $('status-text').textContent = text;
}

function showView(name) {
  $('view-setup').classList.toggle('hidden',    name !== 'setup');
  $('view-controls').classList.toggle('hidden', name !== 'controls');
}

function applyState(status, position, total) {
  const pct   = total > 0 ? Math.round((position / total) * 100) : 0;
  const pause = $('pause-btn');

  switch (status) {
    case 'armed':
      showView('controls');
      setStatus('Armed — click a text field', 'armed');
      $('cta-click').classList.remove('hidden');
      $('progress-wrap').classList.add('hidden');
      pause.disabled = true;
      pause.textContent = 'Pause';
      break;
    case 'typing':
      showView('controls');
      setStatus(`Typing… ${pct}%`, 'typing');
      $('cta-click').classList.add('hidden');
      $('progress-wrap').classList.remove('hidden');
      $('progress-fill').style.width   = `${pct}%`;
      $('progress-chars').textContent  = `${position} / ${total}`;
      $('progress-pct').textContent    = `${pct}%`;
      pause.disabled    = false;
      pause.textContent = 'Pause';
      break;
    case 'paused':
      showView('controls');
      setStatus(`Paused at ${pct}%`, 'paused');
      $('cta-click').classList.add('hidden');
      $('progress-wrap').classList.remove('hidden');
      $('progress-fill').style.width   = `${pct}%`;
      $('progress-chars').textContent  = `${position} / ${total}`;
      $('progress-pct').textContent    = `${pct}%`;
      pause.disabled    = false;
      pause.textContent = 'Resume';
      break;
    case 'done':
      showView('setup'); setStatus('Done!', 'done'); stopPolling(); break;
    case 'stopped':
      showView('setup'); setStatus('Stopped', 'stopped'); stopPolling(); break;
    default:
      showView('setup'); setStatus('Ready', 'idle'); stopPolling();
  }
}

// ─── Toggle helper ────────────────────────────────────────────────────────────

function wireToggle(id, onChange) {
  const btn = $(id);
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    onChange(next);
  });
}

// ─── Polling ─────────────────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  pollingTimer = setInterval(async () => {
    const r = await sendMsg({ action: 'STATUS' });
    if (r) applyState(r.status, r.position, r.total);
  }, 700);
}

function stopPolling() {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // Speed slider
  const slider     = $('speed-slider');
  const wpmDisplay = $('speed-wpm-display');

  function updateSlider() {
    const val = Number(slider.value);
    slider.style.setProperty('--fill', `${val}%`);
    wpmDisplay.textContent = `~${sliderToWpm(val)} WPM`;
  }
  slider.addEventListener('input', updateSlider);
  updateSlider(); // init

  // Toggles
  wireToggle('typo-toggle',     v => { useTypos    = v; });
  wireToggle('debugger-toggle', v => { useDebugger = v; });

  // Char counter
  const textarea  = $('text-input');
  const charCount = $('char-count');
  textarea.addEventListener('input', () => {
    const n = textarea.value.length;
    charCount.textContent = `${n.toLocaleString()} character${n !== 1 ? 's' : ''}`;
    textarea.classList.remove('error');
    if (!['armed','typing','paused'].includes(currentStatus())) setStatus('Ready', 'idle');
  });

  // Clear
  $('clear-btn').addEventListener('click', () => {
    textarea.value = '';
    charCount.textContent = '0 characters';
    textarea.focus();
    setStatus('Ready', 'idle');
  });

  // Start
  $('start-btn').addEventListener('click', async () => {
    const text = textarea.value;
    if (!text.trim()) {
      textarea.classList.add('error');
      textarea.focus();
      setTimeout(() => textarea.classList.remove('error'), 600);
      return;
    }
    const tab = await activeTab();
    if (!tab?.id) { setStatus('Cannot reach page — refresh and try again', 'stopped'); return; }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch {
      setStatus('Cannot reach page — refresh and try again', 'stopped');
      return;
    }
    const speedConfig = sliderToConfig(Number($('speed-slider').value));
    const r = await sendMsg({ action: 'ARM', text, speedConfig, useDebugger, useTypos });
    if (r?.ok) {
      applyState('armed', 0, text.length);
      startPolling();
    } else {
      setStatus('Cannot reach page — refresh and try again', 'stopped');
    }
  });

  // Pause / Resume
  $('pause-btn').addEventListener('click', async () => {
    const btn = $('pause-btn');
    await sendMsg({ action: btn.textContent === 'Pause' ? 'PAUSE' : 'RESUME' });
    const r = await sendMsg({ action: 'STATUS' });
    if (r) applyState(r.status, r.position, r.total);
  });

  // Stop
  $('stop-btn').addEventListener('click', async () => {
    await sendMsg({ action: 'STOP' });
    stopPolling();
    applyState('stopped', 0, 0);
  });

  // Restore state on open
  const r = await sendMsg({ action: 'STATUS' });
  if (r) {
    applyState(r.status, r.position, r.total);
    if (['armed','typing','paused'].includes(r.status)) startPolling();
  }
});

function currentStatus() {
  return $('status-bar').className.replace('status-bar ', '').trim();
}
