import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.peatlink.app',
  appName: 'PeatLink',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
