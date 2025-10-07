import './assets/main.css'
import '@ant-design/v5-patch-for-react-19'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initConfig } from './config'

// 简单的初始化文本映射，在i18n完全加载前使用
const getInitialTexts = () => {
  // 从localStorage获取语言设置，默认为中文
  const savedLanguage = localStorage.getItem('i18nextLng') || 'zh-CN';
  
  if (savedLanguage === 'en-US') {
    return {
      appStarting: '🚀 Starting Application...',
      initializingConfig: 'Initializing configuration...'
    };
  } else {
    return {
      appStarting: '🚀 应用启动中...',
      initializingConfig: '正在初始化配置...'
    };
  }
};

// 立即执行的调试信息
console.log('🔄 main.tsx: Module loading started');
console.log('🔄 main.tsx: All imports completed');
console.log('🌐 Current URL:', window.location.href);
console.log('🔗 Current hash:', window.location.hash);
console.log('📍 Current pathname:', window.location.pathname);

// 添加全局错误处理
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// 添加更多调试信息
console.log('🔄 main.tsx loaded, about to define startApp...');

// 全局root实例，避免重复创建
let reactRoot: ReturnType<typeof createRoot> | null = null;

// 初始化配置后再渲染应用
const startApp = async () => {
  console.log('🚀 Starting application...');

  try {
    console.log('📋 Initializing configuration...');
    await initConfig();
    console.log('✅ Configuration initialized successfully');

    // 添加延迟确保配置完全加载
    console.log('⏳ Waiting for configuration to settle...');
    await new Promise(resolve => setTimeout(resolve, 100));

  } catch (error) {
    console.error('❌ Failed to initialize configuration:', error);
    // 即使配置失败也继续渲染
  }

  try {
    console.log('🎨 Rendering React application...');
    const rootElement = document.getElementById('root');
    console.log('📍 Root element:', rootElement);

    if (!rootElement) {
      throw new Error('Root element not found!');
    }

    // 如果root还没有创建，则创建它
    if (!reactRoot) {
      reactRoot = createRoot(rootElement);
      console.log('🔧 React root created');
    }

    // 渲染最终的应用
    reactRoot.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    console.log('✅ React application rendered');
  } catch (error) {
    console.error('❌ Failed to render React application:', error);
    // 显示错误信息到页面
    const rootElement = document.getElementById('root');
    if (rootElement) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      rootElement.innerHTML = `<div style="padding: 20px; color: red;">Error: ${errorMessage}</div>`;
    }
  }
};

console.log('🔄 About to call startApp...');

// 立即渲染一个加载中的组件
console.log('🔄 Rendering initial loading component...');
try {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    // 创建全局root实例
    reactRoot = createRoot(rootElement);

    // 获取当前语言的文本
    const texts = getInitialTexts();

    // 先渲染一个加载中的界面
    reactRoot.render(
      <StrictMode>
        <div style={{
          padding: '20px',
          backgroundColor: '#f0f0f0',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{ color: '#1890ff', marginBottom: '20px' }}>{texts.appStarting}</h1>
          <p>{texts.initializingConfig}</p>
          <div style={{
            width: '200px',
            height: '4px',
            backgroundColor: '#e0e0e0',
            borderRadius: '2px',
            overflow: 'hidden',
            marginTop: '20px'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#1890ff',
              animation: 'loading 2s ease-in-out infinite'
            }}></div>
          </div>
          <style>{`
            @keyframes loading {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(0%); }
              100% { transform: translateX(100%); }
            }
          `}</style>
        </div>
      </StrictMode>
    );
    console.log('✅ Initial loading component rendered');
  }
} catch (error) {
  console.error('❌ Initial loading component render failed:', error);
}

// 使用 setTimeout 确保所有模块都已加载
setTimeout(() => {
  console.log('🔄 Calling startApp via setTimeout...');
  startApp().catch(error => {
    console.error('❌ startApp failed:', error);
  });
}, 100);
