// 全局变量
let tasks = [];
let history = [];
let config = {};
let updateInterval;
let chartInstance = null;

// DOM元素
const taskForm = document.getElementById('task-form');
const urlInput = document.getElementById('url-input');
const tasksTableBody = document.getElementById('tasks-table-body');
const historyTableBody = document.getElementById('history-table-body');
const settingsForm = document.getElementById('settings-form');
const saveSettingsBtn = document.getElementById('save-settings');
const loadingElement = document.getElementById('loading');

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

// 初始化应用
function initApp() {
    // 设置导航栏活动状态
    setupNavigation();
    
    // 获取当前页面路径
    const currentPath = window.location.pathname;
    
    // 根据页面路径加载相应功能
    if (currentPath === '/' || currentPath === '/dashboard') {
        // 主页功能
        loadConfig();
        loadTasks();
        loadHistory();
        
        const taskForm = document.getElementById('task-form');
        if (taskForm) {
            taskForm.addEventListener('submit', handleTaskSubmit);
        }
        
        // 启动定时更新任务状态
        startTaskUpdates();
    } else if (currentPath === '/tasks') {
        // 任务管理页面功能
        loadTasks();
        
        // 启动定时更新任务状态
        startTaskUpdates();
    } else if (currentPath === '/history') {
        // 历史记录页面功能
        loadHistory();
    } else if (currentPath === '/settings') {
        // 设置页面功能
        loadConfig();
        
        const saveSettingsBtn = document.getElementById('save-settings');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', handleSettingsSave);
        }
    }
}

// 加载配置
function loadConfig() {
    fetch('/api/config')
        .then(response => response.json())
        .then(data => {
            config = data;
            updateSettingsForm();
        })
        .catch(error => {
            console.error('加载配置失败:', error);
            showToast('加载配置失败', 'error');
        });
}

// 加载任务列表
function loadTasks() {
    fetch('/api/tasks')
        .then(response => response.json())
        .then(data => {
            tasks = data.tasks || [];
            updateTasksTable();
            updateTaskStats();
        })
        .catch(error => {
            console.error('加载任务列表失败:', error);
            showToast('加载任务列表失败', 'error');
        });
}

// 加载历史记录
function loadHistory() {
    fetch('/api/history')
        .then(response => response.json())
        .then(data => {
            history = data.history || [];
            updateHistoryTable();
        })
        .catch(error => {
            console.error('加载历史记录失败:', error);
            showToast('加载历史记录失败', 'error');
        });
}

// 更新任务表格
function updateTasksTable() {
    if (!tasksTableBody) return;
    
    if (tasks.length === 0) {
        tasksTableBody.innerHTML = '<tr><td colspan="6" class="text-center">暂无任务</td></tr>';
        return;
    }
    
    tasksTableBody.innerHTML = '';
    
    tasks.forEach(task => {
        const row = document.createElement('tr');
        
        // 状态标签
        const statusBadge = getStatusBadge(task.status);
        
        // 进度条
        const progressBar = task.status === 'running' ? 
            `<div class="progress">
                <div class="progress-bar" role="progressbar" style="width: ${task.progress || 0}%;" aria-valuenow="${task.progress || 0}" aria-valuemin="0" aria-valuemax="100">${task.progress || 0}%</div>
            </div>` : 
            (task.status === 'completed' ? '已完成' : (task.status === 'failed' ? '失败' : '等待中'));
        
        // 操作按钮
        const actionButtons = getTaskActionButtons(task);
        
        row.innerHTML = `
            <td>${task.id}</td>
            <td><a href="${task.url}" target="_blank">${task.url}</a></td>
            <td>${statusBadge}</td>
            <td>${formatDate(task.created_time)}</td>
            <td>${progressBar}</td>
            <td>${actionButtons}</td>
        `;
        
        tasksTableBody.appendChild(row);
    });
}

