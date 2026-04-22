export interface ActiveTransfer {
  fileId: string;
  sizeBytes: number | null;
  totalReceived: number;
  onProgress: ((rx: number, total: number) => void) | null;
  resolve: (data: Uint8Array, raw: Uint8Array) => void;
  reject: (e: Error) => void;
}
