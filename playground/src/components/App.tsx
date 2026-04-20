import { Header }     from './Header.js';
import { LeftPanel }    from './LeftPanel.js';
import { LogPanel }   from './LogPanel.js';
import { RightPanel } from './RightPanel.js';
import { store } from '../store/index.js';
import { PROTOCOLS } from '../protocols/registry.js';
import type { KnownDevice } from '@ainote/protocols';
import type { BleManager } from '../ble/BleManager.js';

interface AppProps {
  bleManager: BleManager;
}

export function App({ bleManager }: AppProps) {
  return (
    <div class="flex flex-col h-screen overflow-hidden bg-base-100 text-base-content">
      <Header
        onScan={() => bleManager.scan()}
        onDisconnect={() => bleManager.disconnect()}
      />
      <div class="flex flex-1 min-h-0">
        <LeftPanel
          onConnectKnown={(entry: KnownDevice) => bleManager.connectKnown(entry)}
          onForgetKnown={(id) => store.persistence.removeKnown(id)}
        />
        <LogPanel />
        <RightPanel />
      </div>
    </div>
  );
}

void PROTOCOLS;