// 更新历史记录表格
function updateHistoryTable() {
    if (!historyTableBody) return;
    
    if (history.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="4" class="text-center">暂无历史记录</td></tr>';
        return;
    }
    
    historyTableBody.innerHTML = '';
    
    history.forEach(item => {
        const row = document.createElement('tr');
        
        // 结果格式化
        const resultText = item.status === 'success' ? 
            `成功 (${item.count || 0} 张图片)` : 
            '失败';
        
        // 操作按钮
        const actionButtons = getHistoryActionButtons(item);
        
        row.innerHTML = `
            <td><a href="${item.url}" target="_blank">${item.url}</a></td>
            <td>${formatDate(item.timestamp)}</td>
            <td>${resultText}</td>
            <td>${actionButtons}</td>
        `;
        
        historyTableBody.appendChild(row);
    });
}

// 更新任务统计
function updateTaskStats() {
    const totalTasksElement = document.getElementById('total-tasks');
    const successTasksElement = document.getElementById('success-tasks');
    const runningTasksElement = document.getElementById('running-tasks');
    
    if (!totalTasksElement || !successTasksElement || !runningTasksElement) return;
    
    const totalTasks = tasks.length;
    const successTasks = tasks.filter(t => t.status === 'completed').length;
    const runningTasks = tasks.filter(t => t.status === 'running').length;
    
    totalTasksElement.textContent = totalTasks;
    successTasksElement.textContent = successTasks;
    runningTasksElement.textContent = runningTasks;
}

// 更新设置表单
function updateSettingsForm() {
    // 基本设置
    const savePathElement = document.getElementById('save-path');
    if (savePathElement) savePathElement.value = config.save_path || '';
    
    const downloadThreadsElement = document.getElementById('download-threads');
    if (downloadThreadsElement) downloadThreadsElement.value = config.download_threads || 5;
    
    const concurrentTasksElement = document.getElementById('concurrent-tasks');
    if (concurrentTasksElement) concurrentTasksElement.value = config.concurrent_tasks || 3;
    
    const saveFormatElement = document.getElementById('save-format');
    if (saveFormatElement) saveFormatElement.value = config.save_format || 'JPG';
    
    // 高级设置
    const ffmpegPathElement = document.getElementById('ffmpeg-path');
    if (ffmpegPathElement) ffmpegPathElement.value = config.ffmpeg_path || '';
    
    const chromedriverPathElement = document.getElementById('chromedriver-path');
    if (chromedriverPathElement) chromedriverPathElement.value = config.chromedriver_path || '';
    
    const renameFormatElement = document.getElementById('rename-format');
    if (renameFormatElement) renameFormatElement.value = config.rename_format || '{id}_{num}';
    
    const requestDelayElement = document.getElementById('request-delay');
    if (requestDelayElement) requestDelayElement.value = config.request_delay || 1;
    
    // 功能开关
    const downloadVideoElement = document.getElementById('download-video');
    if (downloadVideoElement) downloadVideoElement.checked = config.download_video || false;
    
    const clipboardMonitorElement = document.getElementById('clipboard-monitor');
    if (clipboardMonitorElement) clipboardMonitorElement.checked = config.clipboard_monitor || false;
    
    const debugModeElement = document.getElementById('debug-mode');
    if (debugModeElement) debugModeElement.checked = config.debug_mode || false;
    
    const unattendedModeElement = document.getElementById('unattended-mode');
    if (unattendedModeElement) unattendedModeElement.checked = config.unattended_mode || false;
    
    // 自定义标签
    const customTagsElement = document.getElementById('custom-tags');
    if (customTagsElement) customTagsElement.value = config.custom_tags ? config.custom_tags.join(', ') : '';
}

// 处理任务提交
function handleTaskSubmit(event) {
    event.preventDefault();
    
    const url = urlInput.value.trim();
    if (!url) {
        showToast('请输入有效的URL', 'error');
        return;
    }
    
    showLoading();
    
    fetch('/api/tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.status === 'success') {
            urlInput.value = '';
            showToast('任务已添加', 'success');
            loadTasks();
        } else {
            showToast(data.message || '添加任务失败', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        console.error('添加任务失败:', error);
        showToast('添加任务失败', 'error');
    });
}

