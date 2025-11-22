import React, { useState, useEffect } from 'react';
import { X, Save, Undo, Database, Brain, MessageSquare, Activity, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react';
import axios from 'axios';

export default function SettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('basic');
  const [config, setConfig] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 数据库配置状态
  const [dbConfig, setDbConfig] = useState({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: ''
  });

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const [cfgRes, modelsRes] = await Promise.all([
        axios.get('/api/config'),
        axios.get('/api/models')
      ]);
      
      setConfig(cfgRes.data);
      setModels(modelsRes.data.models || []);
      
      // 加载数据库配置
      if (cfgRes.data.database) {
        setDbConfig({
          host: cfgRes.data.database.host || '127.0.0.1',
          port: cfgRes.data.database.port || 3306,
          user: cfgRes.data.database.user || '',
          password: cfgRes.data.database.password || '',
          database: cfgRes.data.database.database || ''
        });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async (section, data) => {
    try {
      setSaving(true);
      let newConfig = { ...config };
      
      if (section === 'database') {
        await axios.post('/api/database/config', data);
        newConfig.database = data;
      } else {
        if (section === 'basic') {
            newConfig = { ...newConfig, ...data };
        } else if (section === 'features') {
            newConfig.features = { ...(newConfig.features || {}), ...data };
        }
        await axios.post('/api/config', newConfig);
      }
      
      setConfig(newConfig);
      alert('设置已保存');
    } catch (error) {
      console.error("Save failed:", error);
      alert('保存失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  const testDatabase = async () => {
    try {
      setSaving(true);
      const res = await axios.post('/api/database/test', dbConfig);
      if (res.data.success) {
        alert(`连接成功！发现 ${res.data.table_count} 个表`);
      } else {
        alert(`连接失败: ${res.data.message}`);
      }
    } catch (error) {
      alert('测试请求失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteModel = async (modelId) => {
      if(!confirm('确定删除此模型配置吗？')) return;
      try {
          const newModels = models.filter(m => m.id !== modelId);
          await axios.post('/api/models', { models: newModels });
          setModels(newModels);
      } catch (err) {
          alert('删除失败');
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] h-[600px] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <SettingsIcon size={20} /> 系统设置
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 bg-slate-50 border-r border-slate-200 flex flex-col py-2">
            <TabButton 
              id="basic" label="基础设置" icon={<SettingsIcon size={16} />} 
              active={activeTab === 'basic'} onClick={() => setActiveTab('basic')} 
            />
            <TabButton 
              id="models" label="模型管理" icon={<Brain size={16} />} 
              active={activeTab === 'models'} onClick={() => setActiveTab('models')} 
            />
            <TabButton 
              id="database" label="数据库配置" icon={<Database size={16} />} 
              active={activeTab === 'database'} onClick={() => setActiveTab('database')} 
            />
            <TabButton 
              id="features" label="功能开关" icon={<Activity size={16} />} 
              active={activeTab === 'features'} onClick={() => setActiveTab('features')} 
            />
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-400">加载中...</div>
            ) : (
              <>
                {/* Basic Settings */}
                {activeTab === 'basic' && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="block font-medium">语言 / Language</label>
                        <select 
                            className="w-full p-2 border rounded-lg bg-white"
                            value={config?.language || 'zh'}
                            onChange={(e) => saveConfig('basic', { language: e.target.value })}
                        >
                            <option value="zh">简体中文</option>
                            <option value="en">English</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="block font-medium">默认上下文轮数</label>
                        <select 
                            className="w-full p-2 border rounded-lg bg-white"
                            value={config?.context_rounds || 3}
                            onChange={(e) => saveConfig('basic', { context_rounds: parseInt(e.target.value) })}
                        >
                            <option value="0">0 (单轮)</option>
                            <option value="3">3 (推荐)</option>
                            <option value="5">5</option>
                            <option value="10">10</option>
                        </select>
                    </div>
                  </div>
                )}

                {/* Database Settings */}
                {activeTab === 'database' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Host</label>
                            <input 
                                type="text" 
                                className="w-full p-2 border rounded-lg" 
                                value={dbConfig.host}
                                onChange={(e) => setDbConfig({...dbConfig, host: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Port</label>
                            <input 
                                type="number" 
                                className="w-full p-2 border rounded-lg" 
                                value={dbConfig.port}
                                onChange={(e) => setDbConfig({...dbConfig, port: parseInt(e.target.value)})}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">User</label>
                        <input 
                            type="text" 
                            className="w-full p-2 border rounded-lg" 
                            value={dbConfig.user}
                            onChange={(e) => setDbConfig({...dbConfig, user: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Password</label>
                        <input 
                            type="password" 
                            className="w-full p-2 border rounded-lg" 
                            value={dbConfig.password}
                            onChange={(e) => setDbConfig({...dbConfig, password: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Database Name</label>
                        <input 
                            type="text" 
                            className="w-full p-2 border rounded-lg" 
                            value={dbConfig.database}
                            placeholder="Optional"
                            onChange={(e) => setDbConfig({...dbConfig, database: e.target.value})}
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button 
                            onClick={testDatabase}
                            disabled={saving}
                            className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                        >
                            测试连接
                        </button>
                        <button 
                            onClick={() => saveConfig('database', dbConfig)}
                            disabled={saving}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <Save size={16} /> 保存配置
                        </button>
                    </div>
                  </div>
                )}

                {/* Feature Flags */}
                {activeTab === 'features' && (
                  <div className="space-y-6">
                    <Toggle 
                        label="智能路由 (Smart Routing)" 
                        desc="自动判断查询类型，选择最优执行路径"
                        checked={config?.features?.smart_routing?.enabled || false}
                        onChange={(v) => saveConfig('features', { smart_routing: { ...config?.features?.smart_routing, enabled: v } })}
                    />
                    <Toggle 
                        label="数据库守卫 (DB Guard)" 
                        desc="执行前自动检查数据库健康状态"
                        checked={config?.features?.db_guard?.auto_check || true}
                        onChange={(v) => saveConfig('features', { db_guard: { ...config?.features?.db_guard, auto_check: v } })}
                    />
                    <Toggle 
                        label="思考过程播报 (Thought Stream)" 
                        desc="实时显示 AI 的分析步骤"
                        checked={config?.features?.thought_stream?.enabled || true}
                        onChange={(v) => saveConfig('features', { thought_stream: { ...config?.features?.thought_stream, enabled: v } })}
                    />
                  </div>
                )}

                {/* Models Management */}
                {activeTab === 'models' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-medium">已配置模型</h3>
                            <button className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700" onClick={() => alert('新增功能开发中')}>
                                <Plus size={16} /> 添加模型
                            </button>
                        </div>
                        
                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                            {models.map(model => (
                                <div key={model.id} className="p-4 border border-slate-200 rounded-lg flex justify-between items-center bg-slate-50 hover:bg-white hover:shadow-sm transition-all">
                                    <div>
                                        <div className="font-medium text-slate-800">{model.name}</div>
                                        <div className="text-xs text-slate-500 flex gap-2 mt-1">
                                            <span className="bg-slate-200 px-1.5 py-0.5 rounded">{model.provider || model.type}</span>
                                            <span className="font-mono">{model.id}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => deleteModel(model.id)}
                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            
                            {models.length === 0 && (
                                <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                                    暂无模型，请添加
                                </div>
                            )}
                        </div>
                    </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ id, label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors
        ${active ? 'bg-white text-blue-600 border-r-2 border-blue-600' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Toggle({ label, desc, checked, onChange }) {
    return (
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
                <div className="font-medium">{label}</div>
                <div className="text-sm text-slate-500">{desc}</div>
            </div>
            <button 
                onClick={() => onChange(!checked)}
                className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'left-7' : 'left-1'}`} />
            </button>
        </div>
    );
}
