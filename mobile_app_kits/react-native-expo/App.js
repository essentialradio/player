import React, { useRef } from 'react';
import { SafeAreaView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

/**
 * Minimal Expo app that loads your radio site.
 * Replace SITE_URL with your production URL or a local dev tunnel.
 */
const SITE_URL = 'https://essential.radio'; // or your hosted player URL

export default function App() {
  const webRef = useRef(null);

  // iOS background audio: ensure playback starts after user interaction in the web app.
  // For advanced lock-screen controls/notifications, add a native player or plugins later.

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0c0f' }}>
      <WebView
        ref={webRef}
        source={{ uri: SITE_URL }}
        mediaPlaybackRequiresUserAction={true}
        allowsInlineMediaPlayback={true}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        originWhitelist={['*']}
        style={{ flex: 1 }}
      />
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </SafeAreaView>
  );
}