// 处理设置保存
function handleSettingsSave() {
    const settings = {
        save_path: document.getElementById('save-path').value,
        download_threads: parseInt(document.getElementById('download-threads').value),
        concurrent_tasks: parseInt(document.getElementById('concurrent-tasks').value),
        save_format: document.getElementById('save-format').value,
        ffmpeg_path: document.getElementById('ffmpeg-path').value,
        chromedriver_path: document.getElementById('chromedriver-path').value,
        rename_format: document.getElementById('rename-format').value,
        request_delay: parseFloat(document.getElementById('request-delay').value),
        download_video: document.getElementById('download-video').checked,
        clipboard_monitor: document.getElementById('clipboard-monitor').checked,
        debug_mode: document.getElementById('debug-mode').checked,
        unattended_mode: document.getElementById('unattended-mode').checked,
        custom_tags: document.getElementById('custom-tags').value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag)
    };
    
    showLoading();
    
    fetch('/api/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.status === 'success') {
            showToast('设置已保存', 'success');
            config = settings;
        } else {
            showToast(data.message || '保存设置失败', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        console.error('保存设置失败:', error);
        showToast('保存设置失败', 'error');
    });
}

// 停止任务
function stopTask(taskId) {
    showLoading();
    
    fetch(`/api/tasks/${taskId}/stop`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.status === 'success') {
            showToast('任务已停止', 'success');
            loadTasks();
        } else {
            showToast(data.message || '停止任务失败', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        console.error('停止任务失败:', error);
        showToast('停止任务失败', 'error');
    });
}

// 重试任务
function retryTask(taskId) {
    showLoading();
    
    fetch(`/api/tasks/${taskId}/retry`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.status === 'success') {
            showToast('任务已重试', 'success');
            loadTasks();
        } else {
            showToast(data.message || '重试任务失败', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        console.error('重试任务失败:', error);
        showToast('重试任务失败', 'error');
    });
}

