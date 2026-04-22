// ── Commands ──────────────────────────────────────────────────────────────────

export type CommandCategory =
  | 'debug'
  | 'info'
  | 'recording'
  | 'transfer'
  | 'settings'
  | 'dangerous';

export interface Command {
  readonly label: string;
  readonly category?: CommandCategory;
}

export interface CommandAction extends Command {
  readonly fn: () => Promise<void>;
  readonly confirm?: boolean;
}

export interface CommandToggle extends Command {
  readonly kind: 'toggle';
  get: () => boolean | null;
  set: (on: boolean) => Promise<void>;
  readonly onLabel?: string;
  readonly offLabel?: string;
}

export interface CommandSelect extends Command {
  readonly kind: 'select';
  get: () => number | string | null;
  set: (value: number | string) => Promise<void>;
  readonly options: Record<string | number, string>;
}

export type AnyCommand = CommandAction | CommandToggle | CommandSelect;

/** @deprecated Use CommandAction */ export type DebugCommand = CommandAction;
/** @deprecated Use CommandToggle */ export type DebugToggle = CommandToggle;
/** @deprecated Use CommandSelect */ export type DebugSelect = CommandSelect;
/** @deprecated Use AnyCommand */ export type AnyDebugCommand = AnyCommand;
