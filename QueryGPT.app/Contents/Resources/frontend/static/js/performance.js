/**
 * 性能优化工具模块
 * 提供防抖、节流、懒加载等性能优化功能
 */

class PerformanceUtils {
    /**
     * 防抖函数 - 延迟执行，多次触发只执行最后一次
     * @param {Function} func - 要执行的函数
     * @param {number} wait - 延迟时间（毫秒）
     * @param {boolean} immediate - 是否立即执行
     * @returns {Function} 防抖后的函数
     */
    static debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    }
    
    /**
     * 节流函数 - 限制执行频率
     * @param {Function} func - 要执行的函数
     * @param {number} limit - 时间限制（毫秒）
     * @returns {Function} 节流后的函数
     */
    static throttle(func, limit) {
        let inThrottle;
        let lastFunc;
        let lastRan;
        return function(...args) {
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                lastRan = Date.now();
                inThrottle = true;
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(() => {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, Math.max(limit - (Date.now() - lastRan), 0));
            }
        };
    }
    
    /**
     * 懒加载图片
     * @param {string} selector - 图片选择器
     */
    static lazyLoadImages(selector = 'img[data-src]') {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.add('loaded');
                    img.removeAttribute('data-src');
                    observer.unobserve(img);
                }
            });
        });
        
        document.querySelectorAll(selector).forEach(img => {
            imageObserver.observe(img);
        });
    }
    
    /**
     * 虚拟滚动优化
     * @param {Object} config - 配置对象
     */
    static virtualScroll(config) {
        const {
            container,
            itemHeight,
            items,
            renderItem,
            bufferSize = 5
        } = config;
        
        let scrollTop = 0;
        let startIndex = 0;
        let endIndex = 0;
        
        const updateVisibleItems = () => {
            scrollTop = container.scrollTop;
            startIndex = Math.floor(scrollTop / itemHeight);
            endIndex = Math.min(
                startIndex + Math.ceil(container.clientHeight / itemHeight) + bufferSize,
                items.length
            );
            
            startIndex = Math.max(0, startIndex - bufferSize);
            
            // 清空容器
            container.innerHTML = '';
            
            // 添加顶部占位
            const topPadding = document.createElement('div');
            topPadding.style.height = `${startIndex * itemHeight}px`;
            container.appendChild(topPadding);
            
            // 渲染可见项
            for (let i = startIndex; i < endIndex; i++) {
                const item = renderItem(items[i], i);
                container.appendChild(item);
            }
            
            // 添加底部占位
            const bottomPadding = document.createElement('div');
            bottomPadding.style.height = `${(items.length - endIndex) * itemHeight}px`;
            container.appendChild(bottomPadding);
        };
        
        container.addEventListener('scroll', this.throttle(updateVisibleItems, 16));
        updateVisibleItems();
        
        return {
            refresh: updateVisibleItems,
            destroy: () => {
                container.removeEventListener('scroll', updateVisibleItems);
            }
        };
    }
    
    /**
     * 预加载资源
     * @param {Array} urls - 要预加载的URL列表
     */
    static preloadResources(urls) {
        return Promise.all(urls.map(url => {
            return new Promise((resolve, reject) => {
                const link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = url;
                link.onload = resolve;
                link.onerror = reject;
                document.head.appendChild(link);
            });
        }));
    }
    
    /**
     * 内存缓存管理
     */
    static memoryCache = {
        cache: new Map(),
        maxSize: 100,
        
        set(key, value, ttl = 60000) {
            if (this.cache.size >= this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            
            this.cache.set(key, {
                value,
                expires: Date.now() + ttl
            });
        },
        
        get(key) {
            const item = this.cache.get(key);
            if (!item) return null;
            
            if (Date.now() > item.expires) {
                this.cache.delete(key);
                return null;
            }
            
            return item.value;
        },
        
        clear() {
            this.cache.clear();
        }
    };
    
    /**
     * 批量DOM操作优化
     * @param {Function} operations - DOM操作函数
     */
    static batchDOMUpdate(operations) {
        requestAnimationFrame(() => {
            const fragment = document.createDocumentFragment();
            operations(fragment);
            requestAnimationFrame(() => {
                // 第二帧确保渲染完成
            });
        });
    }
    
    /**
     * Web Worker 管理
     */
    static createWorker(workerFunction) {
        const blob = new Blob([`(${workerFunction.toString()})()`], {
            type: 'application/javascript'
        });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        
        return {
            worker,
            terminate() {
                worker.terminate();
                URL.revokeObjectURL(url);
            }
        };
    }
}

// 导出到全局
window.PerformanceUtils = PerformanceUtils;