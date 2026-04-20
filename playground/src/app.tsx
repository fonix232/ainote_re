import './style.css';

// Restore theme before first paint
const savedTheme = localStorage.getItem('ainote:theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

import { render } from 'preact';
import { App }        from './components/App.js';
import { BleManager } from './ble/BleManager.js';
import { PROTOCOLS }  from './protocols/registry.js';
import { store } from './store/index.js';

if (!navigator.bluetooth) store.log.error('Web Bluetooth is not available. Use Chrome or Edge.');

const bleManager = new BleManager(PROTOCOLS);

render(<App bleManager={bleManager} />, document.getElementById('app')!);
