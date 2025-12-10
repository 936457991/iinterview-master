import { ElectronAPI } from '@electron-toolkit/preload'

interface API {
  getPlatform: () => string
  isDev: () => boolean
  onTriggerSyncContent: (callback: () => void) => void
  offTriggerSyncContent: (callback: () => void) => void
  getOpacity: () => Promise<number>
  setOpacity: (opacity: number) => Promise<number>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
