import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // 如果未来需要从渲染进程控制窗口，可以在这里添加 IPC 通信方法
  // 目前所有快捷键都在主进程处理，渲染进程无需额外 API
  
  // 获取平台信息，用于显示正确的快捷键说明
  getPlatform: () => process.platform,
  
  // 检查是否是开发环境
  isDev: () => process.env.NODE_ENV === 'development',
  
  // 监听同步内容触发事件（从主进程的全局快捷键）
  onTriggerSyncContent: (callback: () => void) => {
    // 先移除所有旧的监听器，确保只有一个监听器
    ipcRenderer.removeAllListeners('trigger-sync-content')
    ipcRenderer.on('trigger-sync-content', callback)
    console.log('🔧 [Preload] 已注册 trigger-sync-content 监听器')
  },
  
  // 移除同步内容监听器
  offTriggerSyncContent: (callback: () => void) => {
    ipcRenderer.off('trigger-sync-content', callback)
    console.log('🔧 [Preload] 已移除 trigger-sync-content 监听器')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
