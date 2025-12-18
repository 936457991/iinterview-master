import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import {
  Layout,
  Space,
  Button,
  Select,
  Tag,
  message,
  Modal,
  Tooltip,
  Slider,
  Card,
} from 'antd';

import {
  ArrowLeftOutlined,
  SaveOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  ToolOutlined,
  ReloadOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import socketService from '../services/socket';
import { roomsAPI } from '../services/api';
import { useTranslation } from 'react-i18next';
import { getCurrentConfig } from '../config';
import './CollaborativeEditor.css';

const { Header, Content } = Layout;
const { Option } = Select;

interface User {
  id: string;
  username: string;
  color: string;
  cursor?: any;
}

interface RoomData {
  id: string;
  name: string;
  description: string;
  language: string;
  content: string;
  coderpadUrl?: string;
  coderpadExpiresAt?: string;
  roomCode?: string; // 添加房间号字段
  members: Array<{
    id: string;
    userId: string;
    role: string;
    isOnline: boolean;
    user: {
      id: string;
      username: string;
    };
  }>;
}

const CollaborativeEditor: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const yjsDocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  // 🔧 检测是否在 Electron 环境中运行
  const isElectron = useMemo(() => {
    // 方法1: 检查 navigator.userAgent
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('electron')) {
      console.log('🖥️ 检测到 Electron 环境 (userAgent)');
      return true;
    }
    
    // 方法2: 检查 window 对象上的 Electron API
    if (typeof window !== 'undefined' && (window as any).electron) {
      console.log('🖥️ 检测到 Electron 环境 (window.electron)');
      return true;
    }
    
    // 方法3: 检查 process (如果可用)
    if (typeof process !== 'undefined' && (process as any).versions?.electron) {
      console.log('🖥️ 检测到 Electron 环境 (process.versions.electron)');
      return true;
    }
    
    console.log('🌐 检测到浏览器环境');
    return false;
  }, []);

  const [room, setRoom] = useState<RoomData | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [currentLanguage, setCurrentLanguage] = useState('javascript');
  const [loading, setLoading] = useState(true);
  const [useExternalEditor, setUseExternalEditor] = useState(false);
  // 穿透模式状态
  const [isMouseThroughMode, setIsMouseThroughMode] = useState(false);
  
  // 🎨 编辑器主题状态（黑底/白底）
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'vs-light'>(() => {
    // 从 localStorage 读取用户的主题偏好
    const savedTheme = localStorage.getItem('editor_theme');
    return (savedTheme === 'vs-light' || savedTheme === 'vs-dark') 
      ? savedTheme 
      : 'vs-dark'; // 默认深色主题
  });
  
  // 📝 编辑器字体大小状态
  const [editorFontSize, setEditorFontSize] = useState<number>(() => {
    // 从 localStorage 读取用户的字体大小偏好
    const clamp = (n: number) => Math.min(30, Math.max(10, n));
    const savedFontSize = localStorage.getItem('editor_fontSize');
    const parsed = savedFontSize ? Number.parseInt(savedFontSize, 10) : NaN;
    const normalized = Number.isFinite(parsed) ? clamp(parsed) : 14; // 默认14px
    if (savedFontSize && String(parsed) !== String(normalized)) {
      localStorage.setItem('editor_fontSize', normalized.toString());
    }
    return normalized;
  });
  
  // 透明度控制状态
  const [opacity, setOpacity] = useState(100); // 百分比形式 (0-100)
  
  // 工具箱展开状态
  const [showToolbox, setShowToolbox] = useState(false);
  
  const [initializationSteps, setInitializationSteps] = useState({
    roomDataLoaded: false,
    editorMounted: false,
    socketConnected: false,
  });

  // 🔧 添加调试日志，监控loading状态变化
  useEffect(() => {
    console.log('🔄 Loading state changed:', loading);
  }, [loading]);

  // 🔧 添加调试日志，监控初始化步骤变化
  useEffect(() => {
    console.log('🔄 Initialization steps changed:', initializationSteps);
  }, [initializationSteps]);

  // 初始化透明度（仅在 Electron 环境中）
  useEffect(() => {
    if (isElectron && window.api && typeof window.api.getOpacity === 'function') {
      // 从主进程获取当前透明度
      window.api.getOpacity().then((currentOpacity: number) => {
        setOpacity(Math.round(currentOpacity * 100));
        console.log('💡 初始透明度:', currentOpacity);
      }).catch((err: Error) => {
        console.error('获取透明度失败:', err);
      });
      
      // 从本地存储加载透明度设置
      const savedOpacity = localStorage.getItem('window-opacity');
      if (savedOpacity) {
        const opacityValue = parseFloat(savedOpacity);
        window.api.setOpacity(opacityValue).then(() => {
          setOpacity(Math.round(opacityValue * 100));
          console.log('💡 从本地存储恢复透明度:', opacityValue);
        }).catch((err: Error) => {
          console.error('设置透明度失败:', err);
        });
      }
    }
  }, [isElectron]);

  // 监听穿透模式状态变化
  useEffect(() => {
    const handleMouseThroughModeChanged = (_event: any, isEnabled: boolean) => {
      console.log('📡 房间内收到穿透模式状态变化:', isEnabled);
      setIsMouseThroughMode(isEnabled);
    };

    // 检查穿透模式初始状态
    const checkMouseThroughMode = async () => {
      if (window.electron && window.electron.ipcRenderer) {
        try {
          const isEnabled = await window.electron.ipcRenderer.invoke('get-mouse-through-mode');
          console.log('🔍 房间内检查穿透模式初始状态:', isEnabled);
          setIsMouseThroughMode(isEnabled);
        } catch (error) {
          console.error('❌ 获取穿透模式状态失败:', error);
        }
      }
    };

    // 检查是否在Electron环境中
    if (window.electron && window.electron.ipcRenderer) {
      // 监听状态变化
      window.electron.ipcRenderer.on('mouse-through-mode-changed', handleMouseThroughModeChanged);
      
      // 检查初始状态
      checkMouseThroughMode();
      
      return () => {
        window.electron.ipcRenderer.removeListener('mouse-through-mode-changed', handleMouseThroughModeChanged);
      };
    } else {
      console.log('⚠️ 非Electron环境，无法监听穿透模式状态');
      return undefined;
    }
  }, []);
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [userCursors, setUserCursors] = useState<Map<string, { lineNumber: number; column: number; username: string; color: string }>>(new Map());
  const [userSelections, setUserSelections] = useState<Map<string, {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    username: string;
    color: string;
  }>>(new Map());
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [yjsConnectionStatus, setYjsConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>('connecting');
  const [showReconnectingBar, setShowReconnectingBar] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  
  // 🔔 气泡提醒状态
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleText, setBubbleText] = useState('');
  const [bubblePosition, setBubblePosition] = useState({ top: 0, left: 0 });
  const bubbleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bubbleCooldownRef = useRef<number>(0); // 气泡冷却结束时间戳（ms）
  
  // 🔒 同步执行锁，防止重复触发
  const syncExecutingRef = useRef(false);
  
  // 🔧 使用 useRef 保存最新的 room 和 user，避免闭包问题
  const roomRef = useRef(room);
  const userRef = useRef(user);
  const currentLanguageRef = useRef(currentLanguage);
  
  // 🔧 用于等待保存确认的 Promise
  const savePendingPromise = useRef<{
    resolve: (value: boolean) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  
  // 🔧 用于清理保存确认超时定时器
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 🔧 用于防止重复弹出同步确认对话框
  const syncConfirmModalRef = useRef<boolean>(false);
  
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  
  useEffect(() => {
    currentLanguageRef.current = currentLanguage;
  }, [currentLanguage]);
  
  // 🔧 实时更新同步冷却倒计时
  useEffect(() => {
    const COOLDOWN_TIME = 60 * 1000; // 1分钟
    
    const updateCooldown = () => {
      if (lastSyncTime) {
        const now = Date.now();
        const elapsed = now - lastSyncTime;
        const remaining = Math.max(0, Math.ceil((COOLDOWN_TIME - elapsed) / 1000));
        setCooldownRemaining(remaining);
      } else {
        setCooldownRemaining(0);
      }
    };
    
    // 立即更新一次
    updateCooldown();
    
    // 每秒更新一次
    const timer = setInterval(updateCooldown, 1000);
    
    return () => clearInterval(timer);
  }, [lastSyncTime]);
  
  // 🔧 监听网络状态变化
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 🎹 使用 ref 存储最新的状态，避免频繁重新注册 IPC 监听器
  const cooldownRemainingRef = useRef(cooldownRemaining);
  const isSyncingRef = useRef(isSyncing);
  
  useEffect(() => {
    cooldownRemainingRef.current = cooldownRemaining;
    isSyncingRef.current = isSyncing;
  }, [cooldownRemaining, isSyncing]);

  // 🎹 使用 useCallback 固定 handleSyncTrigger 的引用，防止重复注册监听器
  const handleSyncTrigger = useCallback(() => {
    console.log('🎹 全局快捷键被触发', { 
      cooldownRemaining: cooldownRemainingRef.current, 
      isSyncing: isSyncingRef.current, 
      isAdmin: isRoomAdmin(),
      syncHandlerExists: !!syncHandlerRef.current 
    });
    
    // 只有非管理员才能触发同步
    if (!isRoomAdmin()) {
      // 检查是否在冷却期间
      if (cooldownRemainingRef.current > 0) {
        message.warning(t('editor.syncCooldown', { seconds: cooldownRemainingRef.current }));
        console.log(`🎹 快捷键触发失败：冷却中，剩余 ${cooldownRemainingRef.current} 秒`);
      } else if (isSyncingRef.current) {
        message.info(t('editor.syncing'));
        console.log('🎹 快捷键触发失败：正在同步中');
      } else if (syncHandlerRef.current) {
        console.log('🎹 全局快捷键 Cmd+Shift+" / Ctrl+Shift+" 被触发，执行同步操作');
        syncHandlerRef.current();
      } else {
        console.error('❌ syncHandlerRef.current 未定义！');
      }
    } else {
      console.log('🎹 房间创建人不需要同步功能');
    }
  }, [roomId, room, t]); // 只依赖不常变化的值

  // 🎹 监听全局快捷键 Cmd+Shift+" (Mac) 或 Ctrl+Shift+" (Windows/Linux) 触发同步（非管理员时生效）
  // 这是通过 Electron 的 globalShortcut 注册的，应用在后台时也能触发
  useEffect(() => {
    // 如果在 Electron 环境中，监听来自主进程的 IPC 消息
    if (isElectron && (window as any).api?.onTriggerSyncContent) {
      (window as any).api.onTriggerSyncContent(handleSyncTrigger);
      console.log('✅ 已注册全局快捷键 IPC 监听器');
      
      return () => {
        if ((window as any).api?.offTriggerSyncContent) {
          (window as any).api.offTriggerSyncContent(handleSyncTrigger);
          console.log('✅ 已移除全局快捷键 IPC 监听器');
        }
      };
    } else {
      console.log('🌐 浏览器环境：全局快捷键不可用');
      return () => {}; // 浏览器环境下返回空函数
    }
  }, [isElectron, handleSyncTrigger]); // 只在 isElectron 或 handleSyncTrigger 变化时重新注册
  const cursorDecorations = useRef<string[]>([]);
  const selectionDecorations = useRef<string[]>([]);
  const typingTimeout = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const isUpdatingDecorations = useRef<boolean>(false); // 防止装饰器递归更新
  const processedUserLeftEvents = useRef<Set<string>>(new Set()); // 防止重复处理用户离开事件
  const isUpdatingFromRemote = useRef<boolean>(false); // 标记是否正在接收远程更新
  const lastRemoteUpdateTime = useRef<number>(0); // 记录最后一次远程更新的时间
  const lastTypingTime = useRef<number>(0); // 记录最后一次发送打字事件的时间
  const typingDebounceTimeout = useRef<NodeJS.Timeout | null>(null); // 打字防抖定时器
  const lastSentContentHash = useRef<string>(''); // 记录最后发送的内容哈希，防止重复发送
  const isSaving = useRef<boolean>(false); // 防止并发保存
  const userColorStyles = useRef<HTMLStyleElement | null>(null); // 动态样式表
  const isEndingRoom = useRef<boolean>(false); // 标记用户是否主动结束房间
  const userColorMap = useRef<Map<string, string>>(new Map()); // 用户颜色映射表
  const syncHandlerRef = useRef<(() => void) | null>(null); // 同步函数引用

  // 🔧 手动重连Y.js WebSocket
  const reconnectYjs = () => {
    console.log('🔄 Manual Y.js reconnection triggered');
    setYjsConnectionStatus('connecting');
    setShowReconnectingBar(true);
    // 🔧 移除loading消息，只通过顶部状态栏显示
    
    if (providerRef.current) {
      // 断开现有连接
      providerRef.current.disconnect();
      
      // 延迟后重新连接
      setTimeout(() => {
        if (providerRef.current) {
          providerRef.current.connect();
        }
      }, 1000);
    }
  };

  // 🔧 检查所有初始化步骤是否完成
  const checkInitializationComplete = (steps: typeof initializationSteps) => {
    console.log('🔄 Checking initialization steps:', steps);
    // 🔧 进一步优化：只要房间数据开始加载就显示界面，其他步骤异步进行
    const criticalStepsComplete = steps.roomDataLoaded;
    
    if (criticalStepsComplete) {
      console.log('✅ Critical initialization steps completed, clearing loading state');
      setLoading(false);
    }
    
    return criticalStepsComplete;
  };

  // 监听初始化步骤变化
  useEffect(() => {
    checkInitializationComplete(initializationSteps);
  }, [initializationSteps]);

  // 简单的字符串哈希函数，用于检测内容变化
  const simpleHash = (str: string): string => {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return hash.toString();
  };

  // 优化的颜色池 - 30种高对比度、易区分的颜色
  // 按色相分组，确保相邻颜色有明显差异
  const colorPalette = [
    // 红色系
    '#E53E3E', // 鲜红
    // 橙色系  
    '#FF8C00', // 深橙
    // 黄色系
    '#FFD700', // 金黄
    // 绿色系
    '#38A169', // 森林绿
    // 青色系
    '#00B5D8', // 天蓝
    // 蓝色系
    '#3182CE', // 蓝色
    // 紫色系
    '#805AD5', // 紫色
    // 粉色系
    '#D53F8C', // 玫红
    
    // 第二轮，更深或更浅的变体
    '#C53030', // 深红
    '#ED8936', // 橙色
    '#ECC94B', // 柠檬黄
    '#48BB78', // 翠绿
    '#0BC5EA', // 青蓝
    '#4299E1', // 亮蓝
    '#9F7AEA', // 淡紫
    '#ED64A6', // 粉红
    
    // 第三轮，特殊色调
    '#E2E8F0', // 浅灰蓝
    '#2D3748', // 深灰
    '#B7791F', // 棕黄
    '#276749', // 深绿
    '#2C5282', // 深蓝
    '#553C9A', // 深紫
    '#97266D', // 深粉
    '#744210', // 棕色
    
    // 第四轮，补充色
    '#F56565', // 珊瑚红
    '#68D391', // 薄荷绿
    '#63B3ED', // 天空蓝
    '#F687B3', // 樱花粉
    '#FBB6CE', // 浅粉
    '#C6F6D5'  // 浅绿
  ];

  // 为用户生成确定性的唯一颜色（基于用户ID的哈希）
  const getUserColor = (userId: string): string => {
    // 如果用户已经有颜色，直接返回
    if (userColorMap.current.has(userId)) {
      return userColorMap.current.get(userId)!;
    }

    // 使用用户ID生成确定性哈希，确保相同用户ID在所有客户端都得到相同颜色
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash; // 转换为32位整数
    }
    
    // 添加用户名长度和额外混淆，增加散列效果
    hash = hash + userId.length * 31 + userId.charCodeAt(0) * 17;
    
    // 使用更好的散列方法来避免相邻ID产生相邻颜色
    // 使用质数跳跃来增加颜色分布的随机性
    const primeJump = 13; // 质数，用于跳跃式选择颜色
    const colorIndex = (Math.abs(hash) * primeJump) % colorPalette.length;
    let selectedColor = colorPalette[colorIndex];

    // 检查是否有颜色冲突（同一个哈希值）
    const existingUserWithSameColor = Array.from(userColorMap.current.entries())
      .find(([existingUserId, color]) => 
        color === selectedColor && 
        existingUserId !== userId &&
        onlineUsers.some(user => user.id === existingUserId)
      );

    // 如果有冲突，使用更复杂的哈希算法生成唯一颜色
    if (existingUserWithSameColor) {
      selectedColor = generateHashColor(userId);
      console.log(`🎨 Color conflict detected for ${userId}, using generated color: ${selectedColor}`);
    }

    // 保存用户颜色映射
    userColorMap.current.set(userId, selectedColor);

    console.log(`🎨 Assigned deterministic color ${selectedColor} to user ${userId} (hash: ${hash}, index: ${colorIndex})`);
    
    return selectedColor;
  };

  // 生成基于哈希的确定性颜色（当预定义颜色用完时）
  const generateHashColor = (userId: string): string => {
    // 使用更复杂的哈希算法，加入用户ID长度作为种子，确保唯一性
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash; // 转换为32位整数
    }
    
    // 添加用户ID长度和字符码作为额外的种子，增加散列效果
    hash = hash + userId.length * 1000 + userId.charCodeAt(userId.length - 1) * 100;
    
    // 生成HSL颜色，确保高饱和度和适中亮度，增加区分度
    const hue = Math.abs(hash * 7) % 360; // 乘以质数增加散列
    const saturation = 70 + (Math.abs(hash >> 8) % 25); // 70-95% 高饱和度
    const lightness = 45 + (Math.abs(hash >> 16) % 20); // 45-65% 适中亮度
    
    const color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    console.log(`🎨 Generated high-contrast hash color for ${userId}: ${color} (hash: ${hash}, hue: ${hue})`);
    
    return color;
  };

  // 确保所有在线用户都有确定性颜色
  const ensureUniqueColorsForAllUsers = () => {
    console.log('🎨 Ensuring deterministic colors for all users...');
    console.log('🎨 Online users:', onlineUsers.map(u => ({ id: u.id, username: u.username })));

    // 清理已离线用户的颜色映射
    const onlineUserIds = new Set(onlineUsers.map(user => user.id));
    const keysToDelete: string[] = [];
    
    userColorMap.current.forEach((_, userId) => {
      if (!onlineUserIds.has(userId)) {
        keysToDelete.push(userId);
      }
    });
    
    keysToDelete.forEach(userId => {
      const removedColor = userColorMap.current.get(userId);
      userColorMap.current.delete(userId);
      console.log(`🎨 Removed color mapping for offline user ${userId}: ${removedColor}`);
    });

    // 为所有在线用户确保有确定性颜色（基于用户ID哈希）
    onlineUsers.forEach(user => {
      if (!userColorMap.current.has(user.id)) {
        getUserColor(user.id); // 这会分配确定性颜色
      }
    });

    console.log('🎨 Final deterministic color mappings:', Array.from(userColorMap.current.entries()));
  };

  // 将颜色转换为RGB值（支持十六进制和HSL）
  const hexToRgb = (color: string): string => {
    // 处理十六进制颜色
    const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    if (hexResult) {
      return `${parseInt(hexResult[1], 16)}, ${parseInt(hexResult[2], 16)}, ${parseInt(hexResult[3], 16)}`;
    }
    
    // 处理HSL颜色
    const hslResult = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/i.exec(color);
    if (hslResult) {
      const h = parseInt(hslResult[1]) / 360;
      const s = parseInt(hslResult[2]) / 100;
      const l = parseInt(hslResult[3]) / 100;
      
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
      const g = Math.round(hue2rgb(p, q, h) * 255);
      const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
      
      return `${r}, ${g}, ${b}`;
    }
    
    return '255, 107, 107'; // 默认颜色的RGB值
  };


  // 创建用户颜色的动态样式
  const createUserColorStyles = (userColors: Map<string, string>) => {
    if (!userColorStyles.current) {
      userColorStyles.current = document.createElement('style');
      document.head.appendChild(userColorStyles.current);
    }

    let css = '';
    userColors.forEach((color, userId) => {
      const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
      const rgbColor = hexToRgb(color);
      css += `
        .user-cursor-${sanitizedUserId} .remote-cursor-line,
        .user-cursor-${sanitizedUserId}.remote-cursor-line {
          background-color: ${color} !important;
        }
        .user-cursor-${sanitizedUserId} .remote-cursor-name,
        .user-cursor-${sanitizedUserId}.remote-cursor-name {
          background-color: ${color} !important;
        }
        .user-cursor-${sanitizedUserId} .typing-popup-content,
        .user-cursor-${sanitizedUserId}.typing-popup-content {
          background-color: ${color} !important;
          color: white !important;
        }
        .user-selection-${sanitizedUserId} .remote-selection,
        .user-selection-${sanitizedUserId}.remote-selection {
          --cursor-color-rgb: ${rgbColor};
          background-color: rgba(${rgbColor}, 0.3) !important;
        }
      `;
    });

    userColorStyles.current.textContent = css;
  };

  // 更新光标装饰
  const updateCursorDecorations = () => {
    console.log('🎨 Updating cursor decorations...');
    console.log('🎨 Editor ref:', !!editorRef.current);
    console.log('🎨 Monaco ref:', !!monacoRef.current);
    console.log('🎨 User cursors size:', userCursors.size);
    console.log('🎨 Typing users:', Array.from(typingUsers));

    if (!editorRef.current || !monacoRef.current) {
      console.log('🎨 Editor or Monaco not available, skipping decoration update');
      return;
    }

    // 🔧 防止递归调用装饰器更新
    if (isUpdatingDecorations.current) {
      console.log('🎨 Already updating decorations, skipping to prevent recursion');
      return;
    }

    // 🔧 防止在远程更新期间更新装饰器，避免与 Y.js MonacoBinding 冲突
    if (isUpdatingFromRemote.current) {
      console.log('🎨 Remote update in progress, deferring decoration update');
      setTimeout(() => updateCursorDecorations(), 100);
      return;
    }

    const decorations: any[] = [];

    userCursors.forEach((cursor, userId) => {
      console.log('🎨 Processing cursor for user:', userId, cursor);

      if (userId === user?.id) {
        console.log('🎨 Skipping own cursor');
        return; // 不显示自己的光标
      }

      const { lineNumber, column, username } = cursor;
      const isTyping = typingUsers.has(userId);

      // 获取用户颜色（与头像颜色一致）
      const userColor = getUserColor(userId);
      const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
      console.log('🎨 Creating decoration for user:', username, 'at', lineNumber, column, 'with color:', userColor, 'isTyping:', isTyping);

      // 光标装饰
      decorations.push({
        range: new monacoRef.current.Range(lineNumber, column, lineNumber, column),
        options: {
          className: `remote-cursor user-cursor-${sanitizedUserId} ${isTyping ? 'typing-cursor' : ''}`,
          stickiness: monacoRef.current.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          beforeContentClassName: `remote-cursor-line user-cursor-${sanitizedUserId} ${isTyping ? 'typing-cursor-line' : ''}`,
          after: {
            content: username,
            inlineClassName: `remote-cursor-name user-cursor-${sanitizedUserId} ${isTyping ? 'typing-cursor-name' : ''}`,
            inlineClassNameAffectsLetterSpacing: true,
          },
          // 设置概览标尺颜色
          overviewRuler: {
            color: userColor,
            position: monacoRef.current.editor.OverviewRulerLane.Right
          }
        }
      });

      // 如果用户正在打字，添加一个额外的打字状态popup
      if (isTyping) {
        decorations.push({
          range: new monacoRef.current.Range(lineNumber, column, lineNumber, column),
          options: {
            className: `typing-popup user-cursor-${sanitizedUserId}`,
            stickiness: monacoRef.current.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            after: {
              content: ` ⌨️ ${t('editor.userIsTyping', { username })}`,
              inlineClassName: `typing-popup-content user-cursor-${sanitizedUserId}`,
            }
          }
        });
      }
    });

    console.log('🎨 Total decorations to apply:', decorations.length);

    try {
      // 🔧 设置更新标志，防止递归
      isUpdatingDecorations.current = true;
      
      // 🔧 使用 requestAnimationFrame 延迟应用装饰，打破递归链
      requestAnimationFrame(() => {
        try {
          if (editorRef.current) {
            const newDecorations = editorRef.current.deltaDecorations(cursorDecorations.current, decorations);
            cursorDecorations.current = newDecorations;
          }
        } catch (error) {
          console.error('🎨 Error applying cursor decorations:', error);
        } finally {
          // 🔧 重置更新标志
          isUpdatingDecorations.current = false;
        }
      });
    } catch (error) {
      console.error('🎨 Error scheduling cursor decorations:', error);
      isUpdatingDecorations.current = false;
    }
  };

  // 更新选择区域装饰
  const updateSelectionDecorations = () => {
    if (!editorRef.current || !monacoRef.current) return;

    // 🔧 防止递归调用装饰器更新
    if (isUpdatingDecorations.current) {
      console.log('🎨 Already updating decorations, skipping selection update to prevent recursion');
      return;
    }

    // 🔧 防止在远程更新期间更新装饰器
    if (isUpdatingFromRemote.current) {
      console.log('🎨 Remote update in progress, deferring selection decoration update');
      setTimeout(() => updateSelectionDecorations(), 100);
      return;
    }

    const decorations: any[] = [];

    userSelections.forEach((selection, userId) => {
      if (userId === user?.id) return; // 不显示自己的选择

      const { startLineNumber, startColumn, endLineNumber, endColumn } = selection;

      // 获取用户ID的安全版本用于CSS类名
      const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');

      // 选择区域装饰
      decorations.push({
        range: new monacoRef.current.Range(startLineNumber, startColumn, endLineNumber, endColumn),
        options: {
          className: `remote-selection user-selection-${sanitizedUserId}`,
          stickiness: monacoRef.current.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          inlineClassName: 'remote-selection-inline',
        }
      });

    });

    try {
      // 🔧 设置更新标志，防止递归
      isUpdatingDecorations.current = true;
      
      // 🔧 使用 requestAnimationFrame 延迟应用装饰，打破递归链
      requestAnimationFrame(() => {
        try {
          if (editorRef.current) {
            const newDecorations = editorRef.current.deltaDecorations(selectionDecorations.current, decorations);
            selectionDecorations.current = newDecorations;
          }
        } catch (error) {
          console.error('🎨 Error applying selection decorations:', error);
        } finally {
          // 🔧 重置更新标志
          isUpdatingDecorations.current = false;
        }
      });
    } catch (error) {
      console.error('🎨 Error scheduling selection decorations:', error);
      isUpdatingDecorations.current = false;
    }
  };

  // 当用户光标位置变化时更新装饰
  useEffect(() => {
    // 确保所有在线用户都有唯一颜色
    ensureUniqueColorsForAllUsers();
    
    // 创建用户颜色样式
    const userColors = new Map<string, string>();
    userCursors.forEach((_, userId) => {
      userColors.set(userId, getUserColor(userId));
    });
    userSelections.forEach((_, userId) => {
      userColors.set(userId, getUserColor(userId));
    });
    onlineUsers.forEach(user => {
      userColors.set(user.id, getUserColor(user.id));
    });
    
    createUserColorStyles(userColors);
    updateCursorDecorations();
  }, [userCursors, onlineUsers]);

  // 当打字状态变化时更新光标装饰
  useEffect(() => {
    updateCursorDecorations();
  }, [typingUsers]);

  // 当用户选择区域变化时更新装饰
  useEffect(() => {
    // 确保所有在线用户都有唯一颜色
    ensureUniqueColorsForAllUsers();
    
    // 确保选择区域的颜色样式也被创建
    const userColors = new Map<string, string>();
    userSelections.forEach((_, userId) => {
      userColors.set(userId, getUserColor(userId));
    });
    userCursors.forEach((_, userId) => {
      userColors.set(userId, getUserColor(userId));
    });
    onlineUsers.forEach(user => {
      userColors.set(user.id, getUserColor(user.id));
    });
    
    createUserColorStyles(userColors);
    updateSelectionDecorations();
  }, [userSelections, onlineUsers]);

  useEffect(() => {
    if (!roomId || !user) return;

    // 🔧 先加载房间数据，再按需初始化协作（外部链接房间可跳过 Yjs）
    (async () => {
      try {
        const roomData = await loadRoomData();
        await initializeCollaboration({ skipYjs: !!roomData?.coderpadUrl });
      } catch (error) {
        console.error('🚨 Initialization failed:', error);
        setLoading(false); // 即使失败也要清除加载状态
      }
    })();

    // 🔧 添加超时保护，防止loading状态一直不消失
    const loadingTimeout = setTimeout(() => {
      console.warn('⚠️ Loading timeout - forcing loading state to false');
      setLoading(false);
      // 强制标记房间数据加载完成，避免界面卡住
      setInitializationSteps(prev => ({
        ...prev,
        roomDataLoaded: true
      }));
    }, 3000); // 3秒超时，确保有足够时间加载

    return () => {
      cleanup();
      clearTimeout(loadingTimeout);
    };
  }, [roomId, user]);

  useEffect(() => {
    if (!isElectron || !window.electron || !window.electron.ipcRenderer) return;

    const url = room?.coderpadUrl;
    if (useExternalEditor && url) {
      // 固定顶部条高度（工具箱作为浮层，不影响 BrowserView bounds）
      // 预留高度要与顶部工具条实际高度一致，否则会看到“菜单栏与代码页面之间的空白间距”
      const FIXED_TOP_OFFSET = 32;

      window.electron.ipcRenderer.invoke('external-editor:set', {
        url,
        top: FIXED_TOP_OFFSET,
        right: 0,
        bottom: 0,
        left: 0,
      }).catch(() => {});
    } else {
      window.electron.ipcRenderer.invoke('external-editor:clear').catch(() => {});
    }

    return () => {
      window.electron.ipcRenderer.invoke('external-editor:clear').catch(() => {});
    };
  }, [isElectron, useExternalEditor, room?.coderpadUrl]);

  const loadRoomData = async (): Promise<RoomData | null> => {
    try {
      console.log('🔄 Loading room data...');
      
      const response = await roomsAPI.getRoom(roomId!);
      const roomData = response.data;
      setRoom(roomData);
      setCurrentLanguage(roomData.language);
      setUseExternalEditor(!!roomData.coderpadUrl);
      
      // 🔧 标记房间数据加载完成
      setInitializationSteps(prev => ({
        ...prev,
        roomDataLoaded: true
      }));
      
      console.log('✅ Room data loaded successfully');
      return roomData;
    } catch (error: any) {
      console.error('❌ 加载房间数据失败:', error);
      
      // 🔧 即使加载失败，也要清除loading状态，避免一直loading
      setLoading(false);
      
      // 检查是否是404错误，表示房间不存在或已被删除
      if (error.response?.status === 404) {
        Modal.error({
          title: t('room.roomDeleted'),
          content: t('room.roomDeletedMessage', { roomName: '该房间' }),
          okText: t('common.ok'),
          onOk: () => {
            navigate('/dashboard');
          }
        });
        return null;
      }
      
      // 其他错误
      message.error(t('editor.loadRoomFailed'));
      navigate('/dashboard');
      return null;
    }
  };

  const initializeCollaboration = async (options?: { skipYjs?: boolean }) => {
    const skipYjs = !!options?.skipYjs;
    if (skipYjs) {
      setYjsConnectionStatus('connected');
      setShowReconnectingBar(false);
      return;
    }
    // Initialize Yjs document
    yjsDocRef.current = new Y.Doc();

    // Connect to WebSocket provider for Yjs
    const config = getCurrentConfig();
    const yjsUrl = config.websocket.yjsUrl;

    providerRef.current = new WebsocketProvider(
      yjsUrl,
      `room-${roomId}`,
      yjsDocRef.current,
      {
        connect: true,
        // 🔧 禁用二进制协议，使用文本协议避免数据格式问题（特别是空格丢失问题）
        disableBc: true,
        // 🔧 增强重连参数，优化网络稳定性
        maxBackoffTime: 3000, // 最大退避时间3秒，更快重连
        resyncInterval: 20000, // 20秒重新同步一次，减少网络压力
        // 添加参数
        params: {
          userId: user?.id || '',
          username: user?.username || ''
        },
        // 🔧 WebSocket 二进制类型设置为 arraybuffer，确保数据传输完整性
        WebSocketPolyfill: undefined, // 使用浏览器原生 WebSocket
      }
    );

    // 添加错误处理和状态监听
    // 🔧 Y.js WebSocket连接状态管理
    providerRef.current.on('status', (event: any) => {
      console.log('🔄 Yjs WebSocket status changed:', event);
      
      if (event.status === 'connected') {
        console.log('✅ Yjs WebSocket connected successfully');
        setYjsConnectionStatus('connected');
        setShowReconnectingBar(false);
        message.destroy(); // 清除之前的错误消息
        // 移除成功连接的提示消息，减少干扰
      } else if (event.status === 'disconnected') {
        console.log('🔌 Yjs WebSocket disconnected');
        setYjsConnectionStatus('disconnected');
        setShowReconnectingBar(true); // 显示顶部重连条
        message.destroy(); // 清除之前的消息
      } else if (event.status === 'connecting') {
        console.log('🔄 Yjs WebSocket connecting...');
        setYjsConnectionStatus('connecting');
        setShowReconnectingBar(true); // 显示顶部重连条
        message.destroy(); // 清除之前的消息
      }
    });

    providerRef.current.on('connection-error', (error: any) => {
      console.error('❌ Yjs WebSocket connection error:', error);
      setYjsConnectionStatus('reconnecting');
      setShowReconnectingBar(true);
      // 🔧 移除错误消息提示，只通过顶部状态栏显示
      // 🔧 连接错误时也要清除loading状态，避免一直loading
      setLoading(false);
    });

    providerRef.current.on('connection-close', (event: any) => {
      console.log('🔌 Yjs WebSocket connection closed:', event);
      setYjsConnectionStatus('disconnected');
      setShowReconnectingBar(true);
      // 🔧 移除消息提示，只通过顶部状态栏显示
    });

    // 🔧 监听同步状态变化
    providerRef.current.on('sync', (isSynced: boolean) => {
      console.log('🔄 Yjs sync status:', isSynced ? 'synced' : 'syncing');
      if (isSynced && yjsConnectionStatus !== 'connected') {
        setYjsConnectionStatus('connected');
        setShowReconnectingBar(false);
        message.destroy(); // 清除错误消息
        // 移除同步成功的提示消息，减少干扰
      }
    });

    // 🔧 Y.js Provider有自己的disconnect事件，这里不需要额外监听

    // 🔧 监听WebSocket连接状态变化
    if (providerRef.current.ws) {
      const ws = providerRef.current.ws;
      
      ws.addEventListener('open', () => {
        console.log('✅ Yjs WebSocket opened');
        setYjsConnectionStatus('connected');
      });

      ws.addEventListener('error', (error) => {
        console.error('❌ Yjs WebSocket error:', error);
        setYjsConnectionStatus('reconnecting');
        setShowReconnectingBar(true);
      });

      ws.addEventListener('close', (event) => {
        console.log('🔌 Yjs WebSocket closed:', event.code, event.reason);
        setYjsConnectionStatus('disconnected');
        setShowReconnectingBar(true);
        // 移除过多的关闭提示消息，只在顶部重连条显示状态
      });
    }

    // Connect to Socket.IO for additional features
    console.log('🔗 Connecting to Socket.IO...');
    console.log('🔗 Room ID:', roomId);
    console.log('🔗 User:', user);
    
    // 🔧 存储当前用户信息到全局，用于重连时自动重新加入房间
    (window as any).currentUser = user;
    
    try {
      await socketService.connect();
      console.log('🏠 Socket.IO connected successfully');

      // 🔑 CRITICAL: Setup Socket listeners AFTER connection is established
      console.log('🎧 Setting up Socket listeners after connection...');
      setupSocketListeners();

      console.log('🏠 Joining room via Socket.IO...');
      console.log('🏠 Joining room with ID:', roomId, 'and user:', user);
      console.log('🏠 User details:', {
        id: user?.id,
        username: user?.username,
        email: user?.email
      });
      socketService.joinRoom(roomId!, user!);
    } catch (error) {
      console.error('🚨 Failed to connect to Socket.IO:', error);
      // Socket连接失败不应该阻止Y.js协作功能
    }
  };

  const setupSocketListeners = () => {
    console.log('🎧 Setting up Socket listeners...');

    // 添加WebSocket错误处理
    socketService.off('error');
    socketService.onError((error: any) => {
      console.error('WebSocket错误:', error);
      
      // 处理特定的错误类型
      if (error.code === 'CONTENT_TOO_LARGE') {
        Modal.error({
          title: t('editor.contentTooLarge'),
          content: error.message,
          okText: t('common.ok'),
        });
      } else if (error.code === 'SAVE_FAILED') {
        message.error(t('editor.saveFailedError', { message: error.message }));
      } else {
        message.error(t('editor.connectionError', { message: error.message || t('common.error') }));
      }
    });

    // 🔧 添加重连状态监听
    socketService.off('disconnect');
    socketService.onDisconnect((reason: string) => {
      console.log('🔄 Socket disconnected:', reason);
      if (reason === 'io server disconnect') {
        // 服务器主动断开，不自动重连
        setShowReconnectingBar(true);
      } else {
        // 网络问题等，显示重连状态
        setIsReconnecting(true);
        setShowReconnectingBar(true);
      }
    });

    socketService.off('reconnect_attempt');
    socketService.onReconnectAttempt((attemptNumber: number) => {
      console.log('🔄 Reconnection attempt:', attemptNumber);
      setIsReconnecting(true);
      setShowReconnectingBar(true);
    });

    socketService.off('reconnect');
    socketService.onReconnect((attemptNumber: number) => {
      console.log('🔄 Reconnected successfully after', attemptNumber, 'attempts');
      setIsReconnecting(false);
      setShowReconnectingBar(false);
      message.destroy(); // 清除loading消息
      // 移除重连成功的提示消息，减少干扰
    });

    socketService.off('reconnect_failed');
    socketService.onReconnectFailed(() => {
      console.error('🔄 Reconnection failed');
      setIsReconnecting(false);
      setShowReconnectingBar(true); // 保持显示重连条
      message.destroy();
    });

    socketService.onRoomJoined((data: any) => {
      console.log('🎉 Room joined event received:', data);
      console.log('🎉 Members data:', data.members);
      console.log('🎉 Members count:', data.members?.length || 0);
      console.log('🎉 Full data object:', JSON.stringify(data, null, 2));

      // 🔧 重连成功后清除重连状态
      setIsReconnecting(false);
      setShowReconnectingBar(false);
      message.destroy(); // 清除任何loading消息

      if (!data.members || !Array.isArray(data.members)) {
        console.error('🚨 Invalid members data:', data.members);
        console.error('🚨 Data type:', typeof data.members);
        console.error('🚨 Is array:', Array.isArray(data.members));
        setOnlineUsers([]);
        return;
      }

      // 后端发送的是members数组，需要转换为前端期望的格式
      const users = data.members.map((member: any) => {
        console.log('🎉 Processing member:', member);
        const processedUser = {
          id: member.id,
          username: member.username,
          color: '', // 先不分配颜色，等状态更新后再分配
          role: member.role
        };
        console.log('🎉 Processed user:', processedUser);
        return processedUser;
      });

      console.log('🎉 Final processed users:', users);
      console.log('🎉 Setting online users count:', users.length);
      
      // 🔧 强制更新在线用户列表，确保重连后状态正确
      setOnlineUsers(users);
      
      // 🔧 清除之前的打字状态，重连后重新同步
      setTypingUsers(new Set());
      setUserCursors(new Map());
      setUserSelections(new Map());

      // 🔧 重连后主动请求状态同步，确保获取最新状态
      setTimeout(() => {
        if (roomId) {
          console.log('🔄 Requesting additional state sync after room join');
          socketService.syncRoomState(roomId);
        }
      }, 500); // 延迟500ms确保加入房间完成

      // 验证状态更新
      setTimeout(() => {
        console.log('🎉 Online users state after update - checking current state...');
        console.log('🎉 Current onlineUsers length should be:', users.length);
      }, 100);
    });

    socketService.onUserJoined((data) => {
      console.log('User joined:', data);
      // 后端发送的数据格式：{ userId, username }
      const newUser = {
        id: data.userId,
        username: data.username,
        color: '', // 先不分配颜色，等状态更新后再分配
        role: 'member'
      };
      setOnlineUsers(prev => {
        // 避免重复添加
        if (prev.find(u => u.id === newUser.id)) {
          return prev;
        }
        console.log(`👤 Adding new user: ${data.username} (${data.userId})`);
        return [...prev, newUser];
      });
      message.info(t('editor.userJoined', { username: data.username }));
    });

    socketService.onUserLeft((data) => {
      console.log('🚪 User left event received:', data);

      // 防止重复处理同一用户的离开事件
      if (processedUserLeftEvents.current.has(data.userId)) {
        console.log('🚪 Duplicate user left event ignored for user:', data.username);
        return;
      }

      // 标记此用户的离开事件已处理
      processedUserLeftEvents.current.add(data.userId);

      // 5秒后清除标记，允许处理该用户的新离开事件（如果重新加入后再离开）
      setTimeout(() => {
        processedUserLeftEvents.current.delete(data.userId);
        console.log('🚪 Cleared processed flag for user:', data.username);
      }, 5000);

      console.log('🚪 Processing user left event for:', data.username);
      
      // 先更新在线用户列表
      setOnlineUsers(prev => {
        const newUsers = prev.filter(u => u.id !== data.userId);
        console.log(`🚪 Updated online users: ${prev.length} -> ${newUsers.length}`);
        return newUsers;
      });

      // 延迟清理用户的颜色映射（确定性颜色不需要"释放"，但需要清理缓存）
      setTimeout(() => {
        const userColor = userColorMap.current.get(data.userId);
        if (userColor) {
          userColorMap.current.delete(data.userId);
          console.log(`🎨 Cleaned color mapping for user ${data.userId}: ${userColor}`);
        }
      }, 100);

      // 清除离开用户的光标和选择
      setUserCursors(prev => {
        const newCursors = new Map(prev);
        newCursors.delete(data.userId);
        return newCursors;
      });

      setUserSelections(prev => {
        const newSelections = new Map(prev);
        newSelections.delete(data.userId);
        return newSelections;
      });

      // 清除打字状态
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.userId);
        return newSet;
      });

      message.info(t('editor.userLeft', { username: data.username }));
    });

    // 监听在线用户更新事件
    socketService.onOnlineUsersUpdated((data: any) => {
      console.log('👥 Online users updated:', data);
      if (data.roomId === roomId) {
        setOnlineUsers(data.onlineUsers || []);
        console.log('👥 Updated online users count:', data.onlineUsers?.length || 0);
      }
    });

    socketService.onLanguageChanged((data) => {
      setCurrentLanguage(data.language);
      message.info(t('editor.languageChanged', { language: data.language }));
    });

    // 监听其他用户的光标位置变化
    socketService.onCursorPositionChanged((data: any) => {
      console.log('🎯 ===== RECEIVED CURSOR POSITION =====');
      console.log('🎯 Received data:', data);
      const { userId, username, position } = data;
      console.log('🎯 My user info:', { id: user?.id, username: user?.username, type: typeof user?.id });
      console.log('🎯 Received from user:', { id: userId, username: username, type: typeof userId });
      console.log('🎯 User ID comparison:', {
        mine: user?.id,
        received: userId,
        equal: userId === user?.id,
        strictEqual: userId === user?.id,
        stringComparison: String(userId) === String(user?.id)
      });

      // 严格检查用户ID，确保不处理自己的光标
      if (userId === user?.id || String(userId) === String(user?.id)) {
        console.log('🎯 ❌ IGNORING: This is my own cursor position');
        console.log('🎯 Detailed comparison:', {
          receivedUserId: userId,
          receivedType: typeof userId,
          myUserId: user?.id,
          myType: typeof user?.id,
          strictEqual: userId === user?.id,
          stringEqual: String(userId) === String(user?.id)
        });
        return; // 忽略自己的光标
      }

      console.log('🎯 ✅ PROCESSING: This is another user\'s cursor');
      const color = getUserColor(userId);
      console.log('🎯 Assigning color:', color, 'to user:', username);

      setUserCursors(prev => {
        const newCursors = new Map(prev);
        newCursors.set(userId, {
          lineNumber: position.lineNumber,
          column: position.column,
          username,
          color
        });
        console.log('🎯 Updated user cursors map size:', newCursors.size);
        console.log('🎯 Updated user cursors:', Array.from(newCursors.entries()));
        console.log('🎯 ===== END CURSOR PROCESSING =====');
        return newCursors;
      });

      // 🚨 重要修复：移除错误的打字状态设置逻辑
      // 光标位置变化不等于正在打字！这是导致错误显示的根本原因
      console.log('🎯 光标位置更新完成，不设置打字状态（修复了错误逻辑）');
    });

    // 监听用户打字事件（只会接收到其他用户的打字事件，不包括自己的）
    socketService.onUserTyping((data: any) => {
      console.log('⌨️ ===== RECEIVED TYPING EVENT =====');
      console.log('⌨️ Received typing from user:', data);
      const { userId, username } = data;
      console.log('⌨️ My user info:', { id: user?.id, username: user?.username });

      // 后端已经确保不会发送自己的打字事件，但这里再做一次检查
      if (userId === user?.id) {
        console.log('⌨️ ❌ UNEXPECTED: Received my own typing event, this should not happen');
        return;
      }

      console.log('⌨️ ✅ PROCESSING: Setting typing status for other user:', username);

      setTypingUsers(prev => {
        const newSet = new Set(prev).add(userId);
        console.log('⌨️ Current typing users after adding:', Array.from(newSet));
        return newSet;
      });

      // 清除之前的超时
      if (typingTimeout.current.has(userId)) {
        clearTimeout(typingTimeout.current.get(userId)!);
      }

      // 设置新的超时，5秒后移除打字状态
      const timeout = setTimeout(() => {
        console.log('⌨️ Removing typing status for user:', { userId, username });
        setTypingUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(userId);
          console.log('⌨️ Remaining typing users:', Array.from(newSet));
          return newSet;
        });
        typingTimeout.current.delete(userId);
      }, 5000);

      typingTimeout.current.set(userId, timeout);
      console.log('⌨️ ===== END TYPING EVENT PROCESSING =====');
    });

    // 监听用户停止打字
    socketService.onUserStoppedTyping((data: any) => {
      const { userId } = data;
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });

      if (typingTimeout.current.has(userId)) {
        clearTimeout(typingTimeout.current.get(userId)!);
        typingTimeout.current.delete(userId);
      }
    });

    // 监听选择区域变化
    socketService.onSelectionChanged((data: any) => {
      console.log('📝 Received selection change:', data);
      const { userId, username, selection } = data;
      if (userId === user?.id) return; // 忽略自己的选择

      const color = getUserColor(userId);
      setUserSelections(prev => {
        const newSelections = new Map(prev);
        newSelections.set(userId, {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
          username,
          color
        });
        console.log('📝 Updated user selections:', newSelections);
        return newSelections;
      });
    });

    // 监听选择区域清除
    socketService.onSelectionCleared((data: any) => {
      console.log('🗑️ Received selection clear:', data);
      const { userId } = data;
      setUserSelections(prev => {
        const newSelections = new Map(prev);
        newSelections.delete(userId);
        return newSelections;
      });
    });

    // 🔧 监听保存请求（房间创建人接收）
    socketService.onSaveRequest(async (data: any) => {
      console.log('💾 收到同步请求:', data);
      
      // 使用 ref 获取最新的值，避免闭包问题
      const currentRoom = roomRef.current;
      const currentUser = userRef.current;
      const currentRoomId = data.roomId;
      const requesterUsername = data.requestedByUsername || '某用户';
      
      // 直接在这里检查是否为管理员
      const currentMember = currentRoom?.members?.find(m => m.user.id === currentUser?.id);
      const isAdmin = currentMember?.role === 'admin';
      
      // 只有房间创建人才响应保存请求
      if (isAdmin && editorRef.current && currentRoomId) {
        console.log('💾 房间创建人收到同步请求，弹出确认对话框');
        
        // 检查是否已经有对话框打开
        if (syncConfirmModalRef.current) {
          console.log('⚠️ 已有同步确认对话框打开，跳过本次请求');
          return;
        }
        
        // 标记对话框已打开
        syncConfirmModalRef.current = true;
        
        // 弹出确认对话框
        Modal.confirm({
          title: t('editor.syncRequestTitle'),
          content: t('editor.syncRequestContent', { username: requesterUsername }),
          okText: t('editor.agreeSync'),
          cancelText: t('editor.refuseSync'),
          onOk: async () => {
            console.log('✅ 房间创建人同意同步请求，保存当前内容');
            try {
              const currentContent = editorRef.current.getValue();
              const currentLang = currentLanguageRef.current; // 使用 ref 获取最新语言
              console.log('💾 准备保存的内容长度:', currentContent.length);
              console.log('💾 准备保存的内容预览:', currentContent.substring(0, 200));
              console.log('💾 准备保存的语言:', currentLang);
              
              const updateResponse = await roomsAPI.updateRoom(currentRoomId, {
                content: currentContent,
                language: currentLang
              });
              
              console.log('✅ 房间创建人内容已保存到数据库');
              console.log('✅ 保存响应:', updateResponse.data);
              setLastSavedContent(currentContent);
              lastSentContentHash.current = simpleHash(currentContent);
              
              // 通知其他用户内容已保存（同意）
              socketService.confirmContentSaved(currentRoomId);
              message.success(t('editor.syncRequestAgreed'));
            } catch (error) {
              console.error('❌ 保存内容失败:', error);
              message.error(t('editor.saveFailed'));
            } finally {
              // 重置标志，允许下次弹窗
              syncConfirmModalRef.current = false;
            }
          },
          onCancel: () => {
            console.log('❌ 房间创建人拒绝同步请求');
            // 可以在这里添加拒绝通知
            message.info(t('editor.syncRequestRefused'));
            // 重置标志，允许下次弹窗
            syncConfirmModalRef.current = false;
          }
        });
      } else {
        console.log('💾 ❌ 不满足保存条件，跳过保存');
      }
    });

    // 🔧 监听保存确认（其他成员接收）
    socketService.onContentSavedConfirmation((data: any) => {
      console.log('✅ 收到保存确认:', data);
      
      // 如果有等待中的同步Promise，解析它
      if (savePendingPromise.current) {
        console.log('✅ 解析等待中的同步Promise');
        
        // 🔧 清除超时定时器，防止内存泄漏
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
          console.log('✅ 已清除保存确认超时定时器');
        }
        
        savePendingPromise.current.resolve(true);
        savePendingPromise.current = null;
      }
    });

    // 🔔 监听气泡提醒（接收其他用户发送的气泡）
    socketService.onBubbleReminder((data: { text: string; userId?: string; username?: string }) => {
      console.log('🔔 收到气泡提醒:', data);
      
      // 设置气泡文本
      setBubbleText(data.text);
      
      // 🔧 根据环境设置不同的顶部偏移量
      // Electron 环境：50px（因为有同步提示条占用了32px空间）
      // Web 环境：18px（没有同步提示条）
      const topOffset = isElectron ? 50 : 18;
      
      // 设置气泡位置（居中显示）
      setBubblePosition({
        top: topOffset,
        left: 50
      });
      
      // 显示气泡
      setShowBubble(true);
      console.log(`🔔 显示远程气泡提醒: "${data.text}"`);
      
      // 清除之前的定时器
      if (bubbleTimeoutRef.current) {
        clearTimeout(bubbleTimeoutRef.current);
      }
      
      // 3秒后渐进消失
      bubbleTimeoutRef.current = setTimeout(() => {
        setShowBubble(false);
        console.log('🔔 远程气泡提醒已隐藏');
      }, 3000);
    });

    // 监听房间结束事件
    socketService.onRoomEnded((data: any) => {
      console.log('🔚 Received room-ended event:', data);
      console.log('🔚 Is user actively ending room:', isEndingRoom.current);
      
      // 如果用户主动结束房间，不显示弹窗
      if (isEndingRoom.current) {
        console.log('🔚 User actively ended room, skipping modal');
        return;
      }
      
      // 其他情况（管理员结束房间）才显示弹窗
      console.log('🔚 Room ended by admin, showing modal');
      Modal.info({
        title: t('editor.roomEnded'),
        content: t('editor.roomEndedByAdmin'),
        okText: t('common.ok'),
        onOk: () => {
          // 清理资源
          if (bindingRef.current) {
            bindingRef.current.destroy();
          }
          if (providerRef.current) {
            providerRef.current.destroy();
          }
          socketService.disconnect();
          navigate('/dashboard');
        }
      });
    });

    // 监听房间被强制删除事件
    socketService.onRoomForceDeleted((data: any) => {
      console.log('🚨🚨🚨 RECEIVED room-force-deleted event:', data);
      console.log('🚨 Current room ID:', roomId);
      console.log('🚨 Current user:', user);
      console.log('🚨 Event data:', JSON.stringify(data, null, 2));
      
      Modal.warning({
        title: t('room.roomDeleted'),
        content:  t('room.roomDeletedMessage', { roomName: data.roomName }),
        okText: t('common.ok'),
        onOk: () => {
          console.log('🚨 User confirmed room deletion dialog');
          // 清理资源
          if (bindingRef.current) {
            bindingRef.current.destroy();
          }
          if (providerRef.current) {
            providerRef.current.destroy();
          }
          socketService.disconnect();
          navigate('/dashboard');
        }
      });
    });
  };

  const cleanup = () => {
    // 清理Monaco装饰
    if (editorRef.current) {
      editorRef.current.deltaDecorations(cursorDecorations.current, []);
      editorRef.current.deltaDecorations(selectionDecorations.current, []);
    }

    // 清理Yjs相关资源
    if (bindingRef.current) {
      bindingRef.current.destroy();
    }
    if (providerRef.current) {
      providerRef.current.destroy();
    }
    if (yjsDocRef.current) {
      yjsDocRef.current.destroy();
    }

    // 清理Socket事件监听器
    console.log('🧹 Cleaning up Socket event listeners...');
    socketService.off('room-joined');
    socketService.off('user-joined');
    socketService.off('user-left');
    socketService.off('online-users-updated');
    socketService.off('cursor-moved');
    socketService.off('user-typing');
    socketService.off('user-stopped-typing');
    socketService.off('selection-change');
    socketService.off('selection-clear');
    socketService.off('language-changed');
    socketService.off('room-ended');
    socketService.off('room-force-deleted');
    socketService.off('request-creator-save');
    socketService.off('content-saved-confirmation');

    // 清理Socket连接
    socketService.leaveRoom();
    socketService.disconnect();

    // 清理定时器
    typingTimeout.current.forEach(timeout => clearTimeout(timeout));
    typingTimeout.current.clear();

    // 清理打字防抖定时器
    if (typingDebounceTimeout.current) {
      clearTimeout(typingDebounceTimeout.current);
      typingDebounceTimeout.current = null;
    }

    // 清理动态样式表
    if (userColorStyles.current) {
      document.head.removeChild(userColorStyles.current);
      userColorStyles.current = null;
    }

    // 清理颜色映射
    userColorMap.current.clear();

    // 清理用户自己的光标样式
    const ownCursorStyle = document.getElementById('own-cursor-style');
    if (ownCursorStyle) {
      document.head.removeChild(ownCursorStyle);
    }

    // 清理CSS变量
    document.documentElement.style.removeProperty('--own-user-color');

    // 🔧 清理所有引用和标志，防止内存泄漏
    isUpdatingDecorations.current = false;
    isUpdatingFromRemote.current = false;
    isSaving.current = false;
    lastRemoteUpdateTime.current = 0;
    lastTypingTime.current = 0;
    lastSentContentHash.current = '';

    // 🔧 清理保存确认超时定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    // 重置标志
    isEndingRoom.current = false;
  };

  // 定时保存功能 - 每5秒保存一次
  useEffect(() => {
    if (!room || !editorRef.current) return;

    const autoSaveInterval = setInterval(async () => {
      // 🔧 防止并发保存和远程更新期间保存
      if (isSaving.current || isUpdatingFromRemote.current) {
        console.log('🔄 Skipping auto-save: saving in progress or remote update active');
        return;
      }

      try {
        isSaving.current = true;
        const currentContent = editorRef.current?.getValue() || '';
        const currentContentHash = simpleHash(currentContent);
        
        // 使用哈希检测内容变化，避免重复保存相同内容
        if (currentContentHash !== lastSentContentHash.current) {
          console.log('内容有变化，执行自动保存', {
            oldHash: lastSentContentHash.current,
            newHash: currentContentHash,
            contentLength: currentContent.length
          });
          
          // 🔧 添加网络状态检查
          if (!navigator.onLine) {
            console.log('🔄 Network offline, skipping auto-save');
            return;
          }
          
          await roomsAPI.updateRoom(room.id, {
            content: currentContent,
            language: currentLanguage
          });
          
          setLastSavedContent(currentContent);
          lastSentContentHash.current = currentContentHash;
          console.log('自动保存成功');
        } else {
          console.log('内容哈希未变化，跳过自动保存');
        }
      } catch (error: any) {
        console.error('自动保存失败:', error);
        
        // 如果是404错误，说明房间被删除了，停止自动保存
        if (error.response?.status === 404) {
          console.log('房间已被删除，停止自动保存');
          clearInterval(autoSaveInterval);
          // 注意：不在这里弹窗，因为用户可能正在编辑，会打断用户操作
          // 房间删除的通知会通过WebSocket事件来处理
        }
      } finally {
        isSaving.current = false;
      }
    }, 5000); // 🔧 增加到5秒，减少网络压力

    return () => {
      clearInterval(autoSaveInterval);
    };
  }, [room, currentLanguage, lastSavedContent]);

  // 定时同步房间数据 - 每3秒同步一次（避免网络波动）
  useEffect(() => {
    if (!roomId || !room) return;
    const syncInterval = setInterval(async () => {
      try {
        console.log('🔄 Starting periodic room data sync...');
        // 同步房间信息（包含最新的在线人数、内容、语言等）
        const updatedRoom = await roomsAPI.getRoom(roomId);
        
        // 检查房间是否还存在
        if (!updatedRoom.data) {
          console.warn('🔄 Room no longer exists, stopping sync');
          return;
        }
        const roomData = updatedRoom.data;
        // 同步在线用户数量
        if (roomData.onlineCount !== undefined) {
          setOnlineUsers(prev => {
            // 如果在线人数有变化，更新显示
            const currentCount = prev.length;
            if (currentCount !== roomData.onlineCount) {
              console.log(`🔄 Online count synced: ${currentCount} -> ${roomData.onlineCount}`);
            }
            return prev; // 保持当前状态，因为实时更新通过Socket处理
          });
        }

        // 同步房间语言（如果有变化）
        if (roomData.language && roomData.language !== currentLanguage) {
          console.log(`🔄 Language synced: ${currentLanguage} -> ${roomData.language}`);
          setCurrentLanguage(roomData.language);
          // 更新Monaco编辑器语言
          if (monacoRef.current && editorRef.current) {
            const model = editorRef.current.getModel();
            if (model) {
              monacoRef.current.editor.setModelLanguage(model, roomData.language);
            }
          }
        }

        // 移除定期内容同步，避免与Y.js WebSocket Provider冲突
        // Y.js WebSocket Provider会自动处理实时内容同步
        // 这里只同步非内容相关的房间信息

        // 更新房间基本信息
        setRoom(prev => prev ? { ...prev, ...roomData } : roomData);
        console.log('🔄 Periodic sync completed successfully');
      } catch (error: any) {
        console.error('🔄 Periodic sync failed:', error);
        if (error.response?.status == 404) {
          console.error('🔄 Room was deleted, redirecting to dashboard');
          navigate('/dashboard');
        }
      }
    }, 3000); // 每3秒同步一次
    return () => {
      clearInterval(syncInterval);
    };
  }, [roomId, room, currentLanguage, lastSavedContent, navigate]);

  // 🔧 清理effect - 处理组件卸载时的资源清理
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up CollaborativeEditor...');
      
      // 清理全局变量
      delete (window as any).currentUser;
      if ((window as any).remoteUpdateResetTimeout) {
        clearTimeout((window as any).remoteUpdateResetTimeout);
        delete (window as any).remoteUpdateResetTimeout;
      }
      
      console.log('🧹 CollaborativeEditor cleanup completed');
    };
  }, []);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    console.log('🎯 Monaco editor mounted successfully');
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // 将编辑器实例暴露到全局，供主进程快捷键使用
    (window as any).monacoEditorInstance = editor;
    
    // 🔧 标记编辑器挂载完成
    setInitializationSteps(prev => ({
      ...prev,
      editorMounted: true
    }));

    // 设置用户自己的光标和选择颜色
    if (user) {
      const userColor = getUserColor(user.id);
      // 创建自定义CSS规则来设置Monaco编辑器的光标和选择颜色
      const customStyles = `
        .monaco-editor .cursor {
          background-color: ${userColor} !important;
          border-left-color: ${userColor} !important;
        }
        .monaco-editor .selected-text {
          background-color: rgba(${hexToRgb(userColor)}, 0.3) !important;
          border-radius: 3px !important;
          box-sizing: border-box !important;
        }
        .monaco-editor .selection {
          background-color: rgba(${hexToRgb(userColor)}, 0.3) !important;
          border-radius: 3px !important;
          box-sizing: border-box !important;
        }
        .monaco-editor .selectionHighlight {
          background-color: rgba(${hexToRgb(userColor)}, 0.1) !important;
          border: 1px solid rgba(${hexToRgb(userColor)}, 0.4) !important;
          border-radius: 2px !important;
        }
        .monaco-editor .current-line {
          /* 移除当前行边框，避免颜色同步问题 */
        }
        .monaco-editor .line-numbers.active-line-number {
          /* 保持默认的行号颜色，避免颜色同步问题 */
        }
      `;
      
      // 添加或更新样式
      let ownCursorStyle = document.getElementById('own-cursor-style');
      if (!ownCursorStyle) {
        ownCursorStyle = document.createElement('style');
        ownCursorStyle.id = 'own-cursor-style';
        document.head.appendChild(ownCursorStyle);
      }
      ownCursorStyle.textContent = customStyles;

      // 同时设置用户自己的打字指示器颜色CSS变量
      document.documentElement.style.setProperty('--own-user-color', userColor);
    }

    if (yjsDocRef.current && providerRef.current) {
      // 等待WebSocket连接建立
      const setupBinding = () => {
        const yText = yjsDocRef.current!.getText('content'); // 使用'content'而不是'monaco'

        // 清理之前的绑定
        if (bindingRef.current) {
          bindingRef.current.destroy();
        }

        // Create Monaco binding for collaborative editing
        bindingRef.current = new MonacoBinding(
          yText,
          editor.getModel()!,
          new Set([editor]),
          providerRef.current?.awareness
        );

        // 监听Yjs文档变化，在远程更新时设置标志
        yText.observe((event) => {
          console.log('🔄 Yjs document changed');
          console.log('🔄 Transaction origin:', event.transaction.origin);
          console.log('🔄 Binding reference:', bindingRef.current);
          console.log('🔄 Is local change:', event.transaction.origin === bindingRef.current);

          // 如果变化不是由本地Monaco编辑器触发的，设置远程更新标志
          if (event.transaction.origin !== bindingRef.current) {
            console.log('🔄 ✅ Yjs remote update detected, setting remote flag');
            isUpdatingFromRemote.current = true;
            lastRemoteUpdateTime.current = Date.now(); // 记录远程更新时间

            // 🔧 优化远程更新标志重置，使用防抖机制避免频繁切换
            const resetTimeout = setTimeout(() => {
              isUpdatingFromRemote.current = false;
              console.log('🔄 Reset remote update flag after Yjs sync');
              
              // 🔧 远程更新结束后，延迟更新装饰器，避免冲突
              setTimeout(() => {
                if (!isUpdatingDecorations.current) {
                  updateCursorDecorations();
                  updateSelectionDecorations();
                }
              }, 50);
            }, 300); // 减少到300ms，但增加装饰器更新延迟

            // 如果在重置前又有新的远程更新，清除之前的定时器
            if ((window as any).remoteUpdateResetTimeout) {
              clearTimeout((window as any).remoteUpdateResetTimeout);
            }
            (window as any).remoteUpdateResetTimeout = resetTimeout;

          } else {
            console.log('🔄 Local Yjs change, not setting remote flag');
          }
        });

        // Set initial content if room has content and yText is empty
        if (room?.content && yText.length === 0) {
          // 🔧 使用事务来避免冲突，并添加防重复机制
          const currentYjsContent = yText.toString();
          if (currentYjsContent !== room.content) {
            console.log('🔄 Setting initial Y.js content from room data');
            yjsDocRef.current!.transact(() => {
              yText.delete(0, yText.length); // 清空现有内容
              yText.insert(0, room.content); // 插入房间内容
            }, 'initial-load'); // 添加事务标识
            setLastSavedContent(room.content);
            lastSentContentHash.current = simpleHash(room.content);
          }
        }

        console.log('Monaco binding established');
      };

      // 如果已经连接，立即设置绑定
      if (providerRef.current.wsconnected) {
        setupBinding();
      } else {
        // 否则等待连接
        providerRef.current.on('sync', setupBinding);
      }
    }

    // Handle cursor position changes
    editor.onDidChangeCursorPosition((e: any) => {
      const position = {
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      };
      // 🔧 性能优化：减少日志输出，避免翻页卡顿
      // console.log('🎯 My cursor position changed:', position);
      // console.log('🎯 My user info:', { id: user?.id, username: user?.username });
      // console.log('🎯 Room ID:', roomId);
      // console.log('🎯 Socket connected:', socketService.isConnected);
      // console.log('🎯 Is updating from remote:', isUpdatingFromRemote.current);

      // 多重检查：确保不是远程更新触发的光标变化
      if (isUpdatingFromRemote.current) {
        // console.log('🎯 ❌ SKIPPING: This is a remote update, not sending cursor position');
        return;
      }

      // 检查是否在最近的远程更新时间窗口内（优化为更短的时间窗口）
      const timeSinceLastRemoteUpdate = Date.now() - lastRemoteUpdateTime.current;
      if (timeSinceLastRemoteUpdate < 800) { // 减少到800ms，提高响应性
        // console.log('🎯 ❌ SKIPPING: Too soon after remote update, likely caused by Yjs sync');
        return;
      }

      // 延迟发送光标位置，避免与Yjs更新冲突
      setTimeout(() => {
        // 再次检查是否仍然不是远程更新
        if (!isUpdatingFromRemote.current && socketService.isConnected) {
          // console.log('🎯 ✅ Sending MY cursor position to server (user action)...');
          socketService.sendCursorPosition(roomId!, position);
        } else {
          // console.log('🎯 ❌ SKIPPING delayed cursor send: remote update flag is set or socket disconnected');
        }
      }, 50); // 50ms延迟，让Yjs更新完成
    });

    // Handle keyboard input for typing status - 更可靠的方法
    editor.onKeyDown((e: any) => {
      // 🔧 性能优化：先快速过滤非打字键，避免不必要的处理和日志输出
      // 只有在输入可见字符或删除键时才认为是打字
      const isTypingKey = (
        (e.keyCode >= 32 && e.keyCode <= 126) || // 可见字符
        e.keyCode === 8 || // Backspace
        e.keyCode === 46 || // Delete
        e.keyCode === 13 || // Enter
        e.keyCode === 9 // Tab
      );

      // 如果不是打字键（如翻页键、方向键等），立即返回，不执行任何操作
      if (!isTypingKey) {
        return;
      }

      // 只为打字键输出日志
      // console.log('⌨️ Key pressed:', e.keyCode, e.code);

      const now = Date.now();
      // 🔧 减少日志输出，提升性能
      // console.log('⌨️ ===== USER IS TYPING (KEYBOARD) =====');
      // console.log('⌨️ Detected user keyboard input');
      // console.log('⌨️ My user info:', { id: user?.id, username: user?.username });
      // console.log('⌨️ Key code:', e.keyCode);

      // 防抖：如果距离上次发送不到500ms，则取消之前的定时器并重新设置
      if (typingDebounceTimeout.current) {
        clearTimeout(typingDebounceTimeout.current);
      }

      // 如果距离上次发送超过1秒，立即发送；否则延迟发送
      const timeSinceLastTyping = now - lastTypingTime.current;
      const shouldSendImmediately = timeSinceLastTyping > 1000;

      const sendTypingEvent = () => {
        if (socketService.isConnected && roomId && user) {
          // console.log('⌨️ ✅ Sending typing event to other users');
          socketService.sendUserTyping(roomId);
          lastTypingTime.current = Date.now();

          // 同时在本地显示自己的打字状态
          // console.log('⌨️ ✅ Adding myself to local typing users');
          setTypingUsers(prev => {
            const newSet = new Set(prev).add(user.id);
            // console.log('⌨️ Local typing users after adding myself:', Array.from(newSet));
            return newSet;
          });

          // 清除之前的超时
          if (typingTimeout.current.has(user.id)) {
            clearTimeout(typingTimeout.current.get(user.id)!);
          }

          // 设置新的超时，5秒后移除自己的打字状态
          const timeout = setTimeout(() => {
            // console.log('⌨️ Removing my own typing status');
            setTypingUsers(prev => {
              const newSet = new Set(prev);
              newSet.delete(user.id);
              // console.log('⌨️ Remaining typing users after removing myself:', Array.from(newSet));
              return newSet;
            });
            typingTimeout.current.delete(user.id);
          }, 5000);

          typingTimeout.current.set(user.id, timeout);
        }
      };

      if (shouldSendImmediately) {
        // console.log('⌨️ Sending immediately (>1s since last)');
        sendTypingEvent();
      } else {
        // console.log('⌨️ Debouncing typing event (500ms delay)');
        typingDebounceTimeout.current = setTimeout(() => {
          sendTypingEvent();
          typingDebounceTimeout.current = null;
        }, 500);
      }

      // console.log('⌨️ ===== END TYPING EVENT PROCESSING =====');
    });

    // Handle selection changes
    editor.onDidChangeCursorSelection((e: any) => {
      const selection = e.selection;

      // 只有当选择区域不为空时才发送
      if (!selection.isEmpty()) {
        const selectionData = {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        };
        // 🔧 性能优化：减少日志输出
        // console.log('📝 Sending selection change:', selectionData);
        socketService.sendSelectionChange(roomId!, selectionData);

      } else {
        // 选择区域为空时，清除该用户的选择
        // console.log('🗑️ Sending selection clear');
        socketService.sendSelectionClear(roomId!);
      }
    });
  };

  // 🔔 处理显示气泡提醒
  const handleShowBubble = () => {
    console.log('🟡 handleShowBubble clicked');
    const now = Date.now();
    if (bubbleCooldownRef.current && now < bubbleCooldownRef.current) {
      const remaining = Math.ceil((bubbleCooldownRef.current - now) / 1000);
      console.log(`⏳ Bubble on cooldown: ${remaining}s remaining`);
      message.warning(t('editor.bubbleCooldownTitle', { seconds: remaining }) || `气泡冷却中 (${remaining}s)`);
      return;
    }

    if (!editorRef.current || !monacoRef.current) {
      console.log('❌ 编辑器未加载');
      message.error(t('editor.initializationFailed') || '初始化失败');
      return;
    }

    const selection = editorRef.current.getSelection();
    if (!selection || selection.isEmpty()) {
      message.warning(t('editor.selectTextFirst') || '请先选中文本');
      return;
    }

    const selectedText = editorRef.current.getModel()?.getValueInRange(selection) || '';
    if (!selectedText.trim()) {
      message.warning(t('editor.selectTextFirst') || '请先选中文本');
      return;
    }

    // 文本长度限制：20个字符
    const text = selectedText.trim();
    const displayText = text.length > 20 ? text.substring(0, 20) + '...' : text;
    
    console.log(`🔔 显示气泡提醒，原文本长度: ${text.length}，显示文本: "${displayText}"`);
    
    setBubbleText(displayText);
    
    // 🔧 根据环境设置不同的顶部偏移量
    // Electron 环境：50px（因为有同步提示条占用了32px空间）
    // Web 环境：18px（没有同步提示条）
    const topOffset = isElectron ? 50 : 18;
    
    // 设置气泡位置（居中显示）
    setBubblePosition({
      top: topOffset,
      left: 50 // 这个值会被 CSS 的 left: 50% 覆盖，但保留以便将来扩展
    });
    
    setShowBubble(true);

    // 设置5秒冷却
    bubbleCooldownRef.current = Date.now() + 5000;
    
    // 🌐 通过 WebSocket 同步气泡提醒到其他用户
    if (roomId && socketService) {
      socketService.sendBubbleReminder(roomId, displayText);
      console.log(`🌐 已发送气泡提醒到房间 ${roomId}: "${displayText}"`);
    }
    
    // 清除之前的定时器
    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
    }
    
    // 3秒后渐进消失
    bubbleTimeoutRef.current = setTimeout(() => {
      setShowBubble(false);
      console.log('🔔 气泡提醒已隐藏');
    }, 3000);
  };

  const handleLanguageChange = async (language: string) => {
    // 只有创建者或系统管理员允许修改房间语言（属于房间信息）
    if (!(isRoomAdmin() || user?.role === 'admin')) {
      message.error(t('room.editPermissionDenied'));
      return;
    }

    console.log('🔄 切换语言:', currentLanguage, '->', language);
    setCurrentLanguage(language);
    socketService.sendLanguageChange(roomId!, language);
    
    // Update Monaco editor language
    if (monacoRef.current && editorRef.current) {
      monacoRef.current.editor.setModelLanguage(
        editorRef.current.getModel(),
        language
      );
    }
    
    // 保存语言设置到数据库
    try {
      console.log('💾 开始保存语言到数据库:', { roomId: roomId, language });
      const response = await roomsAPI.updateRoom(roomId!, { language });
      console.log('✅ Language saved to database successfully:', response.data);
    } catch (error) {
      console.error('❌ Failed to save language to database:', error);
      // 不显示错误提示，避免打断用户操作
    }
  };

  // 🎨 切换编辑器主题（黑底/白底）
  const handleThemeChange = () => {
    // 切换主题
    const newTheme = editorTheme === 'vs-dark' ? 'vs-light' : 'vs-dark';
    setEditorTheme(newTheme);
    
    // 保存到 localStorage
    localStorage.setItem('editor_theme', newTheme);
    
    // 更新 Monaco 编辑器主题
    if (monacoRef.current && editorRef.current) {
      monacoRef.current.editor.setTheme(newTheme);
    }
    
    // 日志记录
    console.log(`🎨 切换编辑器主题: ${editorTheme} -> ${newTheme}`);
    
    // 成功提示
    message.success(
      newTheme === 'vs-dark' 
        ? t('editor.themeDark') || '已切换到深色主题'
        : t('editor.themeLight') || '已切换到浅色主题'
    );
  };

  // 📝 处理字体大小变化
  const handleFontSizeChange = useCallback((value: number) => {
    const clamped = Math.min(30, Math.max(10, Math.round(value)));
    setEditorFontSize(clamped);
    
    // 保存到 localStorage
    localStorage.setItem('editor_fontSize', clamped.toString());
    
    // 更新 Monaco 编辑器字体大小
    if (editorRef.current) {
      editorRef.current.updateOptions({ fontSize: clamped });
    }
    
    // 日志记录
    console.log(`📝 编辑器字体大小已更改: ${clamped}px`);
  }, []);

  // 💡 处理透明度变化
  const handleOpacityChange = (value: number) => {
    setOpacity(value);
    const opacityValue = value / 100;
    
    if (window.api && typeof window.api.setOpacity === 'function') {
      window.api.setOpacity(opacityValue).then(() => {
        // 保存到本地存储
        localStorage.setItem('window-opacity', opacityValue.toString());
        console.log('💡 透明度已设置为:', opacityValue);
      }).catch((err: Error) => {
        console.error('设置透明度失败:', err);
      });
    }
  };

  // 🔄 重置所有设置
  const handleResetSettings = () => {
    Modal.confirm({
      title: t('toolbox.resetConfirmTitle'),
      content: t('toolbox.resetConfirmContent'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => {
        // 重置字体大小
        const defaultFontSize = 14;
        localStorage.removeItem('editor_fontSize');
        setEditorFontSize(defaultFontSize);
        if (editorRef.current) {
          editorRef.current.updateOptions({ fontSize: defaultFontSize });
        }
        
        // 重置透明度
        localStorage.removeItem('window-opacity');
        setOpacity(100);
        if (window.api && typeof window.api.setOpacity === 'function') {
          window.api.setOpacity(1.0);
        }
        
        // 重置主题
        const defaultTheme = 'vs-dark';
        localStorage.removeItem('editor_theme');
        setEditorTheme(defaultTheme);
        if (monacoRef.current && editorRef.current) {
          monacoRef.current.editor.setTheme(defaultTheme);
        }
        
        message.success(t('toolbox.resetSuccess'));
        console.log('🔄 所有设置已重置');
      }
    });
  };

  // 监听字体大小调整快捷键
  useEffect(() => {
    if (!isElectron || !window.electron || !window.electron.ipcRenderer) {
      return;
    }

    const handleIncreaseFontSize = () => {
      const newSize = Math.min(30, editorFontSize + 2);
      handleFontSizeChange(newSize);
      console.log('📝 快捷键增大字体:', newSize);
    };

    const handleDecreaseFontSize = () => {
      const newSize = Math.max(10, editorFontSize - 2);
      handleFontSizeChange(newSize);
      console.log('📝 快捷键减小字体:', newSize);
    };

    const handleResetFontSize = () => {
      const defaultSize = 14;
      handleFontSizeChange(defaultSize);
      console.log('📝 快捷键重置字体:', defaultSize);
    };

    window.electron.ipcRenderer.on('increase-font-size', handleIncreaseFontSize);
    window.electron.ipcRenderer.on('decrease-font-size', handleDecreaseFontSize);
    window.electron.ipcRenderer.on('reset-font-size', handleResetFontSize);

    return () => {
      window.electron.ipcRenderer.removeListener('increase-font-size', handleIncreaseFontSize);
      window.electron.ipcRenderer.removeListener('decrease-font-size', handleDecreaseFontSize);
      window.electron.ipcRenderer.removeListener('reset-font-size', handleResetFontSize);
    };
  }, [editorFontSize, isElectron, handleFontSizeChange]);

  const handleSave = async () => {
    console.log('🔄 保存按钮被点击');
    if (!editorRef.current || !room) {
      console.log('❌ 编辑器或房间不存在');
      return;
    }

    // 🔧 防止并发保存
    if (isSaving.current) {
      console.log('🔄 保存正在进行中，跳过重复保存');
      message.warning(t('editor.savingInProgress'));
      return;
    }

    try {
      isSaving.current = true;
      const content = editorRef.current.getValue();
      console.log('📝 准备保存内容:', content.substring(0, 100) + '...');
      
      await roomsAPI.updateRoom(room.id, {
        content,
        language: currentLanguage
      });
      
      message.success(t('editor.saveSuccess'));
      console.log('✅ 保存成功');
      setLastSavedContent(content); // 更新最后保存的内容
      lastSentContentHash.current = simpleHash(content); // 🔧 更新哈希，避免自动保存重复
    } catch (error: any) {
      console.error('❌ 保存失败:', error);
      
      // 检查是否是404错误，表示房间已被删除
      if (error.response?.status === 404) {
        Modal.error({
          title: t('room.roomDeleted'),
          content: t('room.roomDeletedMessage', { roomName: room.name || '未知房间' }),
          okText: t('common.ok'),
          onOk: () => {
            // 清理资源
            if (bindingRef.current) {
              bindingRef.current.destroy();
            }
            if (providerRef.current) {
              providerRef.current.destroy();
            }
            socketService.disconnect();
            navigate('/dashboard');
          }
        });
        return;
      }
      
      // 检查是否是内容过大错误
      if (error.response?.status === 400 && error.response?.data?.message?.includes('内容过大')) {
        Modal.error({
          title: t('editor.contentTooLarge'),
          content: error.response.data.message,
          okText: t('common.ok'),
        });
        return;
      }
      
      // 其他错误的处理
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error(t('editor.saveFailed'));
      }
    } finally {
      isSaving.current = false; // 🔧 确保保存标志被重置
    }
  };

  const handleLeaveRoom = () => {
    console.log('🚪 退出房间按钮被点击');

    // 外部链接模式：不要用 Modal.confirm（会被 BrowserView 压在底层，看起来“不生效”）
    if (useExternalEditor) {
      try {
        window.electron?.ipcRenderer?.invoke('external-editor:clear').catch(() => {});
      } catch {}

      // 清理资源
      if (bindingRef.current) {
        bindingRef.current.destroy();
      }
      if (providerRef.current) {
        providerRef.current.destroy();
      }
      socketService.leaveRoom();
      socketService.disconnect();
      navigate('/dashboard');
      return;
    }

    Modal.confirm({
      title: t('editor.confirmLeaveRoom'),
      content: t('editor.leaveRoomWarning'),
      okText: t('editor.confirmLeave'),
      cancelText: t('common.cancel'),
      onOk: () => {
        // 确认退出的处理逻辑
        console.log('✅ 用户确认退出房间');
        // 清理资源
        if (bindingRef.current) {
          bindingRef.current.destroy();
        }
        if (providerRef.current) {
          providerRef.current.destroy();
        }
        socketService.leaveRoom();
        socketService.disconnect();

        navigate('/dashboard');
      },
      onCancel: () => {
        // 取消退出的处理逻辑
        console.log('❌ 用户取消退出房间');
      }
    });
  };

  const handleEndRoom = () => {
    console.log('🔚 结束房间按钮被点击');

    Modal.confirm({
      title: t('editor.confirmEndRoom'),
      content: t('editor.endRoomWarning'),
      okText: t('editor.confirmEnd'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      onOk: async () => {
        // 确认结束房间的处理逻辑
        console.log('✅ 用户确认结束房间');
        try {
          // 标记用户主动结束房间
          isEndingRoom.current = true;
          
          await roomsAPI.endRoom(roomId!);
          message.success(t('editor.roomEndSuccess'));
          console.log('✅ 房间结束成功');

          // 清理资源
          if (bindingRef.current) {
            bindingRef.current.destroy();
          }
          if (providerRef.current) {
            providerRef.current.destroy();
          }
          socketService.leaveRoom();
          socketService.disconnect();

          navigate('/dashboard');
        } catch (error: any) {
          console.error('❌ 结束房间失败:', error);
          if (error.response?.data?.message) {
            message.error(error.response.data.message);
          } else {
            message.error(t('editor.endRoomFailed'));
          }
        }
      },
      onCancel: () => {
        // 取消结束房间的处理逻辑
        console.log('❌ 用户取消结束房间');
      }
    });
  };

  // 同步房间创建人的内容
  const handleSyncContent = async () => {
    // 🔒 检查执行锁，防止重复触发
    if (syncExecutingRef.current) {
      console.log('⚠️ 同步正在执行中，忽略重复触发');
      return;
    }
    
    if (!roomId || !room || isSyncing) {
      return;
    }

    // 检查冷却时间（1分钟内只能同步一次）
    const now = Date.now();
    const COOLDOWN_TIME = 60 * 1000; // 1分钟
    if (lastSyncTime && (now - lastSyncTime) < COOLDOWN_TIME) {
      const remainingTime = Math.ceil((COOLDOWN_TIME - (now - lastSyncTime)) / 1000);
      message.warning(t('editor.syncCooldown', { seconds: remainingTime }));
      return;
    }

    try {
      // 🔒 设置执行锁
      syncExecutingRef.current = true;
      console.log('🔒 已设置同步执行锁');
      
      setIsSyncing(true);
      message.loading({ content: t('editor.syncing'), key: 'sync' });

      // 如果当前用户不是房间创建人，先请求创建人保存内容
      if (!isRoomAdmin()) {
        console.log('🔄 非管理员触发同步，请求房间创建人保存内容');
        console.log('🔄 发送 requestCreatorSave 到房间:', roomId);
        socketService.requestCreatorSave(roomId);
        
        // 等待创建人的保存确认，最多等待10秒
        console.log('🔄 等待创建人保存确认...');
        const saveConfirmed = await new Promise<boolean>((resolve, reject) => {
          // 保存Promise的resolve和reject函数
          savePendingPromise.current = { resolve, reject };
          
          // 设置超时，10秒后自动继续
          saveTimeoutRef.current = setTimeout(() => {
            if (savePendingPromise.current) {
              console.log('⏰ 等待保存确认超时，继续同步流程');
              savePendingPromise.current.resolve(false);
              savePendingPromise.current = null;
            }
            saveTimeoutRef.current = null;
          }, 10000);
        });
        
        if (saveConfirmed) {
          console.log('✅ 收到保存确认，继续同步流程');
        } else {
          console.log('⏰ 超时或未收到确认，仍继续同步流程');
        }
        
        // 额外等待500ms确保数据库写入完成
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // 从后端获取最新的房间内容（添加时间戳避免缓存）
      console.log('🔄 从数据库获取最新房间内容...');
      const response = await roomsAPI.getRoom(roomId, true); // skipCache = true
      const latestRoom = response.data;

      console.log('🔄 获取到的房间数据:', {
        id: latestRoom?.id,
        name: latestRoom?.name,
        contentLength: latestRoom?.content?.length || 0,
        contentPreview: latestRoom?.content?.substring(0, 100) || '',
        language: latestRoom?.language
      });

      if (!latestRoom) {
        console.log('❌ 房间数据为空');
        message.error({ content: t('editor.syncFailed'), key: 'sync' });
        setIsSyncing(false);
        syncExecutingRef.current = false; // 🔓 释放执行锁
        return;
      }

      // 同步语言设置
      console.log('🔄 检查语言同步:', {
        fromDB: latestRoom.language,
        current: currentLanguage,
        needSync: latestRoom.language && latestRoom.language !== currentLanguage
      });
      
      if (latestRoom.language && latestRoom.language !== currentLanguage) {
        console.log('🔄 同步语言:', currentLanguage, '->', latestRoom.language);
        setCurrentLanguage(latestRoom.language);
        // 更新Monaco编辑器语言
        if (monacoRef.current && editorRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            monacoRef.current.editor.setModelLanguage(model, latestRoom.language);
          }
        }
      } else {
        console.log('🔄 语言无需同步，保持当前语言:', currentLanguage);
      }

      // 直接同步内容，不检查差异，不需要确认
      console.log('🔄 开始同步内容到编辑器...');
      
      try {
        // 使用 Y.js 文档更新内容，确保同步到所有客户端
        if (yjsDocRef.current) {
          const yText = yjsDocRef.current.getText('content');
          const syncContent = latestRoom.content || ''; // 如果内容为空，同步为空字符串
          
          console.log('🔄 通过 Y.js 同步内容，长度:', syncContent.length);
          
          // 在事务中更新内容，避免冲突
          yjsDocRef.current.transact(() => {
            yText.delete(0, yText.length); // 清空现有内容
            yText.insert(0, syncContent); // 插入最新内容
          }, 'sync-from-creator');

          setLastSavedContent(syncContent);
          lastSentContentHash.current = simpleHash(syncContent);
          
          message.success({ content: t('editor.syncSuccess'), key: 'sync' });
          setLastSyncTime(Date.now()); // 记录同步时间
        } else {
          // 如果 Y.js 不可用，直接更新编辑器
          if (editorRef.current) {
            const syncContent = latestRoom.content || '';
            console.log('🔄 通过编辑器 setValue 同步内容，长度:', syncContent.length);
            
            editorRef.current.setValue(syncContent);
            setLastSavedContent(syncContent);
            lastSentContentHash.current = simpleHash(syncContent);
            message.success({ content: t('editor.syncSuccess'), key: 'sync' });
            setLastSyncTime(Date.now()); // 记录同步时间
          }
        }
      } catch (error) {
        console.error('同步内容失败:', error);
        message.error({ content: t('editor.syncFailed'), key: 'sync' });
      }
    } catch (error: any) {
      console.error('获取最新内容失败:', error);
      
      if (error.response?.status === 404) {
        message.error({ content: t('room.roomNotFound'), key: 'sync' });
      } else {
        message.error({ content: t('editor.syncFailed'), key: 'sync' });
      }
    } finally {
      setIsSyncing(false);
      syncExecutingRef.current = false; // 🔓 释放执行锁
      console.log('🔓 已释放同步执行锁');
    }
  };

  // 将同步函数赋值给 ref，供快捷键使用
  syncHandlerRef.current = handleSyncContent;

  const copyRoomCode = async (roomCode?: string) => {
    if (!roomCode) {
      message.error(t('editor.roomCodeNotFound'));
      return;
    }

    try {
      await navigator.clipboard.writeText(roomCode);
      message.success(t('room.roomCodeCopied'));
    } catch (error) {
      message.error(t('editor.copyFailed', { roomCode }));
    }
  };

  // 检查用户是否为房间管理员
  const isRoomAdmin = () => {
    const currentMember = room?.members?.find(m => m.user.id === user?.id);
    const isAdmin = currentMember?.role === 'admin';
    // console.log('🔐 权限检查:', {
    //   userId: user?.id,
    //   currentMember,
    //   isAdmin,
    //   allMembers: room?.members?.map(m => ({ userId: m.user.id, role: m.role }))
    // });
    return isAdmin;
  };

  if (loading) {
    return <div>{t('common.loading')}</div>;
  }

  if (useExternalEditor && room?.coderpadUrl) {
    const expiresAtMs = room.coderpadExpiresAt ? new Date(room.coderpadExpiresAt).getTime() : 0;
    const isLinkExpired = Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs <= Date.now();
    const canEditLink = isRoomAdmin() || user?.role === 'admin';

    if (isLinkExpired) {
      // 过期时强制阻断使用：清掉 BrowserView，提示先更新链接
      if (isElectron && window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.invoke('external-editor:clear').catch(() => {});
      }

      return (
        <Layout style={{ height: '100vh' }}>
          <Content style={{ padding: 24 }}>
            <div style={{ maxWidth: 560, margin: '0 auto' }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
                {t('room.codeLinkExpired') || '链接已过期'}
              </div>
              <div style={{ color: '#666', marginBottom: 16, lineHeight: 1.6 }}>
                {canEditLink
                  ? (t('room.codeLinkExpiredAdminHint') || '该房间的代码链接已超过有效期，请先在 Dashboard 中编辑房间并更新链接/有效期后再继续使用。')
                  : (t('room.codeLinkExpiredUserHint') || '该房间的代码链接已超过有效期，请联系创建者更新链接后再进入。')}
              </div>

              <Space>
                <Button type="primary" onClick={() => navigate('/dashboard')}>
                  {t('dashboard.title') || '返回 Dashboard'}
                </Button>
                <Button onClick={handleLeaveRoom}>{t('room.leaveRoom')}</Button>
              </Space>
            </div>
          </Content>
        </Layout>
      );
    }

    return (
      <Layout style={{ height: '100vh' }}>
        <Content style={{ padding: 0, position: 'relative', height: '100%' }}>
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            zIndex: 10001,
            background: 'rgba(255,255,255,0.95)',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
            borderLeft: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 0,
            backdropFilter: 'blur(8px)',
            padding: '0 6px',
            height: 32,
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={handleLeaveRoom}>
              {t('room.leaveRoom')}
            </Button>

            {room.roomCode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderLeft: '1px solid #e0e0e0', paddingLeft: 6 }}>
                <span style={{ fontSize: 11, color: '#999' }}>{t('room.roomCode')}</span>
                <Tag
                  color="purple"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    lineHeight: '16px',
                    padding: '0 4px',
                  }}
                  onClick={() => copyRoomCode(room.roomCode)}
                >
                  {room.roomCode}
                </Tag>
              </div>
            )}

            <Button
              size="small"
              icon={<GlobalOutlined />}
              type="primary"
              onClick={() => window.open(room.coderpadUrl!, '_blank')}
            >
              {t('room.enterWebVersion')}
            </Button>

            <Button
              size="small"
              icon={<ToolOutlined />}
              onClick={() => setShowToolbox(!showToolbox)}
            />

            {isElectron && showToolbox && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderLeft: '1px solid #e0e0e0',
                paddingLeft: 6,
                marginLeft: 2
              }}>
                <span style={{ fontSize: 11, color: '#666', fontWeight: 600, minWidth: 34, textAlign: 'right' }}>
                  {opacity}%
                </span>
                <Slider
                  min={10}
                  max={100}
                  value={opacity}
                  onChange={handleOpacityChange}
                  tooltip={{ open: false }}
                  style={{ width: 120 }}
                />
              </div>
            )}
          </div>

          <div style={{ width: '100%', height: '100%' }} />

        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 顶部重连状态条 */}
      {showReconnectingBar && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          background: '#ff7875',
          color: 'white',
          padding: '8px 16px',
          textAlign: 'center',
          fontSize: '14px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <span style={{ 
            display: 'inline-block',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: 'white',
            animation: 'pulse 1.5s ease-in-out infinite'
          }}></span>
          {!isOnline ? t('editor.networkDisconnected') :
           yjsConnectionStatus === 'connecting' ? t('editor.connectingCollaboration') : 
           yjsConnectionStatus === 'reconnecting' ? t('editor.networkReconnecting') :
           isReconnecting ? t('editor.socketReconnecting') : t('editor.connectionInterrupted')}
          
          {/* 添加手动重连按钮 */}
          {(yjsConnectionStatus === 'disconnected' || !socketService.isConnected) && isOnline && (
            <button
              onClick={() => {
                if (yjsConnectionStatus === 'disconnected') {
                  reconnectYjs();
                }
                if (!socketService.isConnected) {
                  initializeCollaboration();
                }
              }}
              style={{
                marginLeft: '12px',
                padding: '4px 12px',
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '4px',
                color: 'white',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              {t('editor.reconnectNow')}
            </button>
          )}
        </div>
      )}
      
      <Header style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginTop: showReconnectingBar ? '44px' : '0', // 为重连条留出空间
      }}>
        <Space>
          {/* 所有用户都可以退出房间返回Dashboard */}
          <Tooltip title={t('editor.leaveRoomHint') || '退出当前房间，返回房间列表'}>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={handleLeaveRoom}
            >
              {t('room.leaveRoom')}
            </Button>
          </Tooltip>
          <div style={{display:'flex',alignItems: 'center'}}>
            {room?.roomCode && (
              <div style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '6px'
              }}>
                <div style={{
                  fontSize: '10px',
                  color: '#999',
                  fontWeight: 400
                }}>
                  {t('room.roomCode')}
                </div>
                <Tag
                  color="purple"
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    lineHeight: '16px',
                    padding: '0 6px',
                  }}
                  onClick={() => copyRoomCode(room.roomCode)}
                >
                  {room.roomCode}
                </Tag>
              </div>
            )}
          </div>
        </Space>

        <Space>
          {/* 穿透模式指示器 */}
          {isMouseThroughMode && (
            <div
              style={{
                color: '#ff4d4f',
                backgroundColor: 'rgba(255, 77, 79, 0.1)',
                padding: '4px 12px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '600',
                animation: 'pulse 2s infinite',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                border: '1px solid rgba(255, 77, 79, 0.3)',
                boxShadow: '0 2px 4px rgba(255, 77, 79, 0.15)'
              }}
            >
              <span style={{ fontSize: '16px' }}>🔓</span>
              <style>{`
                @keyframes pulse {
                  0% { opacity: 1; }
                  50% { opacity: 0.7; }
                  100% { opacity: 1; }
                }
              `}</style>
            </div>
          )}

          {/* 所有用户都可以选择语言 */}
          <Tooltip title={t('editor.selectLanguageHint') || '选择代码编辑语言'}>
            <Select
              value={currentLanguage}
              onChange={handleLanguageChange}
              disabled={!(isRoomAdmin() || user?.role === 'admin')}
              style={{ width: 120 }}
            >
              <Option value="javascript">JavaScript</Option>
              <Option value="typescript">TypeScript</Option>
              <Option value="python">Python</Option>
              <Option value="java">Java</Option>
              <Option value="cpp">C++</Option>
              <Option value="csharp">C#</Option>
              <Option value="go">Go</Option>
              <Option value="rust">Rust</Option>
            </Select>
          </Tooltip>

          {/* 🎨 主题切换按钮（黑底/白底） */}
          <Tooltip title={editorTheme === 'vs-dark' ? (t('editor.switchToLight') || '切换到浅色主题') : (t('editor.switchToDark') || '切换到深色主题')}>
            <Button 
              onClick={handleThemeChange}
              icon={editorTheme === 'vs-dark' ? '🌙' : '☀️'}
            >
              {editorTheme === 'vs-dark' ? t('editor.lightTheme') || '浅色' : t('editor.darkTheme') || '深色'}
            </Button>
          </Tooltip>

          {/* 🔔 气泡提醒按钮 - 仅Web端显示，Electron端隐藏但功能保留 */}
          {!isElectron && (
            <Button 
              onClick={handleShowBubble}
              icon={'🔔'}
            >
              {t('editor.bubble') || '气泡提醒'}
              <Tooltip title={t('editor.showBubbleHint') || '气泡显示选中文本，可给候选人关键提示信息，防止代码太多，漏看，长度限制20字符'}>
                <span style={{ 
                  marginLeft: '6px',
                  fontSize: '12px',
                  color: '#595959',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '50%',
                  width: '18px',
                  height: '18px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'help',
                  fontWeight: 'bold',
                  transition: 'all 0.2s',
                  border: '1px solid #d9d9d9'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#1890ff';
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = '#1890ff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f5f5f5';
                  e.currentTarget.style.color = '#595959';
                  e.currentTarget.style.borderColor = '#d9d9d9';
                }}
                >?</span>
              </Tooltip>
            </Button>
          )}

          {/* 只有房间创建人可以保存 */}
          {!isElectron && isRoomAdmin() && (
            <Tooltip title={t('editor.saveCodeHint') || '保存当前代码到数据库'}>
              <Button icon={<SaveOutlined />} onClick={handleSave}>
                {t('common.save')}
              </Button>
            </Tooltip>
          )}

          {/* 同步按钮 - 只有非创建人才显示，用于同步房间创建人的最新内容 (全局快捷键: Cmd+Shift+" / Ctrl+Shift+") */}
           {!isRoomAdmin() && (
            <Tooltip title={cooldownRemaining > 0 ? t('editor.syncCooldownTitle', { seconds: cooldownRemaining }) : (t('editor.syncContentHint') || '从房间创建人同步最新代码')}>
              <Button 
                danger
                icon={cooldownRemaining > 0 ? <ExclamationCircleOutlined /> : <SyncOutlined spin={isSyncing} />} 
                onClick={handleSyncContent}
                loading={isSyncing}
                disabled={isSyncing || cooldownRemaining > 0}
              >
                {cooldownRemaining > 0 ? t('editor.syncCooldownButton', { seconds: cooldownRemaining }) : t('editor.syncContent')}
              </Button>
            </Tooltip>
           )}

          {/* 只有房间管理员可以结束房间 */}
          {isRoomAdmin() && (
            <Tooltip title={t('editor.endRoomHint') || '结束房间，所有成员将被退出'}>
              <Button
                danger
                onClick={handleEndRoom}
                style={{ marginLeft: 8 }}
              >
                {t('room.endRoom')}
              </Button>
            </Tooltip>
          )}

          {/* 已按需求移除“复制房间号”入口 */}
        </Space>
      </Header>

      <Layout>
        <Content style={{ padding: 0, paddingBottom: '32px', position: 'relative' }}>
          {/* 代码同步提示条 - 仅在 Electron 环境下显示（所有用户包括管理员） */}
          {isElectron && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              background: 'linear-gradient(90deg, rgba(24, 144, 255, 0.15) 0%, rgba(82, 196, 26, 0.15) 100%)',
              borderBottom: '1px solid rgba(24, 144, 255, 0.3)',
              padding: '6px 16px',
              fontSize: '13px',
              color: '#1890ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              backdropFilter: 'blur(4px)'
            }}>
              <span style={{ fontSize: '16px' }}>💡</span>
              <span>
                {t('editor.formatSyncHint')} 
                <kbd style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  margin: '0 4px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.3)'
                }}>
                  {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd + Shift + "' : 'Ctrl + Shift + "'}
                </kbd>
                {t('editor.formatSyncHintShortcut')}
              </span>
            </div>
          )}
          
          <div style={{ paddingTop: isElectron ? '32px' : '0', height: '100%' }}>
            <Editor
              height="100%"
              language={currentLanguage}
              theme={editorTheme}
              onMount={handleEditorDidMount}
              options={{
              fontSize: editorFontSize,
              minimap: { enabled: true },
              wordWrap: 'on',
              automaticLayout: true,
              scrollBeyondLastLine: false,
              // 🔧 空格和缩进设置 - 确保所有用户编辑器行为一致，避免协同编辑时空格丢失
              insertSpaces: true,        // 强制使用空格而不是制表符
              tabSize: 2,                // Tab 键对应 2 个空格
              detectIndentation: false,  // 禁用自动检测缩进，使用统一设置
              trimAutoWhitespace: true,  // 自动删除行尾空格
            }}
          />
          </div>

          {/* 🔔 气泡提醒显示组件 */}
          {showBubble && (
            <div
              style={{
                position: 'absolute',
                top: `${bubblePosition.top}px`,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'linear-gradient(135deg, #fff9c4 0%, #fff59d 50%, #ffeb3b 100%)',
                color: '#333',
                padding: '10px 20px',
                borderRadius: '8px',
                boxShadow: '0 4px 16px rgba(255, 235, 59, 0.3)',
                border: '1px solid rgba(255, 193, 7, 0.3)',
                zIndex: 1000,
                pointerEvents: 'none',
                fontSize: '14px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '300px',
                animation: 'bubbleFadeIn 0.3s ease-out, bubbleFadeOut 0.5s ease-in 2.5s forwards',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span style={{ fontSize: '16px' }}>🔔</span>
              <span style={{ fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace' }}>
                {bubbleText}
              </span>
            </div>
          )}

          {/* 🧰 工具箱 */}
          <>
            {/* 工具箱按钮 */}
            <div
              style={{
                position: 'fixed',
                bottom: '20px',
                right: showToolbox ? '240px' : '10px',
                zIndex: 10000,
                transition: 'right 0.3s ease',
                cursor: 'pointer',
                backgroundColor: '#1890ff',
                color: 'white',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                opacity: showToolbox ? 0.7 : 1,
              }}
              onClick={() => setShowToolbox(!showToolbox)}
              title={t('toolbox.title')}
            >
              <ToolOutlined style={{ fontSize: '18px' }} />
            </div>

            {/* 工具箱面板 */}
            {showToolbox && (
              <Card
                size="small"
                title={`🧰 ${t('toolbox.title')}`}
                style={{
                  position: 'fixed',
                  bottom: '20px',
                  right: '10px',
                  zIndex: 9999,
                  width: '220px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}
                styles={{
                  body: {
                    padding: '16px',
                  }
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* 字体大小控制 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ 
                      marginBottom: '4px'
                    }}>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: '#333' }}>
                        {t('toolbox.fontSize')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: '#666' }}>{t('toolbox.small')}</span>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#52c41a' }}>
                        {editorFontSize}px
                      </span>
                      <span style={{ fontSize: '12px', color: '#666' }}>{t('toolbox.large')}</span>
                    </div>
                    <Slider
                      min={10}
                      max={30}
                      value={editorFontSize}
                      onChange={handleFontSizeChange}
                      tooltip={{ formatter: (value) => `${value}px` }}
                    />
                    <div style={{ fontSize: '11px', color: '#999' }}>
                      {t('toolbox.fontSizeHint')}
                    </div>
                    {isElectron && (
                      <div style={{ fontSize: '11px', color: '#999' }}>
                        {t('toolbox.fontSizeShortcut')}
                      </div>
                    )}
                  </div>

                  {/* 透明度控制（仅在 Electron 环境中显示） */}
                  {isElectron && (
                    <>
                      <div style={{ 
                        height: '1px', 
                        background: 'linear-gradient(to right, transparent, #e0e0e0, transparent)',
                        margin: '0 -4px'
                      }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ 
                          marginBottom: '4px'
                        }}>
                          <span style={{ fontSize: '13px', fontWeight: '500', color: '#333' }}>
                            {t('toolbox.windowOpacity')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', color: '#666' }}>{t('toolbox.opaque')}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#1890ff' }}>
                            {opacity}%
                          </span>
                          <span style={{ fontSize: '12px', color: '#666' }}>{t('toolbox.transparent')}</span>
                        </div>
                        <Slider
                          min={10}
                          max={100}
                          value={opacity}
                          onChange={handleOpacityChange}
                          tooltip={{ formatter: (value) => `${value}%` }}
                        />
                        <div style={{ fontSize: '11px', color: '#999' }}>
                          {t('toolbox.opacityShortcut')}
                        </div>
                      </div>
                    </>
                  )}

                  {/* 重置按钮 */}
                  <div style={{ 
                    borderTop: '1px solid #e0e0e0',
                    paddingTop: '12px',
                    marginTop: '8px'
                  }}>
                    <Button 
                      icon={<ReloadOutlined />}
                      onClick={handleResetSettings}
                      block
                      type="default"
                      danger
                    >
                      {t('toolbox.resetSettings')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </>
        </Content>

      </Layout>

      {/* 底部紧凑在线用户列表 */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#fff',
        borderTop: '1px solid #e9ecef',
        padding: '6px 12px',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '32px',
        zIndex: 999,
        boxShadow: '0 -1px 4px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
       
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flex: 1,
          overflow: 'auto'
        }}>
          {onlineUsers.map((onlineUser) => (
            <div key={onlineUser.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              minWidth: 'auto',
              whiteSpace: 'nowrap'
            }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  backgroundColor: getUserColor(onlineUser.id),
                  flexShrink: 0
                }}
              />
              <span style={{
                fontSize: '11px',
                color: '#333',
                fontWeight: onlineUser?.id === user?.id ? '500' : '400'
              }}>
                {onlineUser?.username || t('editor.unknownUser')}
                {onlineUser?.id === user?.id && ' (我)'}
              </span>
            </div>
          ))}
        </div>
      </div>

    </Layout>
  );
};

export default CollaborativeEditor;
