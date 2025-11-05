#!/usr/bin/env node
/**
 * 提取 i18n.js 中的语言文件为独立的 JSON 文件
 * 用于实现 i18n 懒加载
 */

const fs = require('fs');
const path = require('path');

// 读取 i18n.js 文件
const i18nJsPath = path.join(__dirname, '../frontend/static/js/i18n.js');
const content = fs.readFileSync(i18nJsPath, 'utf-8');

// 提取 i18n 对象中的所有语言
// 使用正则表达式匹配语言键和对应的对象
const langPattern = /(\w+(?:-\w+)?):\s*\{/g;
const languages = [];

// 找到所有语言键
let match;
while ((match = langPattern.exec(content)) !== null) {
    const langKey = match[1];
    if (!['zh', 'en', 'ru', 'pt', 'es', 'fr', 'ko', 'de', 'ja'].includes(langKey)) {
        continue;
    }
    languages.push(langKey);
}

console.log('找到的语言:', languages);

// 提取每种语言的翻译对象
// 这是一个简化的方法，实际需要更复杂的解析
// 由于 JavaScript 对象可能包含注释和特殊字符，我们需要更稳健的方法

// 更简单的方法：使用 eval 在 Node.js 中执行（仅用于构建时）
// 但为了安全，我们使用更安全的方法：手动解析或使用 acorn/esprima

// 由于文件很大且复杂，我们采用另一种方法：
// 1. 保持 i18n.js 的结构，但修改 LanguageManager 来支持懒加载
// 2. 或者使用 Node.js 的 vm 模块来安全地执行

console.log('由于 i18n.js 文件结构复杂，建议直接在 LanguageManager 中实现懒加载逻辑');
console.log('这样可以在不改变现有文件结构的情况下实现优化');

