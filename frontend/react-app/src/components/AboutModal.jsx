import React from 'react';
import { Database, Github, X, Mail, User } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export default function AboutModal({ isOpen, onClose }) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Database className="text-blue-600" />
                QueryGPT
            </h2>
            <button
                onClick={onClose}
                className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors"
            >
                <X size={20} />
            </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
            <div className="text-center py-4">
                <div className="w-20 h-20 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
                    <Database size={40} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800">QueryGPT Data Agent</h3>
                <p className="text-slate-500 text-sm">v2.0.0</p>
            </div>

            <p className="text-slate-600 text-sm leading-relaxed text-center">
                QueryGPT 是一个基于大语言模型的智能数据分析助手，支持自然语言查询数据库、生成可视化图表，并提供双视图模式以适应不同用户需求。
            </p>

            <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-3 border border-slate-100">
                <div className="flex items-center gap-3">
                    <User size={16} className="text-slate-400" />
                    <span className="text-slate-600">Developer:</span>
                    <span className="font-medium text-slate-800 ml-auto">MKY</span>
                </div>
                <div className="flex items-center gap-3">
                    <Mail size={16} className="text-slate-400" />
                    <span className="text-slate-600">Email:</span>
                    <a href="mailto:mky369258@gmail.com" className="font-medium text-blue-600 hover:underline ml-auto">
                        mky369258@gmail.com
                    </a>
                </div>
            </div>

            <div className="flex justify-center gap-4 pt-2">
                <a
                    href="https://github.com/mky508/querygpt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
                >
                    <Github size={16} /> GitHub Repository
                </a>
            </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 text-center text-xs text-slate-400">
            &copy; 2024 QueryGPT Team. All rights reserved.
        </div>
      </div>
    </div>
  );
}
