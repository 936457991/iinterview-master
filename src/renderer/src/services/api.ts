import axios from 'axios';
import { getCurrentConfig, initConfig } from '../config';

// 初始化配置
let configInitialized = false;

const initializeConfig = async () => {
  if (!configInitialized) {
    await initConfig();
    configInitialized = true;
  }
};

// Create axios instance with default config
const api = axios.create({
  baseURL: 'http://localhost:3000', // 默认值，会在初始化后更新
  timeout: 10000,
});

// 更新API配置
const updateApiConfig = () => {
  const config = getCurrentConfig();
  api.defaults.baseURL = config.api.baseURL;
  api.defaults.timeout = config.api.timeout;
};

// 初始化API配置
initializeConfig().then(() => {
  updateApiConfig();
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 全局的会话过期处理器
let sessionExpiredHandler: (() => void) | null = null;

// 设置会话过期处理器
export const setSessionExpiredHandler = (handler: () => void) => {
  sessionExpiredHandler = handler;
};

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle authentication failures (401 Unauthorized)
    if (error.response?.status === 401) {
      // 检查是否是登录接口的401错误，如果是则不触发会话过期处理
      const isLoginRequest = error.config?.url?.includes('/auth/login');

      if (!isLoginRequest) {
        console.warn('🔒 Authentication failed - token may be invalid, user deleted, or account disabled');
        
        // 调用会话过期处理器
        if (sessionExpiredHandler) {
          sessionExpiredHandler();
        } else {
          // 如果没有设置处理器，则使用默认行为
          console.warn('⚠️ No session expired handler set, using default behavior');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          
          // 在 Electron 环境中，使用 hash 路由
          if (window.location.hash) {
            window.location.hash = '#/login';
          } else {
            window.location.href = '/login';
          }
        }
      }
    }
    
    // Handle forbidden access (403 Forbidden) - user may have lost permissions
    else if (error.response?.status === 403) {
      console.warn('🚫 Access forbidden - user may have lost permissions');
      
      // For 403 errors, we could also redirect to login or show a specific message
      // but typically 403 means the user is authenticated but doesn't have permission
      // We'll let the component handle this error for now
    }
    
    // Handle server errors that might indicate authentication issues
    else if (error.response?.status >= 500) {
      console.error('🔥 Server error:', error.response?.status, error.response?.data);
    }
    
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (credentials: { username: string; password: string }) =>
    api.post('/auth/login', credentials),
  
  register: (userData: { username: string; password: string }) =>
    api.post('/auth/register', userData),
};

// Users API
export const usersAPI = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data: any) => api.patch('/users/profile/update', data),
  getAllUsers: () => api.get('/users'),
  createUser: (data: any) => api.post('/users', data),
  updateUser: (id: string, data: any) => api.patch(`/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
};

// Rooms API
export const roomsAPI = {
  getMyRooms: (type?: 'created' | 'history') => {
    const params = type ? `?type=${type}` : '';
    return api.get(`/rooms/my-rooms${params}`);
  },
  getMyCreatedRooms: () => api.get('/rooms/my-rooms?type=created'),
  getHistory: () => api.get('/rooms/my-rooms?type=history'),
  getAllRooms: () => api.get('/rooms'),
  getRoom: (id: string) => api.get(`/rooms/${id}`),
  getRoomByCode: (roomCode: string) => api.get(`/rooms/code/${roomCode}`),
  createRoom: (data: any) => api.post('/rooms', data),
  updateRoom: (id: string, data: any) => api.patch(`/rooms/${id}`, data),
  deleteRoom: (id: string) => api.delete(`/rooms/${id}`),
  joinRoom: (roomId: string) => api.post('/rooms/join', { roomId }),
  joinRoomByCode: (roomCode: string, password?: string) =>
    api.post('/rooms/join-by-code', { roomCode, password }),
  leaveRoom: (roomId: string) => api.post(`/rooms/${roomId}/leave`),
  endRoom: (roomId: string) => api.post(`/rooms/${roomId}/end`),
};

export default api;
