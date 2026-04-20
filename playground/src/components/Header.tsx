import { useState, useEffect } from 'preact/hooks';
import { store } from '../store/index.js';

const THEMES = [
  'night', 'dark', 'dim', 'dracula', 'synthwave', 'cyberpunk',
  'black', 'luxury', 'coffee',
  'light', 'cupcake', 'nord', 'winter', 'lofi',
];

const STORAGE_KEY = 'ainote:theme';

function getStoredTheme(): string {
  return localStorage.getItem(STORAGE_KEY) ?? 'night';
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

function SettingsDropdown() {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  function pick(t: string) {
    setTheme(t);
    // close dropdown by blurring the active element
    (document.activeElement as HTMLElement | null)?.blur();
  }

  return (
    <div class="dropdown dropdown-end">
      <button tabIndex={0} class="btn btn-sm btn-ghost" title="Settings">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div tabIndex={0} class="dropdown-content menu bg-base-200 border border-base-content/10 rounded-box shadow-lg w-44 p-1 z-50 mt-1">
        <p class="text-[10px] uppercase tracking-wider text-base-content/30 px-3 py-1 font-semibold">Theme</p>
        {THEMES.map(t => (
          <button
            key={t}
            class={`flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm text-left hover:bg-base-content/10 transition-colors ${
              t === theme ? 'text-primary font-semibold' : 'text-base-content'
            }`}
            onClick={() => pick(t)}
          >
            <span
              class="w-3 h-3 rounded-full border border-base-content/20 shrink-0"
              data-theme={t}
              style={{ background: 'oklch(var(--p))' }}
            />
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

interface HeaderProps {
  onScan: () => void;
  onDisconnect: () => void;
}

export function Header({ onScan, onDisconnect }: HeaderProps) {
  const s      = store.connection.state.value;
  const isIdle = s === 'idle';
  const isConn = s === 'connected';

  const statusLabel = s === 'idle'
    ? 'Disconnected'
    : s === 'scanning'
    ? 'Scanning\u2026'
    : store.connection.label.value;

  const dotClass = s === 'connected'
    ? 'bg-success shadow-success/50 shadow-md'
    : s === 'scanning'
    ? 'bg-warning animate-pulse'
    : 'bg-base-content/20';

  return (
    <div class="navbar bg-base-300 border-b border-base-content/10 min-h-12 px-4 shrink-0 z-10">
      <div class="navbar-start items-center gap-3">
        <span class={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
        <span class="font-semibold tracking-tight">AI Note Workshop</span>
      </div>
      <div class="navbar-center">
        <span class="text-sm text-base-content/50">{statusLabel}</span>
      </div>
      <div class="navbar-end gap-2">
        <button class="btn btn-sm btn-primary" disabled={!isIdle} onClick={onScan}>
          Scan &amp; Connect
        </button>
        <button class="btn btn-sm btn-error btn-outline" disabled={!isConn} onClick={onDisconnect}>
          Disconnect
        </button>
        <SettingsDropdown />
      </div>
    </div>
  );
}
