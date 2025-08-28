/**
 * Onboarding Guide System
 * Interactive tour with bubble tooltips for first-time users
 */

class OnboardingGuide {
    constructor() {
        this.storageKey = 'querygpt_onboarding_completed';
        this.versionKey = 'querygpt_onboarding_version';
        this.sessionKey = 'querygpt_onboarding_shown_session';
        this.currentStep = 0;
        this.isActive = false;
        this.bubbles = [];
        this.config = null; // 配置将从文件加载
        this.configLoaded = false;
        
        // 默认配置（如果无法加载配置文件时使用）
        this.defaultConfig = {
            enabled: true,
            show_for_new_users: true,
            auto_start_delay: 1500,
            force_show: false,
            version: '1.0.0',
            settings: {
                allow_skip: true,
                show_progress: true,
                highlight_elements: true,
                overlay_opacity: 0.3
            }
        };
        
        // 引导步骤配置
        this.steps = [
            {
                element: '.sidebar-header',
                title: '欢迎使用 QueryGPT',
                content: '这是您的智能数据分析助手，让我快速带您了解主要功能',
                position: 'auto',
                showNext: true
            },
            {
                element: '#message-input',
                title: '自然语言查询',
                content: '在这里输入您的问题，比如"显示最近30天的销售数据"',
                position: 'auto',
                showNext: true
            },
            {
                element: '#send-button',
                title: '发送查询',
                content: '点击这里或按 Enter 键发送',
                position: 'auto',
                showNext: true
            },
            {
                element: '.model-selector',
                title: '切换AI模型',
                content: '选择不同的AI模型以获得最佳效果',
                position: 'auto',
                showNext: true
            },
            {
                element: '[data-tab="history"]',
                title: '查看历史',
                content: '这里可以查看所有查询历史',
                position: 'auto',
                showNext: true
            },
            {
                element: '.menu-item:has([data-tab="settings"])',
                alternativeElement: '[data-tab="settings"]',
                title: '系统设置',
                content: '在这里配置数据库连接和其他选项',
                position: 'auto',
                showNext: false,
                isLast: true
            }
        ];
    }
    
    /**
     * 初始化引导系统
     */
    async init() {
        // 先加载配置
        await this.loadConfig();
        
        // 检查配置是否启用引导
        if (!this.isOnboardingEnabled()) {
            console.log('新手引导已在配置中禁用');
            return;
        }
        
        // 检查是否强制显示（用于测试）
        const forceShow = this.config?.force_show || false;
        
        // 决定是否显示引导的逻辑
        let shouldShowGuide = false;
        
        const hasCompleted = this.hasCompletedOnboarding();
        const hasShownInSession = this.hasShownInSession();
        
        console.log('开始判断是否显示引导:', {
            forceShow: forceShow,
            hasCompleted: hasCompleted,
            hasShownInSession: hasShownInSession,
            showForNewUsers: this.config?.show_for_new_users
        });
        
        if (forceShow) {
            // 强制显示（测试模式）
            shouldShowGuide = true;
            console.log('新手引导：强制显示模式');
        } else if (hasCompleted) {
            // 已完成当前版本的引导，不再显示
            shouldShowGuide = false;
            console.log('新手引导：用户已完成当前版本引导');
        } else if (!hasCompleted && hasShownInSession) {
            // 未完成但本会话已显示过（避免刷新页面重复显示）
            shouldShowGuide = false;
            console.log('新手引导：本会话已显示过（未完成）');
        } else if (!hasCompleted && this.config?.show_for_new_users) {
            // 新用户，显示引导
            shouldShowGuide = true;
            console.log('新手引导：为新用户显示');
        }
        
        if (shouldShowGuide) {
            // 标记本会话已显示
            this.markShownInSession();
            
            // 使用配置的延迟时间
            const delay = this.config?.auto_start_delay || 1500;
            setTimeout(() => {
                this.start();
            }, delay);
        }
    }
    
    /**
     * 加载配置文件
     */
    async loadConfig() {
        try {
            const response = await fetch('/config/onboarding_config.json');
            if (response.ok) {
                const data = await response.json();
                this.config = data.onboarding || this.defaultConfig;
                this.configLoaded = true;
                
                if (this.config.debug?.enabled) {
                    console.log('Onboarding config loaded:', this.config);
                }
            } else {
                console.warn('无法加载引导配置，使用默认配置');
                this.config = this.defaultConfig;
            }
        } catch (error) {
            console.error('加载引导配置失败:', error);
            this.config = this.defaultConfig;
        }
    }
    
