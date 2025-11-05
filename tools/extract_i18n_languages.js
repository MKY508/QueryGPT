#!/usr/bin/env node
/**
 * 提取 i18n.js 中的语言文件为独立的 JSON 文件
 * 使用更安全的字符串解析方法
 */

const fs = require('fs');
const path = require('path');

const i18nJsPath = path.join(__dirname, '../frontend/static/js/i18n.js');
const localesDir = path.join(__dirname, '../frontend/static/js/locales');

// 确保 locales 目录存在
if (!fs.existsSync(localesDir)) {
    fs.mkdirSync(localesDir, { recursive: true });
}

// 读取 i18n.js 文件
let content = fs.readFileSync(i18nJsPath, 'utf-8');

// 找到 i18n 对象的开始和结束位置
const i18nStart = content.indexOf('const i18n = {');
if (i18nStart === -1) {
    console.error('Could not find i18n object');
    process.exit(1);
}

// 找到 LanguageManager 类的位置（这是 i18n 对象的结束标志）
const classStart = content.indexOf('class LanguageManager');
if (classStart === -1) {
    console.error('Could not find LanguageManager class');
    process.exit(1);
}

// 提取 i18n 对象部分（不包括最后的分号）
const i18nObjStr = content.substring(i18nStart + 'const i18n = '.length, classStart).trim();
// 移除末尾的分号
const cleanedI18n = i18nObjStr.replace(/;\s*$/, '');

// 定义一个函数来提取单个语言对象
function extractLanguageObject(langKey, content) {
    // 找到语言键的位置
    const langPattern = new RegExp(`\\s+${langKey}:\\s*\\{`);
    const match = content.match(langPattern);
    if (!match) {
        return null;
    }
    
    const startIndex = content.indexOf(match[0]);
    if (startIndex === -1) {
        return null;
    }
    
    // 从开始位置查找匹配的大括号
    let braceCount = 0;
    let inString = false;
    let stringChar = null;
    let escapeNext = false;
    
    for (let i = startIndex + match[0].length; i < content.length; i++) {
        const char = content[i];
        
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        
        if (char === '\\') {
            escapeNext = true;
            continue;
        }
        
        if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
            continue;
        }
        
        if (inString && char === stringChar) {
            inString = false;
            stringChar = null;
            continue;
        }
        
        if (!inString) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                if (braceCount === 0) {
                    // 找到匹配的结束大括号
                    const endIndex = i + 1;
                    const langObjStr = content.substring(startIndex + match[0].length - 1, endIndex);
                    
                    // 尝试解析为 JSON
                    try {
                        // 先尝试直接解析
                        return JSON.parse(langObjStr);
                    } catch (e) {
                        // 如果失败，尝试使用 eval（仅构建时）
                        try {
                            const vm = require('vm');
                            const sandbox = {};
                            vm.createContext(sandbox);
                            vm.runInContext(`const obj = ${langObjStr};`, sandbox);
                            return sandbox.obj;
                        } catch (e2) {
                            console.error(`Failed to parse ${langKey}:`, e2.message);
                            return null;
                        }
                    }
                }
                braceCount--;
            }
        }
    }
    
    return null;
}

// 定义要提取的语言列表
const languages = ['en', 'ru', 'pt', 'es', 'fr', 'ko', 'de', 'ja'];

// 使用更简单的方法：直接读取文件，找到每个语言对象的位置
console.log('Extracting language files...\n');

languages.forEach(lang => {
    // 查找语言对象的开始位置
    const langPattern = new RegExp(`\\s+${lang}:\\s*\\{`);
    const match = cleanedI18n.match(langPattern);
    
    if (!match) {
        console.warn(`⚠ Language ${lang} not found`);
        return;
    }
    
    const startIndex = cleanedI18n.indexOf(match[0]);
    if (startIndex === -1) {
        console.warn(`⚠ Could not find start position for ${lang}`);
        return;
    }
    
    // 从开始位置查找匹配的大括号
    let braceCount = 0;
    let inString = false;
    let stringChar = null;
    let escapeNext = false;
    
    // 找到第一个 { 的位置
    let objStart = startIndex + match[0].length - 1;
    for (let i = objStart; i < cleanedI18n.length; i++) {
        if (cleanedI18n[i] === '{') {
            objStart = i;
            break;
        }
    }
    
    for (let i = objStart; i < cleanedI18n.length; i++) {
        const char = cleanedI18n[i];
        
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        
        if (char === '\\') {
            escapeNext = true;
            continue;
        }
        
        if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
            continue;
        }
        
        if (inString && char === stringChar) {
            inString = false;
            stringChar = null;
            continue;
        }
        
        if (!inString) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                    // 找到匹配的结束大括号
                    const endIndex = i + 1;
                    const langObjStr = cleanedI18n.substring(objStart, endIndex);
                    
                    // 尝试解析
                    try {
                        // 使用 eval 解析（仅构建时，安全）
                        const vm = require('vm');
                        const sandbox = {};
                        vm.createContext(sandbox);
                        vm.runInContext(`const obj = ${langObjStr};`, sandbox);
                        
                        // 保存为 JSON
                        const jsonPath = path.join(localesDir, `${lang}.json`);
                        fs.writeFileSync(jsonPath, JSON.stringify(sandbox.obj, null, 2), 'utf-8');
                        console.log(`✓ Extracted ${lang}.json`);
                    } catch (error) {
                        console.error(`✗ Failed to extract ${lang}:`, error.message);
                    }
                    break;
                }
            }
        }
    }
});

console.log('\n✅ Language extraction completed!');
console.log(`📁 Files saved to: ${localesDir}`);
