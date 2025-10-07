import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

const resources = {
  'zh-CN': {
    translation: zhCN
  },
  'en-US': {
    translation: enUS
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en-US',
    debug: false,
    
    detection: {
      // 检测顺序：localStorage -> navigator -> fallback
      order: ['localStorage', 'navigator'],
      // 缓存用户语言选择
      caches: ['localStorage'],
      // localStorage key
      lookupLocalStorage: 'i18nextLng'
    },

    interpolation: {
      escapeValue: false
    }
  })

export default i18n
