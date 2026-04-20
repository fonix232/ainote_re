import { useSignal } from '@preact/signals';
import type { KnownDevice as KnownDeviceEntry, AnyDebugCommand, CommandCategory } from '@ainote/protocols';
import { store } from '../store/index.js';
import { PROTOCOLS } from '../protocols/registry.js';
import { activeProto } from '../protocols/registry.js';

interface LeftPanelProps {
  onConnectKnown: (entry: KnownDeviceEntry) => void;
  onForgetKnown: (id: string) => void;
}

export function LeftPanel({ onConnectKnown, onForgetKnown }: LeftPanelProps) {
  const s      = store.connection.state.value;
  const isConn = s === 'connected';
  const proto  = activeProto.value;
  const tiles  = proto?.stateTiles?.value ?? {};
  const collapsed = useSignal(false);

  const TILE_ORDER = ['Name', 'Battery', 'Charging', 'Storage', 'Version', 'Files',
                      'Recording', 'Last Rec', 'Time'];
  const tileEntries: [string, string][] = [
    ...TILE_ORDER.filter(k => k in tiles).map(k => [k, tiles[k]!] as [string, string]),
    ...Object.entries(tiles).filter(([k]) => !TILE_ORDER.includes(k)),
  ];
  const cmds = proto?.commands ?? [];

  const CMD_SECTIONS: { cat: CommandCategory; label: string; danger?: true }[] = [
    { cat: 'info',      label: 'Info'      },
    { cat: 'recording', label: 'Recording' },
    { cat: 'transfer',  label: 'Transfer'  },
    { cat: 'settings',  label: 'Settings'  },
    { cat: 'debug',     label: 'Debug'     },
    { cat: 'dangerous', label: 'Dangerous', danger: true },
  ];

  return (
    <aside class={`${collapsed.value ? 'w-8' : 'w-56'} shrink-0 flex flex-col overflow-y-auto bg-base-200 border-r border-base-content/10 transition-[width] duration-200`}>

      {/* Header row */}
      <div class="px-1 h-10 flex items-center border-b border-base-content/10 shrink-0 gap-1">
        {!collapsed.value && (
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1 pl-2">Device</span>
        )}
        <button
          class="btn btn-ghost btn-xs ml-auto"
          title={collapsed.value ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => { collapsed.value = !collapsed.value; }}
        >{collapsed.value ? '›' : '‹'}</button>
      </div>

      {!collapsed.value && <div class="flex flex-col gap-3 p-3 flex-1">

        {/* Idle hint */}
        {!isConn && (
          <p class="text-xs text-base-content/40 leading-relaxed">
            Use <strong class="text-base-content/60">Scan &amp; Connect</strong> in the header to find a device.
          </p>
        )}

        {/* Device name + protocol */}
        {isConn && (
          <div>
            <div class="font-semibold text-sm leading-tight">{store.connection.label.value || '—'}</div>
            <div class="text-xs text-base-content/40 mt-0.5">{proto?.label ?? '—'}</div>
          </div>
        )}

        {/* State tiles */}
        {isConn && tileEntries.length > 0 && (
          <div>
            <div class="divider divider-start text-xs text-base-content/30 my-0">State</div>
            <div class="grid grid-cols-2 gap-1 mt-2">
              {tileEntries.map(([k, v]) => <StateTile key={k} label={k} value={v} />)}
            </div>
          </div>
        )}

        {/* Commands */}
        {isConn && cmds.length > 0 && CMD_SECTIONS.map(({ cat, label, danger }) => {
          const section = cmds.filter(c => (c.category ?? 'debug') === cat);
          if (section.length === 0) return null;
          return <CommandSection key={cat} label={label} cmds={section} danger={danger} />;
        })}

      </div>}

      {!collapsed.value && <div class="hidden">
        {store.persistence.knownDevices.value.map(entry => (
          <KnownDeviceRow
            key={entry.id}
            entry={entry}
            disabled={!isConn}
            onConnect={() => onConnectKnown(entry)}
            onForget={() => onForgetKnown(entry.id)}
          />
        ))}
      </div>}

    </aside>
  );
}

function StateTile({ label, value }: { label: string; value: string }) {
  const isStorage = /storage|free|used/i.test(label);
  const storageMatch = isStorage ? value.match(/^([\d.]+)\s*\/\s*([\d.]+)/) : null;
  const usedPct = storageMatch
    ? Math.min(1, parseFloat(storageMatch[1]!) / parseFloat(storageMatch[2]!))
    : null;

  return (
    <div class={`bg-base-300/60 rounded-lg p-2 ${isStorage ? 'col-span-2' : ''}`}>
      <div class="text-xs text-base-content/40 uppercase tracking-wide leading-none mb-1">{label}</div>
      <div class="text-sm font-mono font-medium">{value}</div>
      {usedPct !== null && (
        <progress class="progress progress-primary w-full h-1 mt-1.5" value={Math.round(usedPct * 100)} max={100} />
      )}
    </div>
  );
}

