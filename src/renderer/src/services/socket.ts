import { io, Socket } from 'socket.io-client';
import { getCurrentConfig, initConfig } from '../config';

class SocketService {
  private socket: Socket | null = null;
  private currentRoomId: string | null = null;
  private configInitialized = false;

  private async ensureConfigInitialized() {
    if (!this.configInitialized) {
      await initConfig();
      this.configInitialized = true;
    }
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) {
      console.log('🔗 Socket already connected');
      return;
    }

    await this.ensureConfigInitialized();
    const config = getCurrentConfig();

    console.log('🔗 Connecting to Socket.IO server:', config.api.baseURL);

    // Get auth token if available
    const token = localStorage.getItem('token');

    this.socket = io(config.api.baseURL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: token ? { token } : undefined,
      extraHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    // Return a Promise that resolves when connection is established
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Failed to create socket'));
        return;
      }

      this.socket.on('connect', () => {
        console.log('✅ Connected to server, socket ID:', this.socket?.id);
        console.log('✅ Socket connected state:', this.socket?.connected);
        
        // 🔧 如果是重连且之前有房间，自动重新加入房间
        if (this.currentRoomId && (window as any).currentUser) {
          console.log('🔄 Reconnected - auto rejoining room:', this.currentRoomId);
          setTimeout(() => {
            this.joinRoom(this.currentRoomId!, (window as any).currentUser);
          }, 100); // 短暂延迟确保连接稳定
        }
        
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected from server, reason:', reason);
        // 保持currentRoomId，用于重连时自动重新加入
      });

      // 🔧 添加重连事件监听
      this.socket.on('reconnect', (attemptNumber) => {
        console.log('🔄 Reconnected after', attemptNumber, 'attempts');
        // 重连后自动重新加入房间
        if (this.currentRoomId && (window as any).currentUser) {
          console.log('🔄 Auto rejoining room after reconnection:', this.currentRoomId);
          setTimeout(() => {
            this.joinRoom(this.currentRoomId!, (window as any).currentUser);
          }, 200);
        }
      });

