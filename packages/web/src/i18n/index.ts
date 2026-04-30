import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNSettings from './locales/zh-CN/settings.json';
import zhCNChat from './locales/zh-CN/chat.json';

import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enChat from './locales/en/chat.json';

import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaChat from './locales/ja/chat.json';

const resources = {
  'zh-CN': {
    common: zhCNCommon,
    settings: zhCNSettings,
    chat: zhCNChat,
  },
  en: {
    common: enCommon,
    settings: enSettings,
    chat: enChat,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    chat: jaChat,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'settings', 'chat'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;