    /**
     * 检查引导是否启用
     */
    isOnboardingEnabled() {
        return this.config?.enabled !== false;
    }
    
    /**
     * 检查是否已完成引导
     */
    hasCompletedOnboarding() {
        // 检查是否已完成当前版本的引导
        const completedVersion = localStorage.getItem(this.versionKey);
        const currentVersion = this.config?.version || this.defaultConfig.version;
        
        console.log('检查引导完成状态:', {
            versionKey: this.versionKey,
            completedVersion: completedVersion,
            currentVersion: currentVersion,
            isCompleted: completedVersion === currentVersion
        });
        
        // 只有当版本号完全匹配时才视为已完成
        // 这样可以在版本更新时重新显示引导
        return completedVersion === currentVersion;
    }
    
    /**
     * 检查本会话是否已显示过引导
     */
    hasShownInSession() {
        return sessionStorage.getItem(this.sessionKey) === 'true';
    }
    
    /**
     * 标记本会话已显示引导
     */
    markShownInSession() {
        sessionStorage.setItem(this.sessionKey, 'true');
    }
    
    /**
     * 标记引导已完成
     */
    markAsCompleted() {
        const currentVersion = this.config?.version || this.defaultConfig.version;
        
        console.log('标记引导已完成:', {
            currentVersion: currentVersion,
            storageKey: this.storageKey,
            versionKey: this.versionKey
        });
        
        // 保存完成状态到 localStorage
        localStorage.setItem(this.storageKey, 'true');
        localStorage.setItem(this.versionKey, currentVersion);
        
        // 清除 sessionStorage，因为已经完成了，不需要防止重复显示
        sessionStorage.removeItem(this.sessionKey);
        
        // 验证保存是否成功
        const savedVersion = localStorage.getItem(this.versionKey);
        const savedStatus = localStorage.getItem(this.storageKey);
        console.log('验证保存结果:', {
            savedVersion: savedVersion,
            savedStatus: savedStatus,
            success: savedVersion === currentVersion,
            sessionCleared: sessionStorage.getItem(this.sessionKey) === null
        });
    }
    
    /**
     * 开始引导
     */
    start() {
        this.isActive = true;
        this.currentStep = 0;
        
        // 添加半透明遮罩
        this.createOverlay();
        
        // 显示第一步
        this.showStep(0);
        
        // 添加窗口调整监听器
        this.resizeHandler = () => {
            if (this.isActive && this.bubbles.length > 0) {
                const step = this.steps[this.currentStep];
                const element = document.querySelector(step.element);
                if (element && this.bubbles[0]) {
                    this.positionBubble(this.bubbles[0], element, step.position);
                }
            }
        };
        window.addEventListener('resize', this.resizeHandler);
        window.addEventListener('scroll', this.resizeHandler);
    }
    
    /**
     * 创建遮罩层
     */
    createOverlay() {
        const opacity = this.config?.settings?.overlay_opacity || 0.3;
        this.overlay = document.createElement('div');
        this.overlay.className = 'onboarding-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, ${opacity});
            z-index: 9998;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(this.overlay);
        
        // 如果配置允许跳过，点击遮罩跳过引导
        if (this.config?.settings?.allow_skip !== false) {
            this.overlay.addEventListener('click', () => {
                this.showSkipConfirmDialog();
            });
        }
    }
    