      this.socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('🔄 Attempting to reconnect...', attemptNumber);
      });

      this.socket.on('error', (error) => {
        console.error('🚨 Socket error:', error);
        reject(error);
      });

      this.socket.on('connect_error', (error) => {
        console.error('🚨 Socket connection error:', error);
        reject(error);
      });

      // Set a timeout to avoid hanging forever
      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error('Socket connection timeout'));
        }
      }, 10000); // 10 second timeout
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentRoomId = null;
    }
  }

  joinRoom(roomId: string, user: any) {
    console.log('🏠 joinRoom called with:', { roomId, user });
    console.log('🏠 Socket exists:', !!this.socket);
    console.log('🏠 Socket connected:', this.socket?.connected);
    console.log('🏠 Socket ID:', this.socket?.id);

    if (!this.socket) {
      console.error('🚨 Socket object is null/undefined when trying to join room');
      return;
    }

    if (!this.socket.connected) {
      console.error('🚨 Socket exists but not connected when trying to join room');
      console.error('🚨 Socket connected state:', this.socket.connected);
      console.error('🚨 Socket readyState:', (this.socket as any).readyState);
      return;
    }

    console.log('🏠 ✅ Socket is ready, joining room:', roomId, 'with user:', user);
    this.currentRoomId = roomId;
    this.socket.emit('join-room', { roomId, user });
    console.log('🏠 join-room event emitted');
  }

  leaveRoom() {
    if (!this.socket || !this.currentRoomId) return;

    this.socket.emit('leave-room');
    this.currentRoomId = null;
  }

  sendContentChange(roomId: string, delta: any, content: string) {
    if (!this.socket) return;

    this.socket.emit('content-change', { roomId, delta, content });
  }

  sendCursorPosition(roomId: string, position: any) {
    if (!this.socket) return;

    this.socket.emit('cursor-position', { roomId, position });
  }

  sendLanguageChange(roomId: string, language: string) {
    if (!this.socket) return;

    this.socket.emit('language-change', { roomId, language });
  }

  sendSelectionChange(roomId: string, selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) {
    if (!this.socket) return;
    this.socket.emit('selection-change', { roomId, selection });
  }

  sendSelectionClear(roomId: string) {
    if (!this.socket) return;
    this.socket.emit('selection-clear', { roomId });
  }

  sendUserTyping(roomId: string) {
    if (!this.socket) return;
    this.socket.emit('user-typing', { roomId });
  }

  // 🔧 请求同步房间状态
  syncRoomState(roomId: string) {
    if (!this.socket) return;
    console.log('🔄 Requesting room state sync for room:', roomId);
    this.socket.emit('sync-room-state', { roomId });
  }

  // Event listeners
  onRoomJoined(callback: (data: any) => void) {
    if (!this.socket) {
      console.error('🚨 Socket not available for onRoomJoined - this should not happen if called after connect()');
      return;
    }
    console.log('🎧 Setting up room-joined listener');
    this.socket.on('room-joined', (data) => {
      console.log('🎧 room-joined event received in socket service:', data);
      callback(data);
    });
  }

  onUserJoined(callback: (data: any) => void) {
    if (!this.socket) {
      console.error('🚨 Socket not available for onUserJoined');
      return;
    }
    this.socket.on('user-joined', callback);
  }

  onUserLeft(callback: (data: any) => void) {
    if (!this.socket) {
      console.error('🚨 Socket not available for onUserLeft');
      return;
    }
    this.socket.on('user-left', callback);
  }

  onOnlineUsersUpdated(callback: (data: any) => void) {
    if (!this.socket) {
      console.error('🚨 Socket not available for onOnlineUsersUpdated');
      return;
    }
    this.socket.on('online-users-updated', callback);
  }

  onContentChanged(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('content-changed', callback);
  }

  onCursorMoved(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('cursor-moved', callback);
  }

  onLanguageChanged(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('language-changed', callback);
  }

  onRoomEnded(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('room-ended', callback);
  }

  onRoomForceDeleted(callback: (data: any) => void) {
    if (!this.socket) return;
    console.log('🎧 Setting up room-force-deleted listener');
    this.socket.on('room-force-deleted', (data) => {
      console.log('🚨 Socket service received room-force-deleted event:', data);
      callback(data);
    });
  }

  onRoomUpdated(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('room-updated', callback);
  }

  // 监听光标位置变化（别名方法，为了更清晰的语义）
  onCursorPositionChanged(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('cursor-moved', callback);
  }

  // 监听用户打字事件
  onUserTyping(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('user-typing', callback);
  }

  // 监听用户停止打字
  onUserStoppedTyping(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('user-stopped-typing', callback);
  }

  // 监听选择区域变化
  onSelectionChanged(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('selection-change', callback);
  }

  // 监听选择区域清除
  onSelectionCleared(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('selection-clear', callback);
  }

  // 🔧 添加Socket.IO事件监听器
  onError(callback: (error: any) => void) {
    if (!this.socket) return;
    this.socket.on('error', callback);
  }

  onDisconnect(callback: (reason: string) => void) {
    if (!this.socket) return;
    this.socket.on('disconnect', callback);
  }

  onReconnectAttempt(callback: (attemptNumber: number) => void) {
    if (!this.socket) return;
    this.socket.on('reconnect_attempt', callback);
  }

  onReconnect(callback: (attemptNumber: number) => void) {
    if (!this.socket) return;
    this.socket.on('reconnect', callback);
  }

  onReconnectFailed(callback: () => void) {
    if (!this.socket) return;
    this.socket.on('reconnect_failed', callback);
  }

  // Remove event listeners
  off(event: string, callback?: any) {
    if (!this.socket) return;
    this.socket.off(event, callback);
  }

  get isConnected() {
    return this.socket?.connected || false;
  }

  get currentRoom() {
    return this.currentRoomId;
  }
}

export const socketService = new SocketService();
export default socketService;
