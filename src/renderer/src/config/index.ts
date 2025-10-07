// 配置管理 - 纯Web版本，支持Electron和Web部署
interface AppConfig {
  api: {
    baseURL: string;
    timeout: number;
  };
  websocket: {
    yjsUrl: string;
  };
  app: {
    name: string;
    version: string;
    defaultLanguage: string;
  };
  features: {
    enableRegistration: boolean;
    enableRoomPassword: boolean;
    maxRoomMembers: number;
    autoSaveInterval: number;
  };
}

// 默认配置 - 临时使用本地开发配置
const defaultConfig: AppConfig = {
  api: {
    baseURL: 'http://localhost:3000',  // 本地开发API
    timeout: 10000,
  },
  websocket: {
    yjsUrl: 'ws://localhost:1234',     // 本地YJS WebSocket
  },
  app: {
    name: 'Interview Collaboration System',
    version: '1.0.0',
    defaultLanguage: 'zh-CN',
  },
  features: {
    enableRegistration: false,
    enableRoomPassword: true,
    maxRoomMembers: 10,
    autoSaveInterval: 3000,
  },
};

// 检测环境 (保留以备将来使用)
// const isElectron = () => {
//   return typeof window !== 'undefined' && window.process && window.process.type === 'renderer';
// };

// const isProduction = () => {
//   return import.meta.env.MODE === 'production';
// };

// 不再从配置文件加载，完全使用环境变量
// const loadConfigFromFile = async (): Promise<Partial<AppConfig> | null> => {
//   console.log('Config files are no longer used, using environment variables only');
//   return null;
// };

// 从环境变量获取配置
const getConfigFromEnv = (): Partial<AppConfig> => {
  console.log('🔧 getConfigFromEnv() called');

  const envConfig: Partial<AppConfig> = {};

  try {
    // 使用 import.meta.env 替代 process.env
    const env = import.meta.env;

    // 调试信息：打印所有环境变量
    console.log('🌍 Environment variables:', env);
    console.log('🔗 VITE_API_BASE_URL:', env.VITE_API_BASE_URL);
    console.log('🔌 VITE_YJS_WEBSOCKET_URL:', env.VITE_YJS_WEBSOCKET_URL);
    console.log('🏗️ import.meta.env.MODE:', env.MODE);
    console.log('🛠️ import.meta.env.DEV:', env.DEV);
    console.log('🚀 import.meta.env.PROD:', env.PROD);

  // API配置 - 总是设置，使用环境变量或默认值
  const apiBaseURL = env.VITE_API_BASE_URL || defaultConfig.api.baseURL;
  const apiTimeout = parseInt(env.VITE_API_TIMEOUT || '10000');

  envConfig.api = {
    baseURL: apiBaseURL,
    timeout: apiTimeout,
  };
  console.log('🔧 API config from env:', envConfig.api);
  console.log('🌐 Using API base URL:', apiBaseURL);

  // WebSocket配置 - 总是设置，使用环境变量或默认值
  envConfig.websocket = {
    yjsUrl: env.VITE_YJS_WEBSOCKET_URL || defaultConfig.websocket.yjsUrl,
  };
  console.log('WebSocket config from env:', envConfig.websocket);

  // 应用配置
  if (env.VITE_APP_NAME || env.VITE_APP_VERSION || env.VITE_APP_DEFAULT_LANGUAGE) {
    envConfig.app = {
      name: env.VITE_APP_NAME || defaultConfig.app.name,
      version: env.VITE_APP_VERSION || defaultConfig.app.version,
      defaultLanguage: env.VITE_APP_DEFAULT_LANGUAGE || defaultConfig.app.defaultLanguage,
    };
  }

    // 功能配置
    if (env.VITE_ENABLE_REGISTRATION !== undefined ||
        env.VITE_ENABLE_ROOM_PASSWORD !== undefined ||
        env.VITE_MAX_ROOM_MEMBERS ||
        env.VITE_AUTO_SAVE_INTERVAL) {
      envConfig.features = {
        enableRegistration: env.VITE_ENABLE_REGISTRATION === 'true' || defaultConfig.features.enableRegistration,
        enableRoomPassword: env.VITE_ENABLE_ROOM_PASSWORD === 'true' || defaultConfig.features.enableRoomPassword,
        maxRoomMembers: parseInt(env.VITE_MAX_ROOM_MEMBERS || '10'),
        autoSaveInterval: parseInt(env.VITE_AUTO_SAVE_INTERVAL || '3000'),
      };
    }

    console.log('✅ getConfigFromEnv() completed successfully');
    return envConfig;
  } catch (error) {
    console.error('❌ Error in getConfigFromEnv():', error);
    return {};
  }
};

// 配置加载器类
class ConfigLoader {
  private config: AppConfig = defaultConfig;
  private loaded = false;

  async loadConfig(): Promise<AppConfig> {
    console.log('🔧 ConfigLoader.loadConfig() called');

    if (this.loaded) {
      console.log('✅ Config already loaded, returning cached config');
      return this.config;
    }

    try {
      console.log('📋 Loading config from environment variables...');

      // 1. 从环境变量获取配置
      const envConfig = getConfigFromEnv();
      console.log('🔧 Environment config loaded:', envConfig);

      // 2. 合并配置（优先级：环境变量 > 默认配置）
      this.config = {
        ...defaultConfig,
        ...envConfig,
        // 深度合并嵌套对象
        api: {
          ...defaultConfig.api,
          ...envConfig?.api,
        },
        websocket: {
          ...defaultConfig.websocket,
          ...envConfig?.websocket,
        },
        app: {
          ...defaultConfig.app,
          ...envConfig?.app,
        },
        features: {
          ...defaultConfig.features,
          ...envConfig?.features,
        },
      };

      this.loaded = true;
      console.log('✅ Final config loaded from environment variables:', this.config);
      console.log('🔧 ConfigLoader.loadConfig() completed successfully');
    } catch (error) {
      console.error('❌ Failed to load config:', error);
      this.config = defaultConfig;
      console.log('🔧 Using default config due to error');
    }

    return this.config;
  }

  getConfig(): AppConfig {
    return this.config;
  }
}

// 全局配置加载器实例
const configLoader = new ConfigLoader();

// 异步获取配置
export const getConfig = async (): Promise<AppConfig> => {
  return await configLoader.loadConfig();
};

// 同步获取配置（如果已加载）
export const getCurrentConfig = (): AppConfig => {
  return configLoader.getConfig();
};

// 初始化配置（应用启动时调用）
export const initConfig = async (): Promise<AppConfig> => {
  return await getConfig();
};

export type { AppConfig };
