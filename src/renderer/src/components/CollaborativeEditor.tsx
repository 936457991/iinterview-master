import React, { useEffect, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import {
  Layout,
  Typography,
  Space,
  Button,
  Select,
  message,
  Modal,
} from 'antd';

import {
  ArrowLeftOutlined,
  SaveOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import socketService from '../services/socket';
import { roomsAPI } from '../services/api';
import { useTranslation } from 'react-i18next';
import { getCurrentConfig } from '../config';
import './CollaborativeEditor.css';

const { Header, Content } = Layout;
const { Title } = Typography;
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

  const [room, setRoom] = useState<RoomData | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [currentLanguage, setCurrentLanguage] = useState('javascript');
  const [loading, setLoading] = useState(true);
  // 穿透模式状态
  const [isMouseThroughMode, setIsMouseThroughMode] = useState(false);
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
      
      // 应用装饰
      const newDecorations = editorRef.current.deltaDecorations(cursorDecorations.current, decorations);
      cursorDecorations.current = newDecorations;
      console.log('🎨 Applied decorations, new decoration IDs:', newDecorations);
    } catch (error) {
      console.error('🎨 Error applying cursor decorations:', error);
    } finally {
      // 🔧 重置更新标志
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
      
      // 应用装饰
      const newDecorations = editorRef.current.deltaDecorations(selectionDecorations.current, decorations);
      selectionDecorations.current = newDecorations;
    } catch (error) {
      console.error('🎨 Error applying selection decorations:', error);
    } finally {
      // 🔧 重置更新标志
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

    // 🔧 并行初始化，提高加载速度
    Promise.all([
      loadRoomData(),
      initializeCollaboration()
    ]).catch((error) => {
      console.error('🚨 Initialization failed:', error);
      setLoading(false); // 即使失败也要清除加载状态
    });

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

  const loadRoomData = async () => {
    try {
      console.log('🔄 Loading room data...');
      
      const response = await roomsAPI.getRoom(roomId!);
      const roomData = response.data;
      setRoom(roomData);
      setCurrentLanguage(roomData.language);
      
      // 🔧 标记房间数据加载完成
      setInitializationSteps(prev => ({
        ...prev,
        roomDataLoaded: true
      }));
      
      console.log('✅ Room data loaded successfully');
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
        return;
      }
      
      // 其他错误
      message.error(t('editor.loadRoomFailed'));
      navigate('/dashboard');
    }
  };

  const initializeCollaboration = async () => {
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
        // 禁用二进制协议，使用文本协议避免数据格式问题
        disableBc: true,
        // 🔧 增强重连参数，优化网络稳定性
        maxBackoffTime: 3000, // 最大退避时间3秒，更快重连
        resyncInterval: 20000, // 20秒重新同步一次，减少网络压力
        // 添加参数
        params: {
          userId: user?.id || '',
          username: user?.username || ''
        },
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

    // 重置标志
    isEndingRoom.current = false;
  };

  // 定时保存功能 - 每3秒保存一次
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
      console.log('🎯 My cursor position changed:', position);
      console.log('🎯 My user info:', { id: user?.id, username: user?.username });
      console.log('🎯 Room ID:', roomId);
      console.log('🎯 Socket connected:', socketService.isConnected);
      console.log('🎯 Is updating from remote:', isUpdatingFromRemote.current);

      // 多重检查：确保不是远程更新触发的光标变化
      if (isUpdatingFromRemote.current) {
        console.log('🎯 ❌ SKIPPING: This is a remote update, not sending cursor position');
        return;
      }

      // 检查是否在最近的远程更新时间窗口内（优化为更短的时间窗口）
      const timeSinceLastRemoteUpdate = Date.now() - lastRemoteUpdateTime.current;
      if (timeSinceLastRemoteUpdate < 800) { // 减少到800ms，提高响应性
        console.log('🎯 ❌ SKIPPING: Too soon after remote update, likely caused by Yjs sync');
        return;
      }

      // 延迟发送光标位置，避免与Yjs更新冲突
      setTimeout(() => {
        // 再次检查是否仍然不是远程更新
        if (!isUpdatingFromRemote.current && socketService.isConnected) {
          console.log('🎯 ✅ Sending MY cursor position to server (user action)...');
          socketService.sendCursorPosition(roomId!, position);
        } else {
          console.log('🎯 ❌ SKIPPING delayed cursor send: remote update flag is set or socket disconnected');
        }
      }, 50); // 50ms延迟，让Yjs更新完成
    });

    // Handle keyboard input for typing status - 更可靠的方法
    editor.onKeyDown((e: any) => {
      console.log('⌨️ Key pressed:', e.keyCode, e.code);

      // 只有在输入可见字符或删除键时才认为是打字
      const isTypingKey = (
        (e.keyCode >= 32 && e.keyCode <= 126) || // 可见字符
        e.keyCode === 8 || // Backspace
        e.keyCode === 46 || // Delete
        e.keyCode === 13 || // Enter
        e.keyCode === 9 // Tab
      );

      if (!isTypingKey) {
        console.log('⌨️ ❌ Not a typing key, skipping');
        return;
      }

      const now = Date.now();
      console.log('⌨️ ===== USER IS TYPING (KEYBOARD) =====');
      console.log('⌨️ Detected user keyboard input');
      console.log('⌨️ My user info:', { id: user?.id, username: user?.username });
      console.log('⌨️ Key code:', e.keyCode);

      // 防抖：如果距离上次发送不到500ms，则取消之前的定时器并重新设置
      if (typingDebounceTimeout.current) {
        clearTimeout(typingDebounceTimeout.current);
      }

      // 如果距离上次发送超过1秒，立即发送；否则延迟发送
      const timeSinceLastTyping = now - lastTypingTime.current;
      const shouldSendImmediately = timeSinceLastTyping > 1000;

      const sendTypingEvent = () => {
        if (socketService.isConnected && roomId && user) {
          console.log('⌨️ ✅ Sending typing event to other users');
          socketService.sendUserTyping(roomId);
          lastTypingTime.current = Date.now();

          // 同时在本地显示自己的打字状态
          console.log('⌨️ ✅ Adding myself to local typing users');
          setTypingUsers(prev => {
            const newSet = new Set(prev).add(user.id);
            console.log('⌨️ Local typing users after adding myself:', Array.from(newSet));
            return newSet;
          });

          // 清除之前的超时
          if (typingTimeout.current.has(user.id)) {
            clearTimeout(typingTimeout.current.get(user.id)!);
          }

          // 设置新的超时，5秒后移除自己的打字状态
          const timeout = setTimeout(() => {
            console.log('⌨️ Removing my own typing status');
            setTypingUsers(prev => {
              const newSet = new Set(prev);
              newSet.delete(user.id);
              console.log('⌨️ Remaining typing users after removing myself:', Array.from(newSet));
              return newSet;
            });
            typingTimeout.current.delete(user.id);
          }, 5000);

          typingTimeout.current.set(user.id, timeout);
        }
      };

      if (shouldSendImmediately) {
        console.log('⌨️ Sending immediately (>1s since last)');
        sendTypingEvent();
      } else {
        console.log('⌨️ Debouncing typing event (500ms delay)');
        typingDebounceTimeout.current = setTimeout(() => {
          sendTypingEvent();
          typingDebounceTimeout.current = null;
        }, 500);
      }

      console.log('⌨️ ===== END TYPING EVENT PROCESSING =====');
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
        console.log('📝 Sending selection change:', selectionData);
        socketService.sendSelectionChange(roomId!, selectionData);

      } else {
        // 选择区域为空时，清除该用户的选择
        console.log('🗑️ Sending selection clear');
        socketService.sendSelectionClear(roomId!);
      }
    });
  };

  const handleLanguageChange = (language: string) => {
    setCurrentLanguage(language);
    socketService.sendLanguageChange(roomId!, language);
    
    // Update Monaco editor language
    if (monacoRef.current && editorRef.current) {
      monacoRef.current.editor.setModelLanguage(
        editorRef.current.getModel(),
        language
      );
    }
  };

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
    console.log('🔐 权限检查:', {
      userId: user?.id,
      currentMember,
      isAdmin,
      allMembers: room?.members?.map(m => ({ userId: m.user.id, role: m.role }))
    });
    return isAdmin;
  };

  if (loading) {
    return <div>{t('common.loading')}</div>;
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
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleLeaveRoom}
          >
            {t('room.leaveRoom')}
          </Button>
          <div style={{display:'flex',alignItems: 'center'}}>
            <Title level={4} style={{ margin: 0, lineHeight: 1.2 }}>
              {room?.name}
            </Title>
            {room?.roomCode && (
              <div style={{
                fontSize: '12px',
                marginLeft: '8px',
                color: '#666',
                marginTop: '2px',
                fontFamily: 'monospace'
              }}>
                {t('room.roomCode')}: {room.roomCode}
              </div>
            )}
          </div>
        </Space>

        <Space>
          {/* 穿透模式指示器 */}
          {isMouseThroughMode && (
            <div
              style={{
                color: 'rgba(255, 0, 0, 0.9)',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: 'bold',
                animation: 'pulse 2s infinite',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              🔓 处于穿透模式
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
          <Select
            value={currentLanguage}
            onChange={handleLanguageChange}
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

          {/* 所有房间成员都可以保存 */}
          <Button icon={<SaveOutlined />} onClick={handleSave}>
            {t('common.save')}
          </Button>

          {/* 只有房间管理员可以结束房间 */}
          {isRoomAdmin() && (
            <Button
              danger
              onClick={handleEndRoom}
              style={{ marginLeft: 8 }}
            >
              {t('room.endRoom')}
            </Button>
          )}

          {/* 只有房间管理员可以分享 */}
          {isRoomAdmin() && (
            <Button icon={<ShareAltOutlined />} onClick={() => copyRoomCode(room?.roomCode)}>
              {t('common.share')}
            </Button>
          )}
        </Space>
      </Header>

      <Layout>
        <Content style={{ padding: 0, paddingBottom: '32px' }}>
          <Editor
            height="100%"
            language={currentLanguage}
            theme="vs-dark"
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              minimap: { enabled: true },
              wordWrap: 'on',
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
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