// 删除历史记录
function deleteHistory(historyId) {
    if (!confirm('确定要删除这条历史记录吗？')) {
        return;
    }
    
    showLoading();
    
    fetch(`/api/history/${historyId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.status === 'success') {
            showToast('历史记录已删除', 'success');
            loadHistory();
        } else {
            showToast(data.message || '删除历史记录失败', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        console.error('删除历史记录失败:', error);
        showToast('删除历史记录失败', 'error');
    });
}

// 启动定时更新任务状态
function startTaskUpdates() {
    // 清除之前的定时器
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    // 设置新的定时器，每5秒更新一次
    updateInterval = setInterval(() => {
        loadTasks();
    }, 5000);
}

// 设置导航栏活动状态
function setupNavigation() {
    // 获取当前页面路径
    const currentPath = window.location.pathname;
    
    // 获取所有导航链接
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    
    // 移除所有活动状态
    navLinks.forEach(link => link.classList.remove('active'));
    
    // 根据当前路径设置活动状态
    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        if (linkPath === currentPath || (currentPath === '/' && linkPath === '/')) {
            link.classList.add('active');
        }
    });
}

// 获取状态标签
function getStatusBadge(status) {
    switch (status) {
        case 'completed':
            return '<span class="badge bg-success">已完成</span>';
        case 'running':
            return '<span class="badge bg-primary">进行中</span>';
        case 'failed':
            return '<span class="badge bg-danger">失败</span>';
        case 'pending':
            return '<span class="badge bg-secondary">等待中</span>';
        default:
            return '<span class="badge bg-secondary">未知</span>';
    }
}

// 获取任务操作按钮
function getTaskActionButtons(task) {
    let buttons = '';
    
    if (task.status === 'running') {
        buttons += `<button class="btn btn-sm btn-danger me-1" onclick="stopTask(${task.id})">
            <i class="fas fa-stop"></i> 停止
        </button>`;
    } else if (task.status === 'failed') {
        buttons += `<button class="btn btn-sm btn-warning me-1" onclick="retryTask(${task.id})">
            <i class="fas fa-redo"></i> 重试
        </button>`;
    }
    
    buttons += `<button class="btn btn-sm btn-info" onclick="viewTaskDetails(${task.id})">
        <i class="fas fa-eye"></i> 详情
    </button>`;
    
    return buttons;
}

// 获取历史记录操作按钮
function getHistoryActionButtons(item) {
    let buttons = '';
    
    buttons += `<button class="btn btn-sm btn-info me-1" onclick="viewHistoryDetails('${item.id}')">
        <i class="fas fa-eye"></i> 详情
    </button>`;
    
    buttons += `<button class="btn btn-sm btn-danger" onclick="deleteHistory('${item.id}')">
        <i class="fas fa-trash"></i> 删除
    </button>`;
    
    return buttons;
}

// 从剪贴板URL创建任务
function createTaskFromClipboard() {
    fetch('/api/clipboard')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success' && data.content) {
                const urlInput = document.getElementById('url-input');
                if (urlInput) {
                    urlInput.value = data.content;
                    showToast('已从剪贴板获取URL', 'success');
                }
            } else {
                showToast('剪贴板中没有有效的URL', 'warning');
            }
        })
        .catch(error => {
            console.error('获取剪贴板内容失败:', error);
            showToast('获取剪贴板内容失败', 'error');
        });
}

// 获取剪贴板内容
function getClipboardContent() {
    fetch('/api/clipboard')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const clipboardContent = document.getElementById('clipboard-content');
                if (clipboardContent) {
                    clipboardContent.value = data.content || '';
                }
            } else {
                console.error('获取剪贴板内容失败:', data.message);
            }
        })
        .catch(error => {
            console.error('获取剪贴板内容失败:', error);
        });
}

// 查看任务详情
function viewTaskDetails(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // 这里可以打开一个模态框显示任务详情
    alert(`任务详情:\n\nID: ${task.id}\nURL: ${task.url}\n状态: ${task.status}\n创建时间: ${formatDate(task.created_time)}\n${task.completed_time ? `完成时间: ${formatDate(task.completed_time)}\n` : ''}${task.result ? `结果: ${JSON.stringify(task.result)}` : ''}`);
}

// 查看历史记录详情
function viewHistoryDetails(historyId) {
    const item = history.find(h => h.id === historyId);
    if (!item) return;
    
    // 这里可以打开一个模态框显示历史记录详情
    alert(`历史记录详情:\n\nURL: ${item.url}\n时间: ${formatDate(item.timestamp)}\n状态: ${item.status}\n${item.count ? `图片数量: ${item.count}\n` : ''}${item.tags ? `标签: ${item.tags.join(', ')}` : ''}`);
}

// 清空所有历史记录
function clearAllHistory() {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
        return;
    }
    
    showLoading();
    
    fetch('/api/history', {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.status === 'success') {
            showToast('历史记录已清空', 'success');
            loadHistory();
        } else {
            showToast(data.message || '清空历史记录失败', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        console.error('清空历史记录失败:', error);
        showToast('清空历史记录失败', 'error');
    });
}

// 格式化日期
function formatDate(dateString) {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN');
}

// 显示加载动画
function showLoading() {
    if (loadingElement) {
        loadingElement.style.display = 'flex';
    }
}

// 隐藏加载动画
function hideLoading() {
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

// 显示Toast通知
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    
    const toastId = 'toast-' + Date.now();
    const toastClass = type === 'success' ? 'bg-success' : 
                      type === 'error' ? 'bg-danger' : 
                      type === 'warning' ? 'bg-warning' : 'bg-info';
    
    const toastHtml = `
        <div id="${toastId}" class="toast ${toastClass} text-white" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header">
                <strong class="me-auto">${type === 'success' ? '成功' : type === 'error' ? '错误' : type === 'warning' ? '警告' : '信息'}</strong>
                <small>${new Date().toLocaleTimeString()}</small>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();
    
    // 自动移除Toast元素
    toastElement.addEventListener('hidden.bs.toast', function() {
        toastElement.remove();
    });
}