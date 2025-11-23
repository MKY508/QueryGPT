import React, { createContext, useState, useContext, useEffect } from 'react';
import zh from '../locales/zh';
import en from '../locales/en';

const LanguageContext = createContext();

const languages = {
  zh,
  en
};

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState('zh');

  useEffect(() => {
     const savedLang = localStorage.getItem('app_language');
     if (savedLang && languages[savedLang]) {
         setLanguage(savedLang);
     }
  }, []);

  const changeLanguage = (lang) => {
    if (languages[lang]) {
      setLanguage(lang);
      localStorage.setItem('app_language', lang);
    }
  };

  const t = (key) => {
      const keys = key.split('.');
      let value = languages[language];
      for (const k of keys) {
          value = value?.[k];
      }
      return value || key;
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
