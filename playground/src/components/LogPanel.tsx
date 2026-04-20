import { useRef, useEffect, useState } from 'preact/hooks';
import { store } from '../store/index.js';
import type { LogEntry, LogEvent } from '../store/log.js';

// ─── UUID helpers ─────────────────────────────────────────────────────────────

const SIG_SERVICES: Record<string, string> = {
  '1800': 'Generic Access',          '1801': 'Generic Attribute',
  '180a': 'Device Information',      '180f': 'Battery Service',
  '1810': 'Blood Pressure',          '1812': 'Human Interface Device',
  '1816': 'Cycling Speed & Cadence', '181a': 'Environmental Sensing',
  'ae00': 'JieLi RCSP',
};

const SIG_CHARS: Record<string, string> = {
  '2a00': 'Device Name',       '2a01': 'Appearance',
  '2a19': 'Battery Level',     '2a24': 'Model Number',
  '2a25': 'Serial Number',     '2a26': 'Firmware Revision',
  '2a27': 'Hardware Revision', '2a28': 'Software Revision',
  '2a29': 'Manufacturer Name', '2a50': 'PnP ID',
  'ae01': 'JieLi Write',       'ae02': 'JieLi Notify',
};

function shortUuid(uuid: string): string | null {
  const m = uuid.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i);
  return m ? m[1]!.toLowerCase() : null;
}

function serviceLabel(uuid: string): string | null {
  const s = shortUuid(uuid);
  return s ? (SIG_SERVICES[s] ?? null) : null;
}

function charLabel(uuid: string): string | null {
  const s = shortUuid(uuid);
  return s ? (SIG_CHARS[s] ?? null) : null;
}

function fmtUuid(uuid: string): string {
  const s = shortUuid(uuid);
  return s ? `0x${s.toUpperCase()}` : uuid;
}

// ─── Raw view ─────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function rawSummary(ev: LogEvent): { dir: string; text: string } {
  switch (ev.kind) {
    case 'frame': {
      const hex = ev.bytes.length ? toHex(ev.bytes) : '';
      return { dir: ev.dir, text: hex + (ev.label ? `  ${ev.label}` : '') };
    }
    case 'connected':    return { dir: '--', text: `Connected to ${ev.name} (${ev.protoLabel})` };
    case 'disconnected': return { dir: '--', text: `${ev.name} disconnected` };
    case 'discovery': {
      const chars = ev.services.reduce((n, s) => n + s.characteristics.length, 0);
      return { dir: '--', text: `Service discovery: ${ev.deviceName} — ${ev.services.length} svc, ${chars} char` };
    }
    case 'info':  return { dir: '--', text: ev.msg };
    case 'error': return { dir: '!!', text: ev.msg };
  }
}

const DIR_BADGE: Record<string, string> = {
  TX: 'badge-info', RX: 'badge-success', '--': 'badge-ghost', '!!': 'badge-error',
};

function RawEntry({ entry }: { entry: LogEntry }) {
  const { text, dir } = rawSummary(entry.event);
  const badge = DIR_BADGE[dir] ?? 'badge-ghost';
  return (
    <div class="flex gap-2 items-baseline py-px hover:bg-base-200/40 rounded px-1">
      <span class="text-base-content/30 shrink-0 tabular-nums">{entry.ts}</span>
      <span class={`badge badge-xs shrink-0 ${badge}`}>{dir}</span>
      <span class="text-base-content/70 break-all min-w-0">{text}</span>
    </div>
  );
}

function RawLog() {
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [store.log.entries.value.length]);

  function onKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(outputRef.current!);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  return (
    <div id="log-output" ref={outputRef} tabIndex={0} onKeyDown={onKeyDown}
      class="flex-1 overflow-y-auto text-xs p-2 leading-relaxed focus:outline-none">
      {store.log.entries.value.map(e => <RawEntry key={e.id} entry={e} />)}
    </div>
  );
}

