/**
 * 标题清洗工具函数
 *
 * 提供通用的标题清洗功能，供各站点 Provider 共享使用。
 */

/**
 * 发布组/财团前缀模式
 *
 * 匹配标题开头的"中文+冒号"前缀，常见于发布组标记：
 * - "森萝财团：奈莉酱帆风 Belle Ta 48P" → "奈莉酱帆风 Belle Ta 48P"
 * - "秀人网：xxx" → "xxx"
 *
 * 规则：
 * - 3-8 个中文字符（避免误伤2字正常标题如"爱妃：古装写真"）
 * - 后跟中文或英文冒号
 * - 冒号后可跟可选空格
 */
const PUBLISHER_PREFIX_PATTERN = /^[\u4e00-\u9fff]{3,8}[：:]\s*/;

/**
 * 去除标题开头的发布组/财团前缀
 *
 * 常见格式：
 * - "森萝财团：奈莉酱帆风 Belle Ta 48P" → "奈莉酱帆风 Belle Ta 48P"
 * - "秀人网：xxx" → "xxx"
 * - "爱蜜社：xxx" → "xxx"
 *
 * @param title - 原始标题
 * @returns 清洗后的标题
 *
 * @example
 * removePublisherPrefix('森萝财团：奈莉酱帆风 Belle Ta 48P')
 * // 返回: '奈莉酱帆风 Belle Ta 48P'
 *
 * @example
 * removePublisherPrefix('奈莉酱帆风 Belle Ta 48P')
 * // 返回: '奈莉酱帆风 Belle Ta 48P' (无变化)
 */
export function removePublisherPrefix(title: string): string {
  if (!title) return '';
  return title.replace(PUBLISHER_PREFIX_PATTERN, '').trim();
}

/**
 * 通用标题清洗函数
 *
 * 整合多种清洗规则，按顺序执行：
 * - 去除首尾空白
 * - 去除 [xxx] 分类前缀
 * - 去除发布组/财团前缀（中文+冒号）
 *
 * @param title - 原始标题
 * @returns 清洗后的标题
 */
export function cleanTitleBase(title: string): string {
  if (!title) return '';
  let result = title.trim();
  // 去除 [xxx] 前缀
  result = result.replace(/^\[[^\]]*\]\s*/, '');
  // 去除发布组前缀
  result = removePublisherPrefix(result);
  return result.trim();
}