function CommandSection({ label, cmds, danger }: { label: string; cmds: AnyDebugCommand[]; danger?: boolean }) {
  const open = useSignal(false);
  const headerCls = danger
    ? 'text-error/70 hover:text-error'
    : 'text-base-content/30 hover:text-base-content/60';
  return (
    <div>
      <button
        class={`divider divider-start text-xs my-0 w-full cursor-pointer select-none ${headerCls}`}
        onClick={() => { open.value = !open.value; }}
      >{label} {open.value ? '⌄' : '›'}</button>
      {open.value && (
        <div class="flex flex-col gap-1.5 mt-2">
          {cmds.map(cmd => <CmdCard key={cmd.label} cmd={cmd} danger={danger} />)}
        </div>
      )}
    </div>
  );
}

function CmdCard({ cmd, danger }: { cmd: AnyDebugCommand; danger?: boolean }) {
  if ('kind' in cmd && cmd.kind === 'toggle') return <CmdToggle cmd={cmd} />;
  if ('kind' in cmd && cmd.kind === 'select') return <CmdSelect cmd={cmd} />;
  return <CmdButton cmd={cmd} danger={danger} />;
}

function CmdButton({ cmd, danger }: { cmd: import('@ainote/protocols').DebugCommand; danger?: boolean }) {
  async function onClick() {
    if (cmd.confirm && !confirm(`Send "${cmd.label}"?`)) return;
    try { await cmd.fn(); }
    catch (err) { store.log.error((err as Error).message); }
  }
  const cls = danger ? 'btn btn-xs btn-outline btn-error w-full' : 'btn btn-xs btn-outline w-full';
  return (
    <button class={cls} onClick={onClick}>{cmd.label}</button>
  );
}

function CmdToggle({ cmd }: { cmd: import('@ainote/protocols').DebugToggle }) {
  const busy    = useSignal(false);
  const current = cmd.get();
  const isOn    = current === true;

  async function toggle() {
    if (busy.value) return;
    busy.value = true;
    try { await cmd.set(!isOn); }
    catch (err) { store.log.error((err as Error).message); }
    finally { busy.value = false; }
  }

  return (
    <div class="flex items-center gap-2 px-0.5">
      <span class="text-xs flex-1 truncate" title={cmd.label}>{cmd.label}</span>
      <input
        type="checkbox"
        class="toggle toggle-xs toggle-primary"
        checked={isOn}
        disabled={busy.value || current === null}
        onChange={toggle}
      />
    </div>
  );
}

function CmdSelect({ cmd }: { cmd: import('@ainote/protocols').DebugSelect }) {
  const busy    = useSignal(false);
  const current = cmd.get();

  async function onChange(e: Event) {
    if (busy.value) return;
    const raw        = (e.target as HTMLSelectElement).value;
    const allNumeric = Object.keys(cmd.options).every(k => !isNaN(Number(k)));
    const value      = allNumeric ? Number(raw) : raw;
    busy.value = true;
    try { await cmd.set(value); }
    catch (err) { store.log.error((err as Error).message); }
    finally { busy.value = false; }
  }

  return (
    <div class="flex flex-col gap-1">
      <span class="text-xs text-base-content/50">{cmd.label}</span>
      <select
        class="select select-xs w-full"
        value={current === null ? '' : String(current)}
        onChange={onChange}
        disabled={busy.value}
      >
        {current === null && <option value="" disabled>—</option>}
        {Object.entries(cmd.options).map(([val, name]) => (
          <option key={val} value={val}>{name}</option>
        ))}
      </select>
    </div>
  );
}

interface KnownDeviceRowProps {
  entry: KnownDeviceEntry;
  disabled: boolean;
  onConnect: () => void;
  onForget: () => void;
}

function KnownDeviceRow({ entry, disabled, onConnect, onForget }: KnownDeviceRowProps) {
  const proto = PROTOCOLS[entry.protocolId];
  return (
    <div class="flex items-center gap-2 px-2 py-1.5">
      <div class="flex-1 min-w-0">
        <div class="text-sm truncate">{entry.name}</div>
        <div class="text-xs text-base-content/40">{proto?.label ?? entry.protocolId}</div>
      </div>
      <button class="btn btn-xs btn-ghost" disabled={disabled} onClick={onConnect} title="Reconnect">↗</button>
      <button class="btn btn-xs btn-ghost text-error" onClick={onForget} title="Forget">✕</button>
    </div>
  );
}
