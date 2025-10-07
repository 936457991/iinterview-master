import { app, shell, BrowserWindow, ipcMain, globalShortcut, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// 全局变量
let mainWindow: BrowserWindow | null = null
let isMouseThrough = false
const MOVE_STEP = 50
const SIZE_STEP = 50

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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

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
        mainWindow.setAlwaysOnTop(!isCurrentlyOnTop)
        console.log(`窗口置顶: ${!isCurrentlyOnTop ? '开启' : '关闭'}`)
      }
    })

    // 键盘滚动快捷键 - 基础滚动
    const SCROLL_AMOUNT = 50
    const FAST_SCROLL_AMOUNT = 200

    // Cmd/Ctrl + Shift + ↑: Monaco编辑器向上滚动
    globalShortcut.register('CommandOrControl+Shift+Up', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            // 尝试找到Monaco编辑器实例
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              // 获取全局的Monaco编辑器实例
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollTop = editor.getScrollTop();
                editor.setScrollTop(Math.max(0, scrollTop - ${SCROLL_AMOUNT}));
                return 'Monaco编辑器向上滚动';
              }
            }
            // 如果没有Monaco编辑器，则滚动窗口
            window.scrollBy(0, -${SCROLL_AMOUNT});
            return '窗口向上滚动';
          })()
        `).then(result => console.log(`⬆️ ${result} ${SCROLL_AMOUNT}px`))
      }
    })

    // Cmd/Ctrl + Shift + ↓: Monaco编辑器向下滚动
    globalShortcut.register('CommandOrControl+Shift+Down', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollTop = editor.getScrollTop();
                editor.setScrollTop(scrollTop + ${SCROLL_AMOUNT});
                return 'Monaco编辑器向下滚动';
              }
            }
            window.scrollBy(0, ${SCROLL_AMOUNT});
            return '窗口向下滚动';
          })()
        `).then(result => console.log(`⬇️ ${result} ${SCROLL_AMOUNT}px`))
      }
    })

    // Cmd/Ctrl + Shift + ←: Monaco编辑器向左滚动
    globalShortcut.register('CommandOrControl+Shift+Left', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollLeft = editor.getScrollLeft();
                editor.setScrollLeft(Math.max(0, scrollLeft - ${SCROLL_AMOUNT}));
                return 'Monaco编辑器向左滚动';
              }
            }
            window.scrollBy(-${SCROLL_AMOUNT}, 0);
            return '窗口向左滚动';
          })()
        `).then(result => console.log(`⬅️ ${result} ${SCROLL_AMOUNT}px`))
      }
    })

    // Cmd/Ctrl + Shift + →: Monaco编辑器向右滚动
    globalShortcut.register('CommandOrControl+Shift+Right', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollLeft = editor.getScrollLeft();
                editor.setScrollLeft(scrollLeft + ${SCROLL_AMOUNT});
                return 'Monaco编辑器向右滚动';
              }
            }
            window.scrollBy(${SCROLL_AMOUNT}, 0);
            return '窗口向右滚动';
          })()
        `).then(result => console.log(`➡️ ${result} ${SCROLL_AMOUNT}px`))
      }
    })

    // 快速滚动快捷键
    // Cmd/Ctrl + Alt + Shift + ↑: 快速向上滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Up', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollTop = editor.getScrollTop();
                editor.setScrollTop(Math.max(0, scrollTop - ${FAST_SCROLL_AMOUNT}));
                return 'Monaco编辑器快速向上滚动';
              }
            }
            window.scrollBy(0, -${FAST_SCROLL_AMOUNT});
            return '窗口快速向上滚动';
          })()
        `).then(result => console.log(`⬆️⬆️ ${result} ${FAST_SCROLL_AMOUNT}px`))
      }
    })

    // Cmd/Ctrl + Alt + Shift + ↓: 快速向下滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Down', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollTop = editor.getScrollTop();
                editor.setScrollTop(scrollTop + ${FAST_SCROLL_AMOUNT});
                return 'Monaco编辑器快速向下滚动';
              }
            }
            window.scrollBy(0, ${FAST_SCROLL_AMOUNT});
            return '窗口快速向下滚动';
          })()
        `).then(result => console.log(`⬇️⬇️ ${result} ${FAST_SCROLL_AMOUNT}px`))
      }
    })

    // Cmd/Ctrl + Alt + Shift + ←: 快速向左滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Left', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollLeft = editor.getScrollLeft();
                editor.setScrollLeft(Math.max(0, scrollLeft - ${FAST_SCROLL_AMOUNT}));
                return 'Monaco编辑器快速向左滚动';
              }
            }
            window.scrollBy(-${FAST_SCROLL_AMOUNT}, 0);
            return '窗口快速向左滚动';
          })()
        `).then(result => console.log(`⬅️⬅️ ${result} ${FAST_SCROLL_AMOUNT}px`))
      }
    })

    // Cmd/Ctrl + Alt + Shift + →: 快速向右滚动
    globalShortcut.register('CommandOrControl+Alt+Shift+Right', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const editorElements = document.querySelectorAll('.monaco-editor');
            if (editorElements.length > 0) {
              if (window.monacoEditorInstance) {
                const editor = window.monacoEditorInstance;
                const scrollLeft = editor.getScrollLeft();
                editor.setScrollLeft(scrollLeft + ${FAST_SCROLL_AMOUNT});
                return 'Monaco编辑器快速向右滚动';
              }
            }
            window.scrollBy(${FAST_SCROLL_AMOUNT}, 0);
            return '窗口快速向右滚动';
          })()
        `).then(result => console.log(`➡️➡️ ${result} ${FAST_SCROLL_AMOUNT}px`))
      }
    })

    // 页面跳转快捷键
    // Cmd/Ctrl + Shift + Home: 滚动到顶部
    globalShortcut.register('CommandOrControl+Shift+Home', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript('window.scrollTo(0, 0)')
        console.log('🔝 滚动到顶部')
      }
    })

    // Cmd/Ctrl + Shift + End: 滚动到底部
    globalShortcut.register('CommandOrControl+Shift+End', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')
        console.log('🔚 滚动到底部')
      }
    })

    // Cmd/Ctrl + Shift + PageUp: 向上滚动一页
    globalShortcut.register('CommandOrControl+Shift+PageUp', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript('window.scrollBy(0, -window.innerHeight * 0.8)')
        console.log('📄 向上滚动一页')
      }
    })

    // Cmd/Ctrl + Shift + PageDown: 向下滚动一页
    globalShortcut.register('CommandOrControl+Shift+PageDown', () => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript('window.scrollBy(0, window.innerHeight * 0.8)')
        console.log('📄 向下滚动一页')
      }
    })

    console.log('全局快捷键注册成功')
    console.log('⌨️ Monaco编辑器键盘滚动快捷键（主进程）:')
    console.log('  基础滚动: Ctrl/Cmd + Shift + 方向键 (50px)')
    console.log('  快速滚动: Ctrl/Cmd + Alt + Shift + 方向键 (200px)')
    console.log('  页面跳转: Ctrl/Cmd + Shift + Home/End/PageUp/PageDown')
    console.log('  💡 优先控制Monaco编辑器，无编辑器时回退到窗口滚动')
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
  
  // 获取当前穿透模式状态
  ipcMain.handle('get-mouse-through-mode', () => {
    console.log('📡 主进程：获取穿透模式状态请求，当前状态:', isMouseThrough)
    return isMouseThrough
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
