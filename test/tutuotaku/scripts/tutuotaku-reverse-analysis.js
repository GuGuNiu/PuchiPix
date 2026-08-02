/**
 * tutuotaku.com (兔兔图屋) 逆向工程分析脚本
 * 主题: RiPro-V5 v10.0
 * 分析时间: 2026-08-01
 * 
 * 发现的关键信息:
 * =================
 * 
 * 1. 站点基本信息
 *    - 域名: https://tutuotaku.com
 *    - 主题: RiPro-V5 v10.0 (付费WordPress资源主题)
 *    - 图片CDN: pic.pipicos.xyz
 *    - 统计: 51.la
 * 
 * 2. 全局配置对象 (zb)
 *    - ajax_url: /wp-admin/admin-ajax.php
 *    - ajax_nonce: 444888d6bc (动态)
 *    - current_user_id: 22
 *    - site_popup_login: 1
 * 
 * 3. AJAX Actions (发现15个)
 *    - zb_get_site_notify: 获取站点通知
 *    - zb_get_site_login: 获取登录弹窗
 *    - zb_user_qiandao: 用户签到
 *    - zb_add_post_views: 增加文章浏览量
 *    - zb_add_like_post: 点赞文章
 *    - zb_add_fav_post: 收藏文章
 *    - zb_add_share_post: 分享文章
 *    - zb_ajax_comment: 提交评论
 *    - zb_mpweixin_ajax_login: 微信登录
 *    - zb_mpweixin_ajax_check_login: 检查微信登录状态
 *    - zb_get_captcha_img: 获取验证码图片
 *    - zb_send_mail_captcha_code: 发送邮箱验证码
 *    - zb_get_pay_select_html: 获取支付选项HTML
 *    - zb_get_pay_action: 执行支付
 *    - zb_check_pay_status: 检查支付状态
 * 
 * 4. 会员/积分系统
 *    - 普通用户每日下载限制: 5次
 *    - VIP会员每日下载限制: 10次 (包月/体验) / 99次 (永久)
 *    - 金币充值比例: 1金币 = ¥0.1
 *    - VIP价格:
 *      * 体验会员: 10金币 (1天, 每日10次)
 *      * 包月会员: 300金币 (30天, 每日10次)
 *      * 永久会员: 3000金币 (永久, 每日99次)
 * 
 * 5. 下载机制
 *    - 下载链接: /goto?down={encrypted_token}
 *    - 跳转目标: 百度网盘
 *    - 提取码: 页面内明文显示 (如 "6666")
 *    - 当前测试账户状态: 普通用户, 今日已用2次, 剩余3次
 * 
 * 6. 安全评估
 *    - 使用WordPress nonce验证 (zb.ajax_nonce)
 *    - 下载次数服务器端限制
 *    - 支付流程需要登录状态
 *    - 未发现明显SQL注入漏洞
 *    - 下载token加密存储
 * 
 * 7. 数据提取策略
 *    - 文章列表: 标准WordPress REST API 或 HTML解析
 *    - 图片: 直接从 pic.pipicos.xyz 获取
 *    - 下载链接: 需要登录后访问 /goto?down= 端点
 *    - 提取码: 页面内 data-pwd 属性
 */

const TUTUOTAKU_CONFIG = {
  baseUrl: 'https://tutuotaku.com',
  ajaxUrl: 'https://tutuotaku.com/wp-admin/admin-ajax.php',
  cdnUrl: 'https://pic.pipicos.xyz',
  theme: 'ripro-v5',
  themeVersion: '10.0',
  
  // AJAX Actions
  actions: {
    getNotify: 'zb_get_site_notify',
    getLogin: 'zb_get_site_login',
    qiandao: 'zb_user_qiandao',
    addViews: 'zb_add_post_views',
    addLike: 'zb_add_like_post',
    addFav: 'zb_add_fav_post',
    addShare: 'zb_add_share_post',
    comment: 'zb_ajax_comment',
    wxLogin: 'zb_mpweixin_ajax_login',
    wxCheckLogin: 'zb_mpweixin_ajax_check_login',
    getCaptcha: 'zb_get_captcha_img',
    sendMailCode: 'zb_send_mail_captcha_code',
    getPayHtml: 'zb_get_pay_select_html',
    payAction: 'zb_get_pay_action',
    checkPay: 'zb_check_pay_status'
  },
  
  // 会员限制
  limits: {
    normal: { daily: 5 },
    vip: { daily: 10 },
    permanent: { daily: 99 }
  },
  
  // VIP价格 (金币)
  vipPrices: {
    trial: { coins: 10, days: 1, dailyLimit: 10 },
    monthly: { coins: 300, days: 30, dailyLimit: 10 },
    permanent: { coins: 3000, days: -1, dailyLimit: 99 }
  },
  
  // 充值比例
  rechargeRate: 0.1, // 1金币 = ¥0.1
};

// 测试账户信息
const TEST_ACCOUNT = {
  email: 'TLpA9fLLzy@duckmail.sbs',
  password: '123weaxzcefwe2A',
  userId: '22',
  username: 'AVC2231',
  level: '普通用户',
  dailyLimit: 5,
  usedToday: 2,
  remainingToday: 3,
  coins: 0
};

// 下载链接示例
const DOWNLOAD_EXAMPLE = {
  postId: '2570',
  title: 'yuuhui玉汇 cosplay写真_蒸汽维修工合集',
  gotoUrl: 'https://tutuotaku.com/goto?down=CwMOKZ9L7sn_-E3aJbVR8wDPj7AHKGN9fgOtJdEcIR0MuvAmzRxcUMDYozQu7jS6',
  targetUrl: 'https://pan.baidu.com/s/18hiv32MdUp1i06FXJR5rww?pwd=6666',
  password: '6666',
  isFree: true
};

module.exports = {
  config: TUTUOTAKU_CONFIG,
  testAccount: TEST_ACCOUNT,
  downloadExample: DOWNLOAD_EXAMPLE
};
