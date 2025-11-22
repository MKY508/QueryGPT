import React from 'react';
import { ExternalLink, Download, FileText, Image } from 'lucide-react';

export default function ArtifactViewer({ artifacts }) {
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div className="mt-4 space-y-4">
      {artifacts.map((artifact, index) => {
        // 检查是否是 HTML 图表
        const isHtml = artifact.filename.endsWith('.html');
        const isImage = /\.(png|jpg|jpeg|svg)$/i.test(artifact.filename);

        return (
          <div key={index} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                {isHtml ? <ActivityIcon size={16} /> : <FileText size={16} />}
                {artifact.description || artifact.filename}
              </div>
              <div className="flex gap-2">
                <a 
                  href={artifact.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600 transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink size={14} />
                </a>
                <a 
                  href={artifact.url} 
                  download
                  className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600 transition-colors"
                  title="Download"
                >
                  <Download size={14} />
                </a>
              </div>
            </div>
            
            <div className="p-0 bg-white flex justify-center">
              {isHtml ? (
                <div className="w-full h-[400px] relative">
                    <iframe 
                        src={artifact.url} 
                        className="w-full h-full border-0"
                        title={artifact.filename}
                        sandbox="allow-scripts allow-same-origin"
                    />
                </div>
              ) : isImage ? (
                <img src={artifact.url} alt={artifact.description} className="max-w-full h-auto p-4" />
              ) : (
                <div className="p-8 text-center text-slate-500">
                    <FileText size={48} className="mx-auto mb-2 opacity-20" />
                    <p>此文件类型不支持预览</p>
                    <a href={artifact.url} className="text-blue-600 hover:underline text-sm mt-2 inline-block">点击下载查看</a>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityIcon({ size }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
    );
}

