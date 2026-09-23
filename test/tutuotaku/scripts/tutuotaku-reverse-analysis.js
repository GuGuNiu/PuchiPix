/**
 * tutuotaku.com reverse-engineering analysis script.
 * Theme: RiPro-V5 v10.0
 * Analyzed: 2026-08-01
 *
 * Key findings:
 * =================
 *
 * 1. Site basics
 *    - Domain: https://tutuotaku.com
 *    - Theme: RiPro-V5 v10.0 (paid WordPress resource theme)
 *    - Image CDN: pic.pipicos.xyz
 *    - Analytics: 51.la
 *
 * 2. Global config object (zb)
 *    - ajax_url: /wp-admin/admin-ajax.php
 *    - ajax_nonce: 444888d6bc (dynamic)
 *    - current_user_id: 22
 *    - site_popup_login: 1
 *
 * 3. AJAX Actions (15 found)
 *    - zb_get_site_notify: fetch site notifications
 *    - zb_get_site_login: fetch login modal
 *    - zb_user_qiandao: user check-in
 *    - zb_add_post_views: increment post views
 *    - zb_add_like_post: like a post
 *    - zb_add_fav_post: favorite a post
 *    - zb_add_share_post: share a post
 *    - zb_ajax_comment: submit comment
 *    - zb_mpweixin_ajax_login: WeChat login
 *    - zb_mpweixin_ajax_check_login: check WeChat login state
 *    - zb_get_captcha_img: fetch captcha image
 *    - zb_send_mail_captcha_code: send email captcha code
 *    - zb_get_pay_select_html: fetch payment option HTML
 *    - zb_get_pay_action: execute payment
 *    - zb_check_pay_status: check payment status
 *
 * 4. Membership/points system
 *    - Normal user daily download limit: 5
 *    - VIP daily download limit: 10 (monthly/trial) / 99 (lifetime)
 *    - Coin recharge rate: 1 coin = ¥0.1
 *    - VIP prices:
 *      * Trial: 10 coins (1 day, 10/day)
 *      * Monthly: 300 coins (30 days, 10/day)
 *      * Lifetime: 3000 coins (forever, 99/day)
 *
 * 5. Download mechanism
 *    - Download link: /goto?down={encrypted_token}
 *    - Redirect target: Baidu pan
 *    - Extraction code: shown in plaintext on the page (e.g. "6666")
 *    - Test account state: normal user, 2 used today, 3 remaining
 *
 * 6. Security assessment
 *    - WordPress nonce validation (zb.ajax_nonce)
 *    - Download count enforced server-side
 *    - Payment flow requires login
 *    - No obvious SQL injection found
 *    - Download tokens stored encrypted
 *
 * 7. Data extraction strategy
 *    - Post list: standard WordPress REST API or HTML parsing
 *    - Images: fetch directly from pic.pipicos.xyz
 *    - Download links: visit /goto?down= after login
 *    - Extraction code: data-pwd attribute on the page
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
  
  // Membership limits
  limits: {
    normal: { daily: 5 },
    vip: { daily: 10 },
    permanent: { daily: 99 }
  },
  
  // VIP prices (coins)
  vipPrices: {
    trial: { coins: 10, days: 1, dailyLimit: 10 },
    monthly: { coins: 300, days: 30, dailyLimit: 10 },
    permanent: { coins: 3000, days: -1, dailyLimit: 99 }
  },
  
  // Recharge rate
  rechargeRate: 0.1, // 1 coin = ¥0.1
};

// Test account info
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

// Download link example
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
