import React from 'react';
import { X, Server, Database, Code, Github, Mail, User } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export default function AboutModal({ isOpen, onClose }) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative h-32 bg-gradient-to-r from-blue-600 to-indigo-700 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>

          <div className="relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-lg mb-2">
                <Database size={32} className="text-white drop-shadow-md" />
            </div>
            <h2 className="text-2xl font-bold text-white drop-shadow-sm">QueryGPT</h2>
          </div>

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/10 hover:bg-black/20 text-white rounded-full transition-colors backdrop-blur-sm"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">

            {/* Architecture */}
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Server size={14} />
                    {t('about.architecture') || "System Architecture"}
                </h3>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-600 leading-relaxed">
                    QueryGPT 是一个由大语言模型（LLM）驱动的现代数据分析智能体。
                    它利用安全的沙箱解释器，架起了自然语言与数据库执行之间的桥梁。
                    <ul className="list-disc list-inside mt-2 space-y-1 text-slate-500">
                        <li><strong>后端：</strong> Flask + OpenInterpreter（沙箱执行环境）</li>
                        <li><strong>前端：</strong> React + Vite + TailwindCSS</li>
                        <li><strong>通信：</strong> SSE 流式传输，实时展示思考过程</li>
                    </ul>
                </div>
            </div>

            {/* Developer Info */}
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <User size={14} />
                    {t('about.developer') || "开发者"}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                            M
                        </div>
                        <div>
                            <div className="text-xs text-blue-400 font-medium">作者</div>
                            <div className="text-sm font-semibold text-blue-700">MKY</div>
                        </div>
                    </div>

                    <a href="mailto:mky369258@gmail.com" className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-lg flex items-center gap-3 transition-colors group">
                        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-red-500 transition-colors">
                            <Mail size={16} />
                        </div>
                        <div className="overflow-hidden">
                            <div className="text-xs text-slate-400 font-medium">邮箱</div>
                            <div className="text-sm font-semibold text-slate-700 truncate" title="mky369258@gmail.com">mky369258...</div>
                        </div>
                    </a>
                </div>
            </div>

            {/* Links */}
            <div className="pt-2">
                <a
                    href="https://github.com/mky508/querygpt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all hover:scale-[1.02] shadow-lg shadow-slate-200"
                >
                    <Github size={18} />
                    <span className="font-medium">mky508/querygpt</span>
                </a>
                <div className="text-center mt-3 text-xs text-slate-400">
                    版本 0.4.3 • 开源协议
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
