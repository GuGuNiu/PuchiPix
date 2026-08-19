/**
 * 文件描述：站点深浅色主题切换和持久化脚本。
 * 日期：2026-07-05
 * 作者：ike
 */

(function () {
  'use strict';

  const THEME_KEY = 'coserbox-theme';
  const THEMES = {
    DARK: 'dark',
    LIGHT: 'light',
  };

  /**
   * 应用主题到 HTML 元素
   */
  function applyTheme(theme) {
    const html = document.documentElement;

    // 临时启用过渡动画（仅在主题切换时，避免常态全页重绘）
    if (document.body) {
      document.body.classList.add('theme-transition');
      setTimeout(() => document.body.classList.remove('theme-transition'), 350);
    }

    // 移除所有主题类
    html.classList.remove(THEMES.DARK, THEMES.LIGHT);

    // 添加新主题类
    html.classList.add(theme);

    // 设置 data-theme 属性
    html.setAttribute('data-theme', theme);

    // 保存到 localStorage
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      console.warn('无法保存主题设置:', e);
    }

    // 触发自定义事件（用于 Alpine.js 响应）
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('themeChanged', {
          detail: { theme },
        })
      );
    }, 0);
  }

  /**
   * 获取当前主题
   */
  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || THEMES.DARK;
  }

  /**
   * 切换主题
   */
  function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
    applyTheme(newTheme);
    return newTheme;
  }

  /**
   * 初始化主题系统
   */
  function initTheme() {
    // 从 localStorage 获取保存的主题，如果没有则默认使用深色主题
    let savedTheme;
    try {
      savedTheme = localStorage.getItem(THEME_KEY);
    } catch (e) {
      console.warn('无法读取主题设置:', e);
    }

    const theme = savedTheme || THEMES.DARK;

    // 立即应用主题（在 DOM 加载前）
    applyTheme(theme);
  }

  // 立即初始化主题（在脚本加载时）
  initTheme();

  // 导出全局函数
  window.toggleTheme = toggleTheme;
  window.getCurrentTheme = getCurrentTheme;
  window.isDarkTheme = function () {
    return getCurrentTheme() === THEMES.DARK;
  };
})();
