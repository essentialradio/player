import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uk.ac.essentialradio.app',
  appName: 'Essential Radio',
  webDir: 'web',
  bundledWebRuntime: false,
  server: {
    // Uncomment to debug using a live dev server:
    // url: 'http://YOUR_LAN_IP:5173',
    // cleartext: true
  }
};

export default config;
