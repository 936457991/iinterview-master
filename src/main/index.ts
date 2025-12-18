import { app, shell, BrowserWindow, BrowserView, ipcMain, globalShortcut, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// 全局变量
let mainWindow: BrowserWindow | null = null
let externalEditorView: BrowserView | null = null
let externalEditorUrl: string | null = null
let externalEditorInsets = { top: 0, right: 0, bottom: 0, left: 0 }
let isMouseThrough = false
const MOVE_STEP = 50
const SIZE_STEP = 50
function updateExternalEditorBounds(insets?: { top?: number; right?: number; bottom?: number; left?: number }) {
  if (!mainWindow || !externalEditorView) return
  const { top, right, bottom, left } = {
    ...externalEditorInsets,
    ...(insets || {})
  }
  const contentBounds = mainWindow.getContentBounds()
  const safeTop = Math.max(0, Math.min(top ?? 0, contentBounds.height))
  const safeBottom = Math.max(0, Math.min(bottom ?? 0, contentBounds.height - safeTop))
  const safeLeft = Math.max(0, Math.min(left ?? 0, contentBounds.width))
  const safeRight = Math.max(0, Math.min(right ?? 0, contentBounds.width - safeLeft))
  externalEditorView.setBounds({
    x: safeLeft,
    y: safeTop,
    width: Math.max(0, contentBounds.width - safeLeft - safeRight),
    height: Math.max(0, contentBounds.height - safeTop - safeBottom)
  })
  externalEditorView.setAutoResize({ width: true, height: true })
}

function resetWebContentsZoom(wc: Electron.WebContents | null | undefined) {
  if (!wc) return
  try {
    wc.setZoomFactor(1)
    wc.setZoomLevel(0)
    const anyWc: any = wc as any
    if (typeof anyWc.setVisualZoomLevelLimits === 'function') {
      try {
        const ret = anyWc.setVisualZoomLevelLimits(1, 1)
        if (ret && typeof ret.catch === 'function') ret.catch(() => {})
      } catch {}
    }
  } catch {}
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: true,
    autoHideMenuBar: true,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    alwaysOnTop: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.setContentProtection(true)

  // Windows 平台特殊处理：确保窗口真正置顶
  // 需要在窗口创建后再次调用 setAlwaysOnTop，并使用 'screen-saver' 级别
  if (process.platform === 'win32') {
    // 使用 screen-saver 级别确保在 Windows 上真正置顶
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    console.log('🪟 Windows 平台：窗口置顶已启用（screen-saver 级别）')
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 窗口大小变化时同步 BrowserView 尺寸
  mainWindow.on('resize', () => updateExternalEditorBounds())
  mainWindow.on('maximize', () => updateExternalEditorBounds())
  mainWindow.on('unmaximize', () => updateExternalEditorBounds())

  // 🔍 强制重置 UI 缩放（解决“整个 UI 被放大且重启仍不生效”——Chromium 会持久化 zoomLevel）
  const resetUiZoom = () => {
    if (!mainWindow) return
    try {
      resetWebContentsZoom(mainWindow.webContents)
      console.log('🔎 UI zoom reset to 100% and locked')
    } catch (e) {
      console.warn('🔎 Failed to reset/lock UI zoom:', e)
    }
  }

  mainWindow.webContents.on('did-finish-load', resetUiZoom)
  mainWindow.webContents.on('did-navigate', resetUiZoom)
  mainWindow.webContents.on('did-navigate-in-page', resetUiZoom)
  mainWindow.webContents.on('zoom-changed', () => resetUiZoom())

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({mode:'detach'})
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
        // mainWindow.webContents.openDevTools({mode:'detach'})

  }

  // 注册快捷键
  registerGlobalShortcuts()
}

// 注册全局快捷键
function registerGlobalShortcuts(): void {
  try {
    const executeInActiveWebContents = (js: string) => {
      const wc = externalEditorView?.webContents ?? mainWindow?.webContents
      if (!wc) return
      wc.executeJavaScript(js).catch(() => {})
    }

    // Cmd + B: 显示/隐藏窗口
    globalShortcut.register('CommandOrControl+B', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    })

    // Cmd + [: 降低透明度（更透明）
    globalShortcut.register('CommandOrControl+[', () => {
      if (mainWindow) {
        const currentOpacity = mainWindow.getOpacity()
        const newOpacity = Math.max(0.1, currentOpacity - 0.1)
        mainWindow.setOpacity(newOpacity)
        console.log(`透明度设置为: ${newOpacity}`)
      }
    })

    // Cmd + ]: 提高透明度（更不透明）
    globalShortcut.register('CommandOrControl+]', () => {
      if (mainWindow) {
        const currentOpacity = mainWindow.getOpacity()
        const newOpacity = Math.min(1.0, currentOpacity + 0.1)
        mainWindow.setOpacity(newOpacity)
        console.log(`透明度设置为: ${newOpacity}`)
      }
    })

    // 窗口移动快捷键
    // Cmd + ↑: 向上移动
    globalShortcut.register('CommandOrControl+Up', () => {
      if (mainWindow) {
        const [x, y] = mainWindow.getPosition()
        mainWindow.setPosition(x, Math.max(0, y - MOVE_STEP))
      }
    })

    // Cmd + ↓: 向下移动
    globalShortcut.register('CommandOrControl+Down', () => {
      if (mainWindow) {
        const [x, y] = mainWindow.getPosition()
        const display = screen.getPrimaryDisplay()
        const maxY = display.workAreaSize.height - mainWindow.getBounds().height
        mainWindow.setPosition(x, Math.min(maxY, y + MOVE_STEP))
      }
    })

    // Cmd + ←: 向左移动
    globalShortcut.register('CommandOrControl+Left', () => {
      if (mainWindow) {
        const [x, y] = mainWindow.getPosition()
        mainWindow.setPosition(Math.max(0, x - MOVE_STEP), y)
      }
    })

    // Cmd + →: 向右移动
    globalShortcut.register('CommandOrControl+Right', () => {
      if (mainWindow) {
        const [x, y] = mainWindow.getPosition()
        const display = screen.getPrimaryDisplay()
        const maxX = display.workAreaSize.width - mainWindow.getBounds().width
        mainWindow.setPosition(Math.min(maxX, x + MOVE_STEP), y)
      }
    })

    // 窗口大小调整快捷键
    // Cmd + Option + ↑: 增加高度
    globalShortcut.register('CommandOrControl+Alt+Up', () => {
      if (mainWindow) {
        const [width, height] = mainWindow.getSize()
        const display = screen.getPrimaryDisplay()
        const maxHeight = display.workAreaSize.height
        const newHeight = Math.min(maxHeight, height + SIZE_STEP)
        mainWindow.setSize(width, newHeight)
      }
    })

    // Cmd + Option + ↓: 减少高度
    globalShortcut.register('CommandOrControl+Alt+Down', () => {
      if (mainWindow) {
        const [width, height] = mainWindow.getSize()
        const newHeight = Math.max(200, height - SIZE_STEP)
        mainWindow.setSize(width, newHeight)
      }
    })

    // Cmd + Option + ←: 减少宽度
    globalShortcut.register('CommandOrControl+Alt+Left', () => {
      if (mainWindow) {
        const [width, height] = mainWindow.getSize()
        const newWidth = Math.max(300, width - SIZE_STEP)
        mainWindow.setSize(newWidth, height)
      }
    })

    // Cmd + Option + →: 增加宽度
    globalShortcut.register('CommandOrControl+Alt+Right', () => {
      if (mainWindow) {
        const [width, height] = mainWindow.getSize()
        const display = screen.getPrimaryDisplay()
        const maxWidth = display.workAreaSize.width
        const newWidth = Math.min(maxWidth, width + SIZE_STEP)
        mainWindow.setSize(newWidth, height)
      }
    })

    // Cmd + Option + X: 切换鼠标穿透模式
    globalShortcut.register('CommandOrControl+Alt+X', () => {
      if (mainWindow) {
        isMouseThrough = !isMouseThrough
        mainWindow.setIgnoreMouseEvents(isMouseThrough)
        
        if (isMouseThrough) {
          // 开启穿透时：设置为最顶层并稍微透明作为视觉提示
          console.log('🔓 鼠标穿透模式: 开启 (窗口保持最顶层)')
          console.log('💡 提示: 可使用键盘滚动快捷键控制Monaco编辑器:')
          console.log('   - Ctrl/Cmd + Shift + 方向键: Monaco编辑器基础滚动')
          console.log('   - Ctrl/Cmd + Alt + Shift + 方向键: Monaco编辑器快速滚动')
          console.log('   - Ctrl/Cmd + Shift + Home/End: 滚动到顶部/底部')
          
          // 通知渲染进程显示穿透模式指示器
          mainWindow.webContents.send('mouse-through-mode-changed', true)
        } else {
          // 关闭穿透时：取消最顶层并恢复完全不透明
          console.log('🔒 鼠标穿透模式: 关闭')
          
          // 通知渲染进程隐藏穿透模式指示器
          mainWindow.webContents.send('mouse-through-mode-changed', false)
        }
      }
    })

    // Cmd + Option + T: 切换窗口置顶状态
    globalShortcut.register('CommandOrControl+Alt+T', () => {
      if (mainWindow) {
        const isCurrentlyOnTop = mainWindow.isAlwaysOnTop()
        const newState = !isCurrentlyOnTop
        
        // Windows 平台使用 screen-saver 级别确保真正置顶
        if (process.platform === 'win32') {
          mainWindow.setAlwaysOnTop(newState, newState ? 'screen-saver' : 'normal')
          console.log(`🪟 Windows 窗口置顶: ${newState ? '开启 (screen-saver级别)' : '关闭'}`)
        } else {
          mainWindow.setAlwaysOnTop(newState)
          console.log(`窗口置顶: ${newState ? '开启' : '关闭'}`)
        }
      }
    })

    // 键盘滚动快捷键 - 基础滚动（增大滚动量以提高响应性）
    const SCROLL_AMOUNT = 150  // 从 50 增加到 150
    const FAST_SCROLL_AMOUNT = 500  // 从 200 增加到 500

    const wheelScrollActive = (deltaX: number, deltaY: number) => {
      if (externalEditorView) {
        try {
          externalEditorView.webContents.focus()
          externalEditorView.webContents.sendInputEvent({
            type: 'mouseWheel',
            deltaX,
            deltaY,
            canScroll: true
          } as any)
          return
        } catch {}
      }
      // fallback: 走渲染层 JS 滚动
      executeInActiveWebContents(`
        window.scrollBy(${deltaX}, ${deltaY})
      `)
    }

    // Cmd/Ctrl + Shift + ↑: Monaco编辑器向上滚动
    globalShortcut.register('CommandOrControl+Shift+Up', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(0, -SCROLL_AMOUNT)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollTop(Math.max(0, window.monacoEditorInstance.getScrollTop() - ${SCROLL_AMOUNT})) :
              window.scrollBy(0, -${SCROLL_AMOUNT})
          `)
        }
      }
    })

    // Cmd/Ctrl + Shift + ↓: Monaco编辑器向下滚动
    globalShortcut.register('CommandOrControl+Shift+Down', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(0, SCROLL_AMOUNT)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollTop(window.monacoEditorInstance.getScrollTop() + ${SCROLL_AMOUNT}) :
              window.scrollBy(0, ${SCROLL_AMOUNT})
          `)
        }
      }
    })

    // Cmd/Ctrl + Shift + ←: Monaco编辑器向左滚动
    globalShortcut.register('CommandOrControl+Shift+Left', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(-SCROLL_AMOUNT, 0)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollLeft(Math.max(0, window.monacoEditorInstance.getScrollLeft() - ${SCROLL_AMOUNT})) :
              window.scrollBy(-${SCROLL_AMOUNT}, 0)
          `)
        }
      }
    })

    // Cmd/Ctrl + Shift + →: Monaco编辑器向右滚动
    globalShortcut.register('CommandOrControl+Shift+Right', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(SCROLL_AMOUNT, 0)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollLeft(window.monacoEditorInstance.getScrollLeft() + ${SCROLL_AMOUNT}) :
              window.scrollBy(${SCROLL_AMOUNT}, 0)
          `)
        }
      }
    })

    // 快速滚动快捷键
    // Cmd/Ctrl + Alt + Shift + ↑: 快速向上滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Up', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(0, -FAST_SCROLL_AMOUNT)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollTop(Math.max(0, window.monacoEditorInstance.getScrollTop() - ${FAST_SCROLL_AMOUNT})) :
              window.scrollBy(0, -${FAST_SCROLL_AMOUNT})
          `)
        }
      }
    })

    // Cmd/Ctrl + Alt + Shift + ↓: 快速向下滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Down', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(0, FAST_SCROLL_AMOUNT)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollTop(window.monacoEditorInstance.getScrollTop() + ${FAST_SCROLL_AMOUNT}) :
              window.scrollBy(0, ${FAST_SCROLL_AMOUNT})
          `)
        }
      }
    })

    // Cmd/Ctrl + Alt + Shift + ←: 快速向左滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Left', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(-FAST_SCROLL_AMOUNT, 0)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollLeft(Math.max(0, window.monacoEditorInstance.getScrollLeft() - ${FAST_SCROLL_AMOUNT})) :
              window.scrollBy(-${FAST_SCROLL_AMOUNT}, 0)
          `)
        }
      }
    })

    // Cmd/Ctrl + Alt + Shift + →: 快速向右滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Right', () => {
      if (mainWindow) {
        if (externalEditorView) {
          wheelScrollActive(FAST_SCROLL_AMOUNT, 0)
        } else {
          executeInActiveWebContents(`
            window.monacoEditorInstance ? 
              window.monacoEditorInstance.setScrollLeft(window.monacoEditorInstance.getScrollLeft() + ${FAST_SCROLL_AMOUNT}) :
              window.scrollBy(${FAST_SCROLL_AMOUNT}, 0)
          `)
        }
      }
    })

    // 页面跳转快捷键
    // Cmd/Ctrl + Shift + Home: 滚动到顶部
    globalShortcut.register('CommandOrControl+Shift+Home', () => {
      if (mainWindow) {
        executeInActiveWebContents(`
          window.monacoEditorInstance ? 
            window.monacoEditorInstance.setScrollTop(0) :
            window.scrollTo(0, 0)
        `)
      }
    })

    // Cmd/Ctrl + Shift + End: 滚动到底部
    globalShortcut.register('CommandOrControl+Shift+End', () => {
      if (mainWindow) {
        executeInActiveWebContents(`
          window.monacoEditorInstance ? 
            window.monacoEditorInstance.setScrollTop(window.monacoEditorInstance.getScrollHeight()) :
            window.scrollTo(0, document.body.scrollHeight)
        `)
      }
    })

    // Cmd/Ctrl + Shift + PageUp: 向上滚动一页
    globalShortcut.register('CommandOrControl+Shift+PageUp', () => {
      if (mainWindow) {
        executeInActiveWebContents(`
          window.monacoEditorInstance ? 
            window.monacoEditorInstance.setScrollTop(Math.max(0, window.monacoEditorInstance.getScrollTop() - window.monacoEditorInstance.getLayoutInfo().height * 0.8)) :
            window.scrollBy(0, -window.innerHeight * 0.8)
        `)
      }
    })

    // Cmd/Ctrl + Shift + PageDown: 向下滚动一页
    globalShortcut.register('CommandOrControl+Shift+PageDown', () => {
      if (mainWindow) {
        executeInActiveWebContents(`
          window.monacoEditorInstance ? 
            window.monacoEditorInstance.setScrollTop(window.monacoEditorInstance.getScrollTop() + window.monacoEditorInstance.getLayoutInfo().height * 0.8) :
            window.scrollBy(0, window.innerHeight * 0.8)
        `)
      }
    })

    // Cmd/Ctrl + Shift + ": 触发同步内容（全局快捷键）
    globalShortcut.register('CommandOrControl+Shift+\'', () => {
      if (mainWindow) {
        console.log('🎹 全局快捷键 Cmd+Shift+" 被触发，发送同步请求到渲染进程')
        mainWindow.webContents.send('trigger-sync-content')
      }
    })

    // Cmd/Ctrl + =: 增大字体
    globalShortcut.register('CommandOrControl+=', () => {
      if (mainWindow) {
        console.log('📝 增大字体')
        mainWindow.webContents.send('increase-font-size')
      }
    })

    // Cmd/Ctrl + -: 减小字体
    globalShortcut.register('CommandOrControl+-', () => {
      if (mainWindow) {
        console.log('📝 减小字体')
        mainWindow.webContents.send('decrease-font-size')
      }
    })

    // Cmd/Ctrl + 0: 重置字体大小
    globalShortcut.register('CommandOrControl+0', () => {
      if (mainWindow) {
        console.log('📝 重置字体大小')
        mainWindow.webContents.send('reset-font-size')
      }
    })

    console.log('全局快捷键注册成功')
    console.log('⌨️ Monaco编辑器键盘滚动快捷键（主进程）:')
    console.log('  基础滚动: Ctrl/Cmd + Shift + 方向键 (50px)')
    console.log('  快速滚动: Ctrl/Cmd + Alt + Shift + 方向键 (200px)')
    console.log('  页面跳转: Ctrl/Cmd + Shift + Home/End/PageUp/PageDown')
    console.log('  💡 优先控制Monaco编辑器，无编辑器时回退到窗口滚动')
    console.log('📝 字体大小调整: Ctrl/Cmd + +/- (增大/减小), Ctrl/Cmd + 0 (重置)')
  } catch (error) {
    console.error('注册快捷键失败:', error)
  }
}

// Allow multiple instances for testing
app.requestSingleInstanceLock = () => true;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers
  ipcMain.on('ping', () => console.log('pong'))
  
  // 外部编辑器（共享代码链接）嵌入：主进程创建 BrowserView 加载 URL，避免 iframe 被 X-Frame-Options/CSP 阻止
  ipcMain.handle('external-editor:set', async (_event, payload: { url: string; topOffset?: number; top?: number; right?: number; bottom?: number; left?: number }) => {
    if (!mainWindow) return false
    const url = payload?.url
    if (!url || typeof url !== 'string') return false

    // 只要 URL 不变，就不要重建 BrowserView（避免“工具箱/参数变化导致页面刷新”）
    if (!externalEditorView) {
      externalEditorView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        } as any
      })
      mainWindow.setBrowserView(externalEditorView)
    }

    // 兼容旧字段 topOffset，同时支持四边 insets
    externalEditorInsets = {
      top: payload?.top ?? (payload?.topOffset ?? 0),
      right: payload?.right ?? 0,
      bottom: payload?.bottom ?? 0,
      left: payload?.left ?? 0
    }
    updateExternalEditorBounds(externalEditorInsets)

    resetWebContentsZoom(externalEditorView.webContents)

    // 外链统一走系统浏览器
    externalEditorView.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    externalEditorView.webContents.on('did-finish-load', () => resetWebContentsZoom(externalEditorView?.webContents))
    externalEditorView.webContents.on('did-navigate', () => resetWebContentsZoom(externalEditorView?.webContents))
    externalEditorView.webContents.on('zoom-changed', () => resetWebContentsZoom(externalEditorView?.webContents))

    if (externalEditorUrl !== url) {
      externalEditorUrl = url
      await externalEditorView.webContents.loadURL(url)
    }
    return true
  })

  ipcMain.handle('external-editor:clear', async () => {
    if (!mainWindow) return true
    try {
      if (externalEditorView) {
        mainWindow.setBrowserView(null)
        try { (externalEditorView.webContents as any).destroy?.() } catch {}
        externalEditorView = null
      }
    } catch {}
    externalEditorInsets = { top: 0, right: 0, bottom: 0, left: 0 }
    externalEditorUrl = null
    return true
  })
  
  // 获取当前穿透模式状态
  ipcMain.handle('get-mouse-through-mode', () => {
    console.log('📡 主进程：获取穿透模式状态请求，当前状态:', isMouseThrough)
    return isMouseThrough
  })
  
  // 透明度相关 IPC 处理器
  ipcMain.handle('get-opacity', () => {
    if (mainWindow) {
      const opacity = mainWindow.getOpacity()
      console.log('📡 主进程：获取透明度请求，当前透明度:', opacity)
      return opacity
    }
    return 1.0
  })
  
  ipcMain.handle('set-opacity', (_event, opacity: number) => {
    if (mainWindow) {
      const clampedOpacity = Math.max(0.1, Math.min(1.0, opacity))
      mainWindow.setOpacity(clampedOpacity)
      console.log('📡 主进程：设置透明度为:', clampedOpacity)
      return clampedOpacity
    }
    return 1.0
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // 清理全局快捷键
  globalShortcut.unregisterAll()
  
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理快捷键
app.on('before-quit', () => {
  globalShortcut.unregisterAll()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
