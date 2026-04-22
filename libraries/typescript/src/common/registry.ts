import type { Protocol } from './protocol.js';

export class ProtocolRegistry {
  private readonly _protocols = new Map<string, Protocol>();

  register(id: string, protocol: Protocol): this {
    this._protocols.set(id, protocol);
    return this;
  }

  get(id: string): Protocol | undefined {
    return this._protocols.get(id);
  }

  has(id: string): boolean {
    return this._protocols.has(id);
  }

  all(): Protocol[] {
    return [...this._protocols.values()];
  }

  entries(): [string, Protocol][] {
    return [...this._protocols.entries()];
  }

  ids(): string[] {
    return [...this._protocols.keys()];
  }
}
