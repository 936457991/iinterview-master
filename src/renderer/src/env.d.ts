/// <reference types="vite/client" />

declare global {
  interface Window {
    api: {
      getPlatform: () => string;
      isDev: () => boolean;
    };
  }
}