    /**
     * 显示跳过确认对话框
     */
    showSkipConfirmDialog() {
        // 创建确认对话框
        const dialog = document.createElement('div');
        dialog.className = 'onboarding-confirm-dialog';
        dialog.innerHTML = `
            <div class="confirm-dialog-content">
                <div class="confirm-dialog-icon">
                    <i class="fas fa-question-circle"></i>
                </div>
                <div class="confirm-dialog-title">跳过新手引导</div>
                <div class="confirm-dialog-message">
                    确定要跳过新手引导吗？<br>
                    您可以稍后在帮助菜单中重新启动引导。
                </div>
                <div class="confirm-dialog-buttons">
                    <button class="btn-cancel">继续引导</button>
                    <button class="btn-confirm">跳过</button>
                </div>
            </div>
        `;
        
        // 添加样式
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 12px;
            padding: 0;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            z-index: 10002;
            min-width: 320px;
            animation: confirmDialogShow 0.3s ease;
        `;
        
        // 添加动画样式（如果还没有）
        if (!document.querySelector('#onboarding-confirm-styles')) {
            const styles = document.createElement('style');
            styles.id = 'onboarding-confirm-styles';
            styles.textContent = `
                @keyframes confirmDialogShow {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
                .onboarding-confirm-dialog .confirm-dialog-content {
                    padding: 24px;
                    text-align: center;
                }
                .onboarding-confirm-dialog .confirm-dialog-icon {
                    font-size: 48px;
                    color: #ffc107;
                    margin-bottom: 16px;
                }
                .onboarding-confirm-dialog .confirm-dialog-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: #333;
                    margin-bottom: 12px;
                }
                .onboarding-confirm-dialog .confirm-dialog-message {
                    font-size: 14px;
                    color: #666;
                    line-height: 1.6;
                    margin-bottom: 24px;
                }
                .onboarding-confirm-dialog .confirm-dialog-buttons {
                    display: flex;
                    gap: 12px;
                    justify-content: center;
                }
                .onboarding-confirm-dialog button {
                    padding: 8px 24px;
                    border: none;
                    border-radius: 6px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-weight: 500;
                }
                .onboarding-confirm-dialog .btn-cancel {
                    background: #f0f0f0;
                    color: #333;
                }
                .onboarding-confirm-dialog .btn-cancel:hover {
                    background: #e0e0e0;
                }
                .onboarding-confirm-dialog .btn-confirm {
                    background: #007bff;
                    color: white;
                }
                .onboarding-confirm-dialog .btn-confirm:hover {
                    background: #0056b3;
                }
            `;
            document.head.appendChild(styles);
        }
        
        // 添加到页面
        document.body.appendChild(dialog);
        
        // 绑定事件
        const cancelBtn = dialog.querySelector('.btn-cancel');
        const confirmBtn = dialog.querySelector('.btn-confirm');
        
        const closeDialog = () => {
            dialog.style.animation = 'confirmDialogShow 0.2s ease reverse';
            setTimeout(() => {
                dialog.remove();
            }, 200);
        };
        
        cancelBtn.addEventListener('click', closeDialog);
        confirmBtn.addEventListener('click', () => {
            closeDialog();
            this.complete();
        });
        
        // 点击对话框外部不关闭（防止误操作）
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                e.stopPropagation();
            }
        });
    }
    
    /**
     * 显示指定步骤
     */
    showStep(stepIndex) {
        if (stepIndex >= this.steps.length) {
            this.complete();
            return;
        }
        
        const step = this.steps[stepIndex];
        let element = document.querySelector(step.element);
        
        // 如果主元素未找到，尝试备选元素
        if (!element && step.alternativeElement) {
            element = document.querySelector(step.alternativeElement);
        }
        
        // 如果还是找不到，尝试查找包含设置的菜单组
        if (!element && step.element.includes('settings')) {
            // 查找所有菜单项，找到包含"设置"或settings的项
            const menuItems = document.querySelectorAll('.menu-item, .nav-link');
            for (const item of menuItems) {
                const text = item.textContent || '';
                const hasSettingsAttr = item.querySelector('[data-tab="settings"]') || 
                                       item.querySelector('[data-settings-tab]');
                const hasSettingsText = text.includes('设置') || text.toLowerCase().includes('setting');
                
                if (hasSettingsAttr || hasSettingsText) {
                    element = item;
                    break;
                }
            }
        }
        
        if (!element) {
            console.warn('引导元素未找到:', step.element);
            this.showStep(stepIndex + 1);
            return;
        }
        
        // 清除之前的气泡
        this.clearBubbles();
        
        // 高亮目标元素
        this.highlightElement(element);
        
        // 创建并显示气泡，使用智能定位
        this.createBubble(element, step);
        
        this.currentStep = stepIndex;
    }
    
    /**
     * 高亮目标元素
     */
    highlightElement(element) {
        // 移除之前的高亮
        document.querySelectorAll('.onboarding-highlight').forEach(el => {
            el.classList.remove('onboarding-highlight');
        });
        
        // 添加高亮类
        element.classList.add('onboarding-highlight');
        
        // 确保元素可见
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 提升元素层级
        const originalZIndex = element.style.zIndex;
        element.style.zIndex = '9999';
        element.dataset.originalZIndex = originalZIndex;
    }
    
    /**
     * 创建气泡提示
     */
    createBubble(targetElement, step) {
        const bubble = document.createElement('div');
        bubble.className = 'onboarding-bubble';
        
        // 气泡内容
        bubble.innerHTML = `
            <div class="bubble-arrow"></div>
            <div class="bubble-content">
                <button class="bubble-close" aria-label="关闭">×</button>
                <h4 class="bubble-title">${step.title}</h4>
                <p class="bubble-text">${step.content}</p>
                <div class="bubble-footer">
                    <div class="bubble-progress">
                        <span class="progress-text">${this.currentStep + 1} / ${this.steps.length}</span>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${((this.currentStep + 1) / this.steps.length) * 100}%"></div>
                        </div>
                    </div>
                    <div class="bubble-actions">
                        ${this.currentStep > 0 ? '<button class="bubble-btn bubble-btn-prev">上一步</button>' : ''}
                        ${step.showNext ? '<button class="bubble-btn bubble-btn-next">下一步</button>' : ''}
                        ${step.isLast ? '<button class="bubble-btn bubble-btn-complete">完成</button>' : ''}
                        <button class="bubble-btn bubble-btn-skip">跳过</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(bubble);
        this.bubbles.push(bubble);
        
        // 定位气泡，如果position是'auto'，让系统自动决定
        const position = step.position === 'auto' ? 'right' : step.position;
        this.positionBubble(bubble, targetElement, position);
        
        // 绑定事件
        this.bindBubbleEvents(bubble);
        
        // 添加显示动画
        setTimeout(() => {
            bubble.classList.add('show');
        }, 100);
    }
    
