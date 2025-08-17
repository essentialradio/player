import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uk.ac.essentialradio.app',   // reverse-DNS, unique
  appName: 'Essential Radio',
  webDir: 'web',                       // your built site folder
  bundledWebRuntime: false,
  server: {
    // Uncomment for live debugging:
    // url: 'http://YOUR_LAN_IP:5173',
    // cleartext: true
  }
};

export default config;
