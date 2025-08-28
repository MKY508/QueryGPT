/**
 * 语义层管理系统
 * 提供数据库表和字段的业务语义标注功能
 */

class SemanticLayerManager {
    constructor() {
        this.currentDatasource = null;
        this.currentTable = null;
        this.currentColumns = [];
        this.isDirty = false;
        this.statistics = {};
        
        this.init();
    }
    
    init() {
        // 绑定事件
        this.bindEvents();
        
        // 初始加载数据
        this.loadDatasources();
        this.loadStatistics();
    }
    
    bindEvents() {
        // 顶部按钮
        document.getElementById('scan-datasource')?.addEventListener('click', () => this.scanDatasource());
        document.getElementById('import-semantic')?.addEventListener('click', () => this.importSemantic());
        document.getElementById('export-semantic')?.addEventListener('click', () => this.exportSemantic());
        
        // 数据源树
        document.getElementById('refresh-datasources')?.addEventListener('click', () => this.loadDatasources());
        
        // 编辑区按钮
        document.getElementById('save-semantic')?.addEventListener('click', () => this.saveSemantic());
        document.getElementById('batch-edit')?.addEventListener('click', () => this.batchEdit());
        
        // 全选复选框
        document.getElementById('select-all-columns')?.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('#columns-tbody input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
        
        // 业务术语
        document.getElementById('add-glossary')?.addEventListener('click', () => this.addGlossaryTerm());
        
        // 监听表信息变化
        ['table-display-name', 'table-description'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                this.isDirty = true;
                this.enableSaveButton();
            });
        });
    }
    
    // 加载数据源
    async loadDatasources() {
        try {
            const response = await fetch('/api/semantic/datasources', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.renderDatasourceTree(data.datasources);
            } else {
                this.showError('加载数据源失败');
            }
        } catch (error) {
            console.error('Failed to load datasources:', error);
            this.showError('加载数据源失败');
        }
    }
    
    // 渲染数据源树
    renderDatasourceTree(datasources) {
        const tree = document.getElementById('datasource-tree');
        
        if (!datasources || datasources.length === 0) {
            tree.innerHTML = `
                <div class="tree-placeholder">
                    <i class="fas fa-database"></i>
                    <p>暂无数据源</p>
                    <button class="btn-primary" onclick="semanticManager.scanDatasource()">
                        扫描数据库
                    </button>
                </div>
            `;
            return;
        }
        
        // 构建树形结构
        let html = '';
        datasources.forEach(ds => {
            html += `
                <div class="tree-node" data-datasource="${ds.datasource_id}">
                    <div class="tree-node-content" onclick="semanticManager.toggleDatasource('${ds.datasource_id}')">
                        <span class="tree-node-icon">
                            <i class="fas fa-database"></i>
                        </span>
                        <span class="tree-node-label">
                            ${ds.display_name || ds.datasource_id}
                        </span>
                        <span class="tree-node-count">(加载中...)</span>
                    </div>
                    <div class="tree-children" id="ds-${ds.datasource_id}" style="display: none;">
                        <div class="tree-placeholder">
                            <i class="fas fa-spinner fa-spin"></i> 加载中...
                        </div>
                    </div>
                </div>
            `;
        });
        
        tree.innerHTML = html;
    }
    
    // 切换数据源展开/收起
    async toggleDatasource(datasourceId) {
        const childrenEl = document.getElementById(`ds-${datasourceId}`);
        
        if (childrenEl.style.display === 'none') {
            childrenEl.style.display = 'block';
            
            // 首次展开时加载表结构
            if (childrenEl.querySelector('.tree-placeholder')) {
                await this.loadTables(datasourceId);
            }
        } else {
            childrenEl.style.display = 'none';
        }
    }
    
    // 加载表结构
    async loadTables(datasourceId) {
        try {
            const response = await fetch(`/api/semantic/metadata/${datasourceId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.renderTables(datasourceId, data.tables);
                
                // 更新计数
                const countEl = document.querySelector(`[data-datasource="${datasourceId}"] .tree-node-count`);
                if (countEl) {
                    countEl.textContent = `(${data.count}个表)`;
                }
            }
        } catch (error) {
            console.error('Failed to load tables:', error);
        }
    }
    
    // 渲染表列表
    renderTables(datasourceId, tables) {
        const container = document.getElementById(`ds-${datasourceId}`);
        
        if (!tables || tables.length === 0) {
            container.innerHTML = '<div class="tree-placeholder">暂无数据表</div>';
            return;
        }
        
        // 按schema分组
        const grouped = {};
        tables.forEach(table => {
            const schema = table.schema_name || 'default';
            if (!grouped[schema]) {
                grouped[schema] = [];
            }
            grouped[schema].push(table);
        });
        
        let html = '';
        for (const [schema, schemaTables] of Object.entries(grouped)) {
            html += `
                <div class="tree-node">
                    <div class="tree-node-content" onclick="semanticManager.toggleSchema('${datasourceId}', '${schema}')">
                        <span class="tree-node-icon">
                            <i class="fas fa-folder"></i>
                        </span>
                        <span class="tree-node-label">${schema}</span>
                        <span class="tree-node-count">(${schemaTables.length})</span>
                    </div>
                    <div class="tree-children" id="schema-${datasourceId}-${schema}">
            `;
            
            schemaTables.forEach(table => {
                const displayName = table.display_name ? `${table.display_name} (${table.table_name})` : table.table_name;
                const completeness = this.calculateTableCompleteness(table);
                
                html += `
                    <div class="tree-node">
                        <div class="tree-node-content" onclick="semanticManager.selectTable('${datasourceId}', '${schema}', '${table.table_name}', ${table.id})">
                            <span class="tree-node-icon">
                                <i class="fas fa-table"></i>
                            </span>
                            <span class="tree-node-label">${displayName}</span>
                            <span class="tree-node-count">${completeness}%</span>
                        </div>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }
    
    // 切换schema展开/收起
    toggleSchema(datasourceId, schema) {
        const el = document.getElementById(`schema-${datasourceId}-${schema}`);
        if (el) {
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }
    }
    
    // 选择表
    async selectTable(datasourceId, schema, tableName, tableId) {
        // 检查是否有未保存的更改
        if (this.isDirty) {
            if (!confirm('有未保存的更改，是否继续？')) {
                return;
            }
        }
        
        // 移除之前的选中状态
        document.querySelectorAll('.tree-node-content.active').forEach(el => {
            el.classList.remove('active');
        });
        
        // 添加选中状态
        event.target.closest('.tree-node-content').classList.add('active');
        
        // 更新当前选中信息
        this.currentDatasource = datasourceId;
        this.currentTable = {
            id: tableId,
            datasource_id: datasourceId,
            schema_name: schema,
            table_name: tableName
        };
        
        // 加载表详情
        await this.loadTableDetails();
    }
    
    // 加载表详情
    async loadTableDetails() {
        try {
            // 显示加载状态
            document.getElementById('current-table-name').innerHTML = `
                <i class="fas fa-table"></i> ${this.currentTable.table_name} 
                <span style="font-size: 14px; color: #6c757d;">(加载中...)</span>
            `;
            
            // 获取表信息
            const response = await fetch(`/api/semantic/metadata/${this.currentTable.datasource_id}?schema=${this.currentTable.schema_name}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                const table = data.tables.find(t => t.table_name === this.currentTable.table_name);
                if (table) {
                    this.currentTable = {...this.currentTable, ...table};
                    this.currentColumns = table.columns || [];
                    this.renderTableEditor();
                }
            }
        } catch (error) {
            console.error('Failed to load table details:', error);
            this.showError('加载表详情失败');
        }
    }
    
    // 渲染表编辑器
    renderTableEditor() {
        // 更新标题
        document.getElementById('current-table-name').innerHTML = `
            <i class="fas fa-table"></i> ${this.currentTable.table_name}
        `;
        
        // 显示表信息编辑区
        const tableEditor = document.getElementById('table-info-editor');
        tableEditor.style.display = 'block';
        
        // 填充表信息
        document.getElementById('table-display-name').value = this.currentTable.display_name || '';
        document.getElementById('table-description').value = this.currentTable.description || '';
        
        // 渲染标签
        this.renderTags(this.currentTable.tags || []);
        
        // 渲染字段列表
        this.renderColumns();
        
        // 启用按钮
        document.getElementById('save-semantic').disabled = false;
        document.getElementById('batch-edit').disabled = false;
        
        // 重置脏标记
        this.isDirty = false;
    }
    
    // 渲染标签
    renderTags(tags) {
        const container = document.getElementById('table-tags');
        const input = container.querySelector('.tag-input');
        
        // 清除现有标签
        container.querySelectorAll('.tag-item').forEach(el => el.remove());
        
        // 添加标签
        tags.forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag-item';
            tagEl.innerHTML = `
                ${tag}
                <span class="remove-tag" onclick="semanticManager.removeTag('${tag}')">&times;</span>
            `;
            container.insertBefore(tagEl, input);
        });
        
        // 绑定输入事件
        if (!input.hasAttribute('data-bound')) {
            input.setAttribute('data-bound', 'true');
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                    this.addTag(e.target.value.trim());
                    e.target.value = '';
                    e.preventDefault();
                }
            });
        }
    }
    
    // 添加标签
    addTag(tag) {
        if (!this.currentTable.tags) {
            this.currentTable.tags = [];
        }
        if (!this.currentTable.tags.includes(tag)) {
            this.currentTable.tags.push(tag);
            this.renderTags(this.currentTable.tags);
            this.isDirty = true;
            this.enableSaveButton();
        }
    }
    
    // 移除标签
    removeTag(tag) {
        const index = this.currentTable.tags.indexOf(tag);
        if (index > -1) {
            this.currentTable.tags.splice(index, 1);
            this.renderTags(this.currentTable.tags);
            this.isDirty = true;
            this.enableSaveButton();
        }
    }
    
    // 渲染字段列表
    renderColumns() {
        const tbody = document.getElementById('columns-tbody');
        
        if (!this.currentColumns || this.currentColumns.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center text-muted">
                        暂无字段信息
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        this.currentColumns.forEach((column, index) => {
            const synonyms = Array.isArray(column.synonyms) ? column.synonyms.join(', ') : '';
            const examples = Array.isArray(column.examples) ? column.examples.slice(0, 3).join(', ') : '';
            
            html += `
                <tr data-column-index="${index}">
                    <td><input type="checkbox" data-column="${column.column_name}"></td>
                    <td>
                        <strong>${column.column_name}</strong>
                        ${column.column_key === 'PRI' ? '<span style="color: #007bff; margin-left: 5px;"><i class="fas fa-key"></i></span>' : ''}
                    </td>
                    <td style="color: #6c757d; font-size: 12px;">${column.data_type}</td>
                    <td>
                        <input type="text" 
                               value="${column.display_name || ''}" 
                               placeholder="请输入中文名"
                               onchange="semanticManager.updateColumn(${index}, 'display_name', this.value)">
                    </td>
                    <td>
                        <input type="text" 
                               value="${column.description || ''}" 
                               placeholder="请输入业务描述"
                               onchange="semanticManager.updateColumn(${index}, 'description', this.value)">
                    </td>
                    <td>
                        <input type="text" 
                               value="${synonyms}" 
                               placeholder="用逗号分隔"
                               onchange="semanticManager.updateColumn(${index}, 'synonyms', this.value)">
                    </td>
                    <td style="color: #6c757d; font-size: 12px;">
                        ${examples}
                    </td>
                    <td>
                        <button class="btn-small" onclick="semanticManager.getSuggestion(${index})">
                            <i class="fas fa-lightbulb"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
    }
    
    // 更新字段信息
    updateColumn(index, field, value) {
        if (field === 'synonyms') {
            // 处理同义词数组
            this.currentColumns[index][field] = value.split(',').map(s => s.trim()).filter(s => s);
        } else {
            this.currentColumns[index][field] = value;
        }
        
        this.isDirty = true;
        this.enableSaveButton();
    }
    
    // 获取智能建议
    async getSuggestion(columnIndex) {
        const column = this.currentColumns[columnIndex];
        
        try {
            const response = await fetch('/api/semantic/suggest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({
                    field_name: column.column_name,
                    data_type: column.data_type
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuggestions(columnIndex, data.suggestions);
            }
        } catch (error) {
            console.error('Failed to get suggestions:', error);
        }
    }
    
    // 显示智能建议
    showSuggestions(columnIndex, suggestions) {
        const column = this.currentColumns[columnIndex];
        const container = document.getElementById('assistant-content');
        
        let html = `
            <div class="suggestion-header">
                <strong>${column.column_name}</strong> 的智能建议：
            </div>
        `;
        
        if (suggestions.display_name) {
            html += `
                <div class="suggestion-item">
                    <div class="suggestion-label">推荐中文名：</div>
                    <div class="suggestion-value">
                        ${suggestions.display_name}
                        <button class="btn-small" onclick="semanticManager.applySuggestion(${columnIndex}, 'display_name', '${suggestions.display_name}')">
                            应用
                        </button>
                    </div>
                </div>
            `;
        }
        
        if (suggestions.business_type) {
            html += `
                <div class="suggestion-item">
                    <div class="suggestion-label">业务类型：</div>
                    <div class="suggestion-value">${suggestions.business_type}</div>
                </div>
            `;
        }
        
        if (suggestions.tags && suggestions.tags.length > 0) {
            html += `
                <div class="suggestion-item">
                    <div class="suggestion-label">建议标签：</div>
                    <div class="suggestion-value">${suggestions.tags.join(', ')}</div>
                </div>
            `;
        }
        
        if (suggestions.unit) {
            html += `
                <div class="suggestion-item">
                    <div class="suggestion-label">单位：</div>
                    <div class="suggestion-value">${suggestions.unit}</div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }
    
    // 应用建议
    applySuggestion(columnIndex, field, value) {
        this.updateColumn(columnIndex, field, value);
        
        // 更新界面
        const row = document.querySelector(`tr[data-column-index="${columnIndex}"]`);
        if (row) {
            const input = row.querySelector(`input[onchange*="${field}"]`);
            if (input) {
                input.value = value;
            }
        }
        
        this.showSuccess('建议已应用');
    }
    
    // 保存语义信息
    async saveSemantic() {
        if (!this.currentTable) {
            return;
        }
        
        try {
            // 保存表信息
            const tableData = {
                schema_name: this.currentTable.schema_name,
                display_name: document.getElementById('table-display-name').value,
                description: document.getElementById('table-description').value,
                tags: this.currentTable.tags || []
            };
            
            const tableResponse = await fetch(`/api/semantic/metadata/${this.currentTable.datasource_id}/tables/${this.currentTable.table_name}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify(tableData)
            });
            
            const tableResult = await tableResponse.json();
            
            if (!tableResult.success) {
                throw new Error(tableResult.error || '保存表信息失败');
            }
            
            // 保存字段信息
            const columnPromises = this.currentColumns.map(column => {
                return fetch(`/api/semantic/metadata/tables/${tableResult.table_id}/columns/${column.column_name}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                    },
                    body: JSON.stringify({
                        data_type: column.data_type,
                        display_name: column.display_name || '',
                        description: column.description || '',
                        business_type: column.business_type || '',
                        unit: column.unit || '',
                        synonyms: column.synonyms || [],
                        examples: column.examples || [],
                        is_required: column.is_nullable === 'NO',
                        is_sensitive: column.is_sensitive || false
                    })
                });
            });
            
            await Promise.all(columnPromises);
            
            this.isDirty = false;
            this.disableSaveButton();
            this.showSuccess('语义信息已保存');
            
            // 更新统计信息
            this.loadStatistics();
            
        } catch (error) {
            console.error('Failed to save semantic:', error);
            this.showError('保存失败：' + error.message);
        }
    }
    
    // 批量编辑
    batchEdit() {
        const selectedColumns = document.querySelectorAll('#columns-tbody input[type="checkbox"]:checked');
        
        if (selectedColumns.length === 0) {
            this.showWarning('请先选择要编辑的字段');
            return;
        }
        
        // 创建批量编辑对话框
        const dialog = document.createElement('div');
        dialog.className = 'modal';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>批量编辑 ${selectedColumns.length} 个字段</h3>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>添加前缀</label>
                        <input type="text" id="batch-prefix" class="form-control" placeholder="例如：用户_">
                    </div>
                    <div class="form-group">
                        <label>添加后缀</label>
                        <input type="text" id="batch-suffix" class="form-control" placeholder="例如：_字段">
                    </div>
                    <div class="form-group">
                        <label>设置业务类型</label>
                        <select id="batch-business-type" class="form-control">
                            <option value="">不修改</option>
                            <option value="identifier">标识符</option>
                            <option value="name">名称</option>
                            <option value="datetime">时间</option>
                            <option value="monetary">金额</option>
                            <option value="quantity">数量</option>
                            <option value="status">状态</option>
                            <option value="percentage">百分比</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
                    <button class="btn-primary" onclick="semanticManager.applyBatchEdit()">应用</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
    }
    
    // 应用批量编辑
    applyBatchEdit() {
        const prefix = document.getElementById('batch-prefix').value;
        const suffix = document.getElementById('batch-suffix').value;
        const businessType = document.getElementById('batch-business-type').value;
        
        const selectedColumns = document.querySelectorAll('#columns-tbody input[type="checkbox"]:checked');
        
        selectedColumns.forEach(checkbox => {
            const row = checkbox.closest('tr');
            const index = parseInt(row.dataset.columnIndex);
            const column = this.currentColumns[index];
            
            if (prefix || suffix) {
                const currentName = column.display_name || column.column_name;
                column.display_name = prefix + currentName + suffix;
                
                // 更新界面
                const input = row.querySelector('input[onchange*="display_name"]');
                if (input) {
                    input.value = column.display_name;
                }
            }
            
            if (businessType) {
                column.business_type = businessType;
            }
        });
        
        this.isDirty = true;
        this.enableSaveButton();
        
        // 关闭对话框
        document.querySelector('.modal').remove();
        
        this.showSuccess(`已更新 ${selectedColumns.length} 个字段`);
    }
    
    // 扫描数据源
    async scanDatasource() {
        // 显示确认对话框
        const confirmScan = confirm(
            '即将扫描所有可访问的数据库并自动分析语义信息。\n\n' +
            '这将：\n' +
            '• 自动连接到已配置的数据库\n' +
            '• 扫描所有表和字段结构\n' +
            '• 智能推断业务语义\n' +
            '• 识别度量和维度\n\n' +
            '是否继续？'
        );
        
        if (!confirmScan) {
            return;
        }
        
        try {
            this.showLoading('正在扫描数据库，请稍候...');
            
            // 使用 'auto' 作为数据源ID，让后端自动扫描所有数据库
            const response = await fetch('/api/semantic/datasources/auto/scan', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({
                    display_name: '主数据源'
                })
            });
            
            const data = await response.json();
            this.hideLoading();
            
            if (data.success) {
                this.showSuccess('数据库扫描完成');
                this.loadDatasources();
                this.loadStatistics();
            } else {
                this.showError('扫描失败：' + data.error);
            }
        } catch (error) {
            this.hideLoading();
            console.error('Failed to scan datasource:', error);
            this.showError('扫描失败');
        }
    }
    
    // 导入语义层
    async importSemantic() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                this.showLoading('正在导入语义层...');
                
                const response = await fetch('/api/semantic/import', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                this.hideLoading();
                
                if (result.success) {
                    this.showSuccess('语义层导入成功');
                    this.loadDatasources();
                    this.loadStatistics();
                } else {
                    this.showError('导入失败：' + result.error);
                }
            } catch (error) {
                this.hideLoading();
                console.error('Failed to import semantic:', error);
                this.showError('导入失败：文件格式错误');
            }
        };
        
        input.click();
    }
    
    // 导出语义层
    async exportSemantic() {
        try {
            this.showLoading('正在导出语义层...');
            
            const response = await fetch('/api/semantic/export', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            const result = await response.json();
            this.hideLoading();
            
            if (result.success) {
                // 创建下载链接
                const blob = new Blob([JSON.stringify(result.data, null, 2)], {
                    type: 'application/json'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename || 'semantic_layer.json';
                a.click();
                URL.revokeObjectURL(url);
                
                this.showSuccess('语义层导出成功');
            } else {
                this.showError('导出失败：' + result.error);
            }
        } catch (error) {
            this.hideLoading();
            console.error('Failed to export semantic:', error);
            this.showError('导出失败');
        }
    }
    
    // 加载统计信息
    async loadStatistics() {
        try {
            const response = await fetch('/api/semantic/statistics', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.statistics = data.statistics;
                this.updateProgressBars();
            }
        } catch (error) {
            console.error('Failed to load statistics:', error);
        }
    }
    
    // 更新进度条
    updateProgressBars() {
        const tableProgress = Math.round(this.statistics.table_completion || 0);
        const columnProgress = Math.round(this.statistics.column_completion || 0);
        
        document.getElementById('table-progress').style.width = tableProgress + '%';
        document.getElementById('table-progress-text').textContent = tableProgress + '%';
        
        document.getElementById('column-progress').style.width = columnProgress + '%';
        document.getElementById('column-progress-text').textContent = columnProgress + '%';
    }
    
    // 计算表的完成度
    calculateTableCompleteness(table) {
        let score = 0;
        let total = 0;
        
        // 表信息
        if (table.display_name) score += 1;
        if (table.description) score += 1;
        total += 2;
        
        // 字段信息
        if (table.columns) {
            table.columns.forEach(column => {
                if (column.display_name) score += 1;
                if (column.description) score += 1;
                total += 2;
            });
        }
        
        return total > 0 ? Math.round((score / total) * 100) : 0;
    }
    
    // UI辅助方法
    enableSaveButton() {
        const btn = document.getElementById('save-semantic');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 保存*';
        }
    }
    
    disableSaveButton() {
        const btn = document.getElementById('save-semantic');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-save"></i> 保存';
        }
    }
    
    showSuccess(message) {
        this.showNotification(message, 'success');
    }
    
    showError(message) {
        this.showNotification(message, 'error');
    }
    
    showWarning(message) {
        this.showNotification(message, 'warning');
    }
    
    showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            ${message}
        `;
        
        document.body.appendChild(notification);
        
        // 自动隐藏
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    showLoading(message = '加载中...') {
        const loading = document.createElement('div');
        loading.id = 'semantic-loading';
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading-content">
                <i class="fas fa-spinner fa-spin"></i>
                <p>${message}</p>
            </div>
        `;
        document.body.appendChild(loading);
    }
    
    hideLoading() {
        const loading = document.getElementById('semantic-loading');
        if (loading) {
            loading.remove();
        }
    }
}

// 全局实例
let semanticManager = null;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 检查是否在语义层页面
    if (document.getElementById('semantic-tab')) {
        semanticManager = new SemanticLayerManager();
    }
});