    /**
     * 定位气泡
     */
    positionBubble(bubble, targetElement, preferredPosition) {
        // 先让气泡显示以获取准确尺寸
        bubble.style.visibility = 'hidden';
        bubble.style.display = 'block';
        
        const targetRect = targetElement.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const arrow = bubble.querySelector('.bubble-arrow');
        
        // 添加滚动偏移
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        // 智能位置检测
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // 计算元素在视窗中的位置
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;
        
        // 智能决定最佳位置
        let position = preferredPosition;
        
        // 如果元素被折叠或隐藏（宽度或高度为0），尝试找到其父元素
        if (targetRect.width === 0 || targetRect.height === 0) {
            // 尝试找到可见的父元素或兄弟元素
            let parentElement = targetElement.parentElement;
            while (parentElement && parentElement.getBoundingClientRect().width === 0) {
                parentElement = parentElement.parentElement;
            }
            if (parentElement) {
                const parentRect = parentElement.getBoundingClientRect();
                // 使用父元素的位置，但稍微偏移
                targetRect = {
                    left: parentRect.left,
                    right: parentRect.right,
                    top: parentRect.top,
                    bottom: parentRect.bottom,
                    width: parentRect.width,
                    height: parentRect.height
                };
            }
        }
        
        // 根据元素在屏幕上的位置智能选择气泡位置
        const spaceRight = viewportWidth - targetRect.right;
        const spaceLeft = targetRect.left;
        const spaceTop = targetRect.top;
        const spaceBottom = viewportHeight - targetRect.bottom;
        
        // 如果首选位置空间不足，选择最佳替代位置
        const bubbleWidth = bubbleRect.width;
        const bubbleHeight = bubbleRect.height;
        const gap = 20;
        
        // 检查每个方向的可用空间
        const canPlaceRight = spaceRight >= bubbleWidth + gap;
        const canPlaceLeft = spaceLeft >= bubbleWidth + gap;
        const canPlaceTop = spaceTop >= bubbleHeight + gap;
        const canPlaceBottom = spaceBottom >= bubbleHeight + gap;
        
        // 智能选择位置
        if (position === 'right' && !canPlaceRight) {
            if (canPlaceLeft) position = 'left';
            else if (canPlaceBottom) position = 'bottom';
            else if (canPlaceTop) position = 'top';
        } else if (position === 'left' && !canPlaceLeft) {
            if (canPlaceRight) position = 'right';
            else if (canPlaceBottom) position = 'bottom';
            else if (canPlaceTop) position = 'top';
        } else if (position === 'top' && !canPlaceTop) {
            if (canPlaceBottom) position = 'bottom';
            else if (canPlaceRight) position = 'right';
            else if (canPlaceLeft) position = 'left';
        } else if (position === 'bottom' && !canPlaceBottom) {
            if (canPlaceTop) position = 'top';
            else if (canPlaceRight) position = 'right';
            else if (canPlaceLeft) position = 'left';
        }
        
        // 如果元素在左侧边栏，优先显示在右边
        if (targetRect.left < viewportWidth * 0.3 && canPlaceRight) {
            position = 'right';
        }
        // 如果元素在右侧，优先显示在左边
        else if (targetRect.right > viewportWidth * 0.7 && canPlaceLeft) {
            position = 'left';
        }
        
        let top, left;
        const arrowSize = 12; // 箭头大小
        
        // 根据位置计算坐标
        switch (position) {
            case 'top':
                top = targetRect.top + scrollTop - bubbleRect.height - gap;
                left = targetRect.left + scrollLeft + (targetRect.width - bubbleRect.width) / 2;
                arrow.className = 'bubble-arrow arrow-bottom';
                // 箭头居中对齐
                arrow.style.left = '50%';
                arrow.style.marginLeft = '-6px';
                arrow.style.right = 'auto';
                arrow.style.top = 'auto';
                break;
                
            case 'bottom':
                top = targetRect.bottom + scrollTop + gap;
                left = targetRect.left + scrollLeft + (targetRect.width - bubbleRect.width) / 2;
                arrow.className = 'bubble-arrow arrow-top';
                // 箭头居中对齐
                arrow.style.left = '50%';
                arrow.style.marginLeft = '-6px';
                arrow.style.right = 'auto';
                arrow.style.top = '-7px';
                break;
                
            case 'left':
                top = targetRect.top + scrollTop + (targetRect.height - bubbleRect.height) / 2;
                left = targetRect.left + scrollLeft - bubbleRect.width - gap;
                arrow.className = 'bubble-arrow arrow-right';
                // 箭头垂直居中
                arrow.style.top = '50%';
                arrow.style.marginTop = '-6px';
                arrow.style.left = 'auto';
                arrow.style.right = '-7px';
                break;
                
            case 'right':
            default:
                top = targetRect.top + scrollTop + (targetRect.height - bubbleRect.height) / 2;
                left = targetRect.right + scrollLeft + gap;
                arrow.className = 'bubble-arrow arrow-left';
                // 箭头垂直居中
                arrow.style.top = '50%';
                arrow.style.marginTop = '-6px';
                arrow.style.left = '-7px';
                arrow.style.right = 'auto';
                break;
        }
        
        // 视窗边界检测和调整
        const margin = 10;
        
        // 水平边界检测
        if (left < margin) {
            left = margin;
            // 调整箭头位置
            if (position === 'top' || position === 'bottom') {
                const arrowLeft = targetRect.left + targetRect.width / 2 - left - 6;
                arrow.style.left = `${Math.max(20, Math.min(bubbleRect.width - 20, arrowLeft))}px`;
                arrow.style.marginLeft = '0';
            }
        } else if (left + bubbleRect.width > viewportWidth - margin) {
            left = viewportWidth - bubbleRect.width - margin;
            // 调整箭头位置
            if (position === 'top' || position === 'bottom') {
                const arrowLeft = targetRect.left + targetRect.width / 2 - left - 6;
                arrow.style.left = `${Math.max(20, Math.min(bubbleRect.width - 20, arrowLeft))}px`;
                arrow.style.marginLeft = '0';
            }
        }
        
        // 垂直边界检测
        if (top < scrollTop + margin) {
            // 如果顶部溢出，改为显示在底部
            if (position === 'top') {
                top = targetRect.bottom + scrollTop + gap;
                arrow.className = 'bubble-arrow arrow-top';
                arrow.style.left = '50%';
                arrow.style.marginLeft = '-6px';
            } else {
                top = scrollTop + margin;
            }
        } else if (top + bubbleRect.height > scrollTop + viewportHeight - margin) {
            // 如果底部溢出，改为显示在顶部
            if (position === 'bottom') {
                top = targetRect.top + scrollTop - bubbleRect.height - gap;
                arrow.className = 'bubble-arrow arrow-bottom';
                arrow.style.left = '50%';
                arrow.style.marginLeft = '-6px';
            } else {
                top = scrollTop + viewportHeight - bubbleRect.height - margin;
            }
        }
        
        // 应用最终位置
        bubble.style.position = 'absolute';
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;
        bubble.style.visibility = 'visible';
    }
    
    /**
     * 绑定气泡事件
     */
    bindBubbleEvents(bubble) {
        // 关闭按钮
        const closeBtn = bubble.querySelector('.bubble-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (confirm('要结束新手引导吗？')) {
                    this.complete();
                }
            });
        }
        
        // 上一步按钮
        const prevBtn = bubble.querySelector('.bubble-btn-prev');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.showStep(this.currentStep - 1);
            });
        }
        
        // 下一步按钮
        const nextBtn = bubble.querySelector('.bubble-btn-next');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.showStep(this.currentStep + 1);
            });
        }
        
        // 完成按钮
        const completeBtn = bubble.querySelector('.bubble-btn-complete');
        if (completeBtn) {
            completeBtn.addEventListener('click', () => {
                this.complete();
            });
        }
        
        // 跳过按钮
        const skipBtn = bubble.querySelector('.bubble-btn-skip');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                this.showSkipConfirmDialog();
            });
        }
    }
    
    /**
     * 清除气泡
     */
    clearBubbles() {
        this.bubbles.forEach(bubble => {
            bubble.classList.remove('show');
            setTimeout(() => {
                bubble.remove();
            }, 300);
        });
        this.bubbles = [];
        
        // 恢复元素原始层级
        document.querySelectorAll('.onboarding-highlight').forEach(el => {
            if (el.dataset.originalZIndex) {
                el.style.zIndex = el.dataset.originalZIndex;
                delete el.dataset.originalZIndex;
            } else {
                el.style.zIndex = '';
            }
            el.classList.remove('onboarding-highlight');
        });
    }
    
    /**
     * 完成引导
     */
    complete() {
        this.isActive = false;
        this.markAsCompleted();
        
        // 清除所有元素
        this.clearBubbles();
        
        // 移除遮罩
        if (this.overlay) {
            this.overlay.style.opacity = '0';
            setTimeout(() => {
                this.overlay.remove();
            }, 300);
        }
        
        // 清理事件监听器
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            window.removeEventListener('scroll', this.resizeHandler);
            this.resizeHandler = null;
        }
        
        // 显示完成提示
        this.showCompletionMessage();
    }
    
    /**
     * 显示完成消息
     */
    showCompletionMessage() {
        const message = document.createElement('div');
        message.className = 'onboarding-completion';
        message.innerHTML = `
            <i class="fas fa-check-circle"></i>
            <span>新手引导完成！开始探索 QueryGPT 吧</span>
        `;
        message.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #28a745;
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 16px;
            animation: slideDown 0.4s ease;
        `;
        
        document.body.appendChild(message);
        
        setTimeout(() => {
            message.style.animation = 'fadeOut 0.5s ease';
            setTimeout(() => {
                message.remove();
            }, 500);
        }, 3000);
    }
    
    /**
     * 重置引导（用于测试）
     */
    reset() {
        // 清除所有相关存储
        localStorage.removeItem(this.storageKey);
        localStorage.removeItem(this.versionKey);
        sessionStorage.removeItem(this.sessionKey);
        console.log('新手引导已重置');
        location.reload();
    }
}

// 创建全局实例
const onboardingGuide = new OnboardingGuide();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 只在主页面初始化
    if (document.querySelector('.sidebar-header')) {
        onboardingGuide.init();
    }
});

// 导出到全局作用域，方便调试
window.OnboardingGuide = {
    // 获取当前状态
    getStatus: () => {
        return {
            completed: onboardingGuide.hasCompletedOnboarding(),
            shownInSession: onboardingGuide.hasShownInSession(),
            version: localStorage.getItem(onboardingGuide.versionKey) || 'none',
            currentVersion: onboardingGuide.config?.version || onboardingGuide.defaultConfig.version,
            enabled: onboardingGuide.config?.enabled !== false,
            forceShow: onboardingGuide.config?.force_show || false
        };
    },
    // 重置引导
    reset: () => onboardingGuide.reset(),
    // 手动启动引导
    start: () => onboardingGuide.start(),
    // 完成引导
    complete: () => onboardingGuide.complete()
};