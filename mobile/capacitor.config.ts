import type { CapacitorConfig } from '@capacitor/cli'

// Companion mobile shell. Wraps the built web app in a native iOS/Android container.
// `appId` and `appName` here are compile-time — they set the App Store / Play Store identity.
// Runtime UI branding (name, logo, colors) is driven by the web app's BrandProvider
// and can be swapped per-tenant without a rebuild.
//
// To rebuild for a white-labeled tenant, override appId/appName here and rebuild.
const config: CapacitorConfig = {
  appId: 'com.wingcaster.app',
  appName: 'Wingcaster',
  webDir: '../web/dist',
  server: {
    // In dev, uncomment to point the shell at the running Vite dev server on the same LAN.
    // url: 'http://192.168.1.10:7100',
    // cleartext: true,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0F0F0F',
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
    },
  },
}

export default config