// ─── Nice view ────────────────────────────────────────────────────────────────

function CenterBubble({ label, sub, ts, color }: { label: string; sub?: string; ts: string; color: string }) {
  return (
    <div class="flex justify-center my-2 px-4 z-10 relative">
      <div class={`rounded-xl px-4 py-2 text-xs text-center max-w-[60%] border ${color}`}>
        <div class="font-semibold">{label}</div>
        {sub && <div class="text-[10px] opacity-60 mt-0.5">{sub}</div>}
        <div class="text-[10px] opacity-40 mt-0.5 tabular-nums">{ts}</div>
      </div>
    </div>
  );
}

function DiscoveryBubble({ ev, ts }: { ev: Extract<LogEvent, { kind: 'discovery' }>; ts: string }) {
  const [open, setOpen] = useState(false);
  const totalChars = ev.services.reduce((n, s) => n + s.characteristics.length, 0);
  const summary = `${ev.services.length} service${ev.services.length !== 1 ? 's' : ''}, ${totalChars} characteristic${totalChars !== 1 ? 's' : ''}`;

  return (
    <div class="flex justify-center my-2 px-4 z-10 relative">
      <div class="rounded-xl border border-base-content/10 bg-base-300/40 text-xs max-w-[70%] w-full overflow-hidden">
        <button
          class="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-base-content/5 transition-colors"
          onClick={() => setOpen(o => !o)}
        >
          <span class="flex-1 font-semibold text-base-content/70">
            Service discovery
            <span class="font-normal text-base-content/35 ml-2">— {ev.deviceName}</span>
          </span>
          <span class="text-base-content/30 text-[10px]">{summary}</span>
          <span class="text-base-content/30 ml-1.5 text-[10px]">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div class="border-t border-base-content/8 px-4 py-3 space-y-3">
            {ev.services.map((svc, si) => {
              const sLabel = serviceLabel(svc.uuid);
              const isLastSvc = si === ev.services.length - 1;
              return (
                <div key={svc.uuid}>
                  <div class="flex items-center gap-1.5">
                    <span class="text-base-content/25 font-mono text-[10px] shrink-0">{isLastSvc ? '└─' : '├─'}</span>
                    <span class="font-mono text-[10px] text-base-content/45">{fmtUuid(svc.uuid)}</span>
                    {sLabel
                      ? <span class="text-[11px] font-semibold text-base-content/70">{sLabel}</span>
                      : <span class="text-[10px] text-base-content/30 italic">Unknown Service</span>}
                    <span class="ml-auto badge badge-xs badge-ghost shrink-0">SVC</span>
                  </div>
                  {svc.characteristics.map((ch, ci) => {
                    const cLabel = charLabel(ch.uuid);
                    const isLastCh = ci === svc.characteristics.length - 1;
                    const indent = isLastSvc ? '    ' : '│   ';
                    return (
                      <div key={ch.uuid} class="flex items-center gap-1.5 mt-1">
                        <span class="text-base-content/15 font-mono text-[10px] shrink-0 whitespace-pre">{indent}{isLastCh ? '└─' : '├─'}</span>
                        <span class="font-mono text-[10px] text-base-content/35">{fmtUuid(ch.uuid)}</span>
                        {cLabel
                          ? <span class="text-[10px] text-base-content/55">{cLabel}</span>
                          : <span class="text-[10px] text-base-content/25 italic">Unknown</span>}
                        <span class="ml-auto text-[10px] text-base-content/25 shrink-0">[{ch.properties.join(', ')}]</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        <div class="px-4 pb-2 text-[10px] text-base-content/20 tabular-nums">{ts}</div>
      </div>
    </div>
  );
}

const VERBOSE_INFO_RE = /^\[BLE\]|^scanning for|^reconnecting|^".*" not pre-granted/i;

function NiceEntry({ entry }: { entry: LogEntry }) {
  const { event, ts } = entry;
  switch (event.kind) {
    case 'connected':
      return <CenterBubble label={`Connected to ${event.name}`} sub={event.protoLabel} ts={ts} color="bg-success/10 text-success border-success/25" />;
    case 'disconnected':
      return <CenterBubble label={`${event.name} disconnected`} ts={ts} color="bg-error/10 text-error/70 border-error/20" />;
    case 'discovery':
      return <DiscoveryBubble ev={event} ts={ts} />;
    case 'frame': {
      const isTx = event.dir === 'TX';
      const display = event.label || '(no label)';
      const bubble = (
        <div class={`rounded-xl px-3 py-2 text-xs max-w-[42%] relative z-10 ${isTx ? 'bg-info/15 text-info border border-info/20' : 'bg-success/15 text-success border border-success/20'}`}>
          <div class="font-semibold leading-snug break-words">{display}</div>
          <div class="text-[10px] opacity-35 mt-0.5 tabular-nums">{ts}</div>
        </div>
      );
      return (
        <div class="flex w-full my-0.5">
          <div class="w-1/2 flex justify-end pr-4">{isTx ? bubble : null}</div>
          <div class="w-1/2 flex justify-start pl-4">{!isTx ? bubble : null}</div>
        </div>
      );
    }
    case 'info':
      if (VERBOSE_INFO_RE.test(event.msg)) return null;
      return (
        <div class="flex justify-center my-0.5 z-10 relative">
          <span class="text-[10px] px-2.5 py-0.5 rounded-full bg-base-300 text-base-content/40">{event.msg}</span>
        </div>
      );
    case 'error':
      return (
        <div class="flex justify-center my-0.5 z-10 relative">
          <span class="text-[10px] px-2.5 py-0.5 rounded-full bg-base-300 text-error">{event.msg}</span>
        </div>
      );
  }
}

function NiceLog() {
  const bottomRef = useRef<HTMLDivElement>(null);
  const entries = store.log.entries.value;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [entries.length]);

  return (
    <div class="flex-1 overflow-y-auto flex flex-col min-h-0">
      <div class="flex w-full sticky top-0 z-20 bg-base-100/80 backdrop-blur border-b border-base-content/5">
        <div class="w-1/2 text-[10px] font-semibold uppercase tracking-wider text-info/60 text-center py-1.5">TX</div>
        <div class="w-1/2 text-[10px] font-semibold uppercase tracking-wider text-success/60 text-center py-1.5">RX</div>
      </div>
      <div class="relative flex flex-col flex-1 py-2">
        <div class="absolute inset-y-0 left-1/2 w-px bg-base-300/70 -translate-x-1/2 pointer-events-none" />
        {entries.length === 0 && (
          <p class="text-xs text-base-content/25 text-center py-8">No frames yet.</p>
        )}
        {entries.map(e => <NiceEntry key={e.id} entry={e} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── LogPanel ─────────────────────────────────────────────────────────────────

export function LogPanel() {
  const [tab, setTab] = useState<'raw' | 'nice'>('raw');
  return (
    <section class="flex-1 flex flex-col overflow-hidden border-x border-base-content/10">
      <div class="flex items-center gap-1 px-2 h-10 bg-base-200 border-b border-base-content/10 shrink-0">
        <div role="tablist" class="tabs tabs-border tabs-xs flex-1">
          <button role="tab" class={`tab tab-xs${tab === 'raw' ? ' tab-active' : ''}`} onClick={() => setTab('raw')}>Raw</button>
          <button role="tab" class={`tab tab-xs${tab === 'nice' ? ' tab-active' : ''}`} onClick={() => setTab('nice')}>Nice</button>
        </div>
        <button class="btn btn-xs btn-ghost" onClick={() => store.log.clear()}>Clear</button>
      </div>
      {tab === 'raw' ? <RawLog /> : <NiceLog />}
    </section>
  );
}
