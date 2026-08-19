/**
 * 文件描述：登录、注册和重置密码页面路径归一化与表单交互脚本。
 * 日期：2026-07-05
 * 作者：ike
 */
function canonicalizeLegacyHtmlPath(pathWithQuery) {
  var rawPath = String(pathWithQuery || '');
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return rawPath;

  var hashIndex = rawPath.indexOf('#');
  var withoutHash = hashIndex >= 0 ? rawPath.slice(0, hashIndex) : rawPath;
  var hash = hashIndex >= 0 ? rawPath.slice(hashIndex) : '';
  var queryIndex = withoutHash.indexOf('?');
  var pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  var query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';

  if (/^\/latp\/\d+$/.test(pathname)) {
    return pathname + '.html' + hash;
  }
  if (/^\/(folder|detail|noticle|tags)\/\d+$/.test(pathname)) {
    return pathname + '.html' + query + hash;
  }
  if (pathname === '/noticle' || pathname === '/tags') {
    return pathname + '.html' + query + hash;
  }

  return rawPath;
}

function authPage() {
  return {
    activeTab: 'login',
    registerPassword: '',
    registerEmail: '',
    resetEmail: '',
    passwordStrength: 0,
    passwordStrengthText: '',
    inviteCode: '',
    pendingRegisterTab: false,
    registerConfigLoaded: false,
    registerConfigError: false,

    // 注册配置
    registerConfig: {
      allowRegister: false,
      requireEmailVerify: false,
      allowedEmailDomains: [
        'qq.com', 'foxmail.com', '163.com', '126.com', 'sina.com', 'sina.cn',
        'sohu.com', '139.com', '189.cn', 'wo.cn',
        'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
        'yahoo.com', 'yahoo.co.jp', 'icloud.com', 'me.com', 'mac.com'
      ],
      inviteReward: 0,
    },

    // 邮箱错误提示
    registerEmailError: '',

    // 注册图形验证码状态
    registerCaptcha: {
      image: '/captcha/json',
      input: '',
      verified: false,
    },

    // 重置密码图形验证码状态
    resetCaptcha: {
      image: '/captcha/json',
      input: '',
      verified: false,
    },

    // 冷却时间
    registerCooldown: 0,
    resetCooldown: 0,
    registerCooldownTimer: null,
    resetCooldownTimer: null,

    // 提交状态
    submitting: {
      login: false,
      register: false,
      reset: false,
      sendRegisterCode: false,
      sendResetCode: false,
    },

    get canSendRegisterCode() {
      return this.registerCaptcha.input.length >= 4 &&
             !this.submitting.sendRegisterCode &&
             this.registerCooldown <= 0 &&
             this.registerEmail.length > 0 &&
             !this.registerEmailError &&
             this.canRegister;
    },

    get canRegister() {
      return this.registerConfigLoaded && this.registerConfig.allowRegister;
    },

    get canSendResetCode() {
      return this.resetCaptcha.input.length >= 4 &&
             !this.submitting.sendResetCode &&
             this.resetCooldown <= 0 &&
             this.resetEmail.length > 0;
    },

    validateEmailDomain(email) {
      var normalized = String(email || '').trim().toLowerCase();
      if (!normalized || !normalized.includes('@')) {
        return { valid: false, message: '邮箱格式不正确' };
      }
      var parts = normalized.split('@');
      var localPart = parts[0];
      var domain = parts[1];
      if (!localPart || !domain) {
        return { valid: false, message: '邮箱格式不正确' };
      }

      if (localPart.includes('+')) {
        return { valid: false, message: '注册暂不支持使用邮箱别名（+号）' };
      }

      var dotCount = (localPart.match(/\./g) || []).length;
      if (dotCount > 2) {
        return { valid: false, message: '检测到邮箱格式异常，请使用标准邮箱地址' };
      }

      if (!this.registerConfig.allowedEmailDomains.includes(domain)) {
        return { valid: false, message: '暂不支持该邮箱后缀，请使用 QQ、163、Gmail 等常见邮箱' };
      }
      return { valid: true };
    },

    onRegisterEmailBlur() {
      if (this.registerEmail.trim()) {
        var result = this.validateEmailDomain(this.registerEmail.trim());
        this.registerEmailError = result.valid ? '' : result.message;
      } else {
        this.registerEmailError = '';
      }
    },

    onRegisterEmailInput() {
      if (this.registerEmailError) {
        this.registerEmailError = '';
      }
    },

    async init() {
      var urlParams = new URLSearchParams(window.location.search);
      var invite = urlParams.get('invite');
      if (invite) {
        this.inviteCode = invite.trim().toUpperCase();
        this.pendingRegisterTab = true;
      }
      var tab = urlParams.get('tab');
      if (tab === 'register') {
        this.pendingRegisterTab = true;
      }
      var reason = urlParams.get('reason');
      if (reason === 'conflict') {
        showToast('账号已在其他设备登录，本设备已下线', 'warning');
      }

      await this.loadRegisterConfig();

      if (this.pendingRegisterTab && this.canRegister) {
        this.activeTab = 'register';
      } else if (this.pendingRegisterTab && !this.canRegister) {
        var message = this.registerConfigError
          ? '注册配置加载失败，请稍后重试'
          : '当前暂不开放注册';
        showToast(message, 'warning');
      }

      this.refreshCaptcha('reset');
      if (this.registerConfig.requireEmailVerify && this.canRegister) {
        this.refreshCaptcha('register');
      }
    },

    async loadRegisterConfig() {
      this.registerConfigError = false;
      try {
        var response = await fetch('/web-api/v1/config/register', { credentials: 'include' });
        var data = await response.json();
        if (data.success && data.data) {
          var remoteDomains = Array.isArray(data.data.allowedEmailDomains)
            ? data.data.allowedEmailDomains.filter(function(item) { return typeof item === 'string'; })
            : [];

          this.registerConfig = {
            allowRegister: Boolean(data.data.allowRegister),
            requireEmailVerify: Boolean(data.data.requireEmailVerify),
            allowedEmailDomains: remoteDomains.length > 0
              ? remoteDomains
              : this.registerConfig.allowedEmailDomains,
            inviteReward: Math.max(0, Number(data.data.inviteReward) || 0),
          };
        } else {
          this.registerConfigError = true;
        }
      } catch (_error) {
        this.registerConfigError = true;
      }

      if (this.registerConfigError) {
        this.registerConfig = {
          allowRegister: false,
          requireEmailVerify: false,
          allowedEmailDomains: this.registerConfig.allowedEmailDomains,
          inviteReward: this.registerConfig.inviteReward,
        };
      }

      this.registerConfigLoaded = true;
    },

    switchTab(tab) {
      if (tab === 'register' && !this.canRegister) {
        var message = this.registerConfigError
          ? '注册配置加载失败，请稍后重试'
          : '当前暂不开放注册';
        showToast(message, 'warning');
        return;
      }
      this.activeTab = tab;
      if (tab === 'register' && this.registerConfig.requireEmailVerify && this.canRegister) {
        this.refreshCaptcha('register');
      } else if (tab === 'reset') {
        this.refreshCaptcha('reset');
      }
    },

    async refreshCaptcha(type) {
      try {
        var response = await fetch('/captcha/json?type=number&t=' + Date.now(), { credentials: 'include' });
        var data = await response.json();
        if (data.success) {
          if (type === 'register') {
            this.registerCaptcha.image = data.data.image;
            this.registerCaptcha.input = '';
            this.registerCaptcha.verified = false;
          } else if (type === 'reset') {
            this.resetCaptcha.image = data.data.image;
            this.resetCaptcha.input = '';
            this.resetCaptcha.verified = false;
          }
        }
      } catch (_error) {
        console.error('刷新验证码失败');
      }
    },

    checkPasswordStrength() {
      var pwd = this.registerPassword;
      var strength = 0;

      if (pwd.length >= 8) strength++;
      if (strength >= 1 && /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /[0-9]/.test(pwd)) strength++;
      if (strength >= 2 && pwd.length >= 10 && /[!@#$%^&*(),.?":{}|<>]/.test(pwd)) strength++;

      this.passwordStrength = strength;
      this.passwordStrengthText = ['', '弱 - 需包含大小写字母和数字', '中等 - 符合要求，可添加特殊字符更安全', '强 - 密码安全'][strength];
    },

    getSafeReturnUrl() {
      var raw = new URLSearchParams(window.location.search).get('redirect');
      if (!raw) return null;
      if (raw.startsWith('/') && !raw.startsWith('//')) return canonicalizeLegacyHtmlPath(raw);
      return null;
    },

    startCooldown(type, seconds) {
      var cooldownValue = Math.max(0, Number(seconds) || 0);
      var isCooldownKey = type === 'register' ? 'registerCooldown' : 'resetCooldown';
      var isTimerKey = type === 'register' ? 'registerCooldownTimer' : 'resetCooldownTimer';

      this[isCooldownKey] = cooldownValue;
      if (this[isTimerKey]) {
        clearInterval(this[isTimerKey]);
        this[isTimerKey] = null;
      }
      if (cooldownValue <= 0) return;

      var self = this;
      this[isTimerKey] = setInterval(function() {
        self[isCooldownKey] = Math.max(0, self[isCooldownKey] - 1);
        if (self[isCooldownKey] <= 0 && self[isTimerKey]) {
          clearInterval(self[isTimerKey]);
          self[isTimerKey] = null;
        }
      }, 1000);
    },

    async handleLogin(e) {
      if (this.submitting.login) return;
      this.submitting.login = true;

      var form = e.target;
      var formData = new FormData(form);
      var returnUrl = this.getSafeReturnUrl();

      try {
        var response = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(formData)),
          credentials: 'include'
        });

        var data = await response.json();

        if (data.success) {
          ga4Track('login', { method: 'email' });
          showToast('登录成功！', 'success');
          setTimeout(function() { window.location.href = returnUrl || '/'; }, 500);
        } else {
          showToast(data.message || '登录失败，请重试', 'error');
        }
      } catch (_error) {
        showToast('登录失败，请检查网络连接', 'error');
      } finally {
        this.submitting.login = false;
      }
    },

    async handleRegister(e) {
      if (this.submitting.register) return;
      if (!this.canRegister) {
        var message = this.registerConfigError
          ? '注册配置加载失败，请稍后重试'
          : '当前暂不开放注册';
        showToast(message, 'warning');
        return;
      }

      var emailResult = this.validateEmailDomain(this.registerEmail.trim());
      if (!emailResult.valid) {
        this.registerEmailError = emailResult.message;
        showToast(emailResult.message, 'error');
        return;
      }

      this.submitting.register = true;

      var form = e.target;
      var formData = new FormData(form);
      var returnUrl = this.getSafeReturnUrl();

      try {
        var response = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(formData)),
          credentials: 'include'
        });

        var data = await response.json();

        if (data.success) {
          ga4Track('sign_up', { method: 'email' });
          var rewardMsg = data.data?.inviteReward > 0
            ? '注册成功！邀请码奖励：' + data.data.inviteReward + ' 积分'
            : '注册成功！';
          showToast(rewardMsg, 'success');
          setTimeout(function() { window.location.href = returnUrl || '/'; }, 800);
        } else {
          showToast(data.message || '注册失败，请重试', 'error');
          if (this.registerConfig.requireEmailVerify) {
            this.refreshCaptcha('register');
          }
        }
      } catch (_error) {
        showToast('注册失败，请检查网络连接', 'error');
      } finally {
        this.submitting.register = false;
      }
    },

    async handleReset(e) {
      if (this.submitting.reset) return;
      this.submitting.reset = true;

      var form = e.target;
      var formData = new FormData(form);

      try {
        var response = await fetch('/web-api/v1/user/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(formData)),
          credentials: 'include'
        });

        var data = await response.json();

        if (data.success) {
          showToast('密码重置成功！请登录', 'success');
          this.activeTab = 'login';
        } else {
          showToast(data.message || '密码重置失败，请重试', 'error');
        }
      } catch (_error) {
        showToast('密码重置失败，请检查网络连接', 'error');
      } finally {
        this.submitting.reset = false;
      }
    },

    async sendRegisterEmailCode() {
      if (!this.canSendRegisterCode) return;
      var emailResult = this.validateEmailDomain(this.registerEmail.trim());
      if (!emailResult.valid) {
        this.registerEmailError = emailResult.message;
        showToast(emailResult.message, 'error');
        return;
      }

      this.submitting.sendRegisterCode = true;

      try {
        var response = await fetch('/web-api/v1/user/send-email-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: this.registerEmail.trim(),
            purpose: 'register',
            captcha: this.registerCaptcha.input,
            captchaType: 'number',
          }),
          credentials: 'include'
        });

        var data = await response.json();

        if (data.success) {
          showToast('验证码已发送至您的邮箱！', 'success');
          this.registerCaptcha.verified = true;
          this.startCooldown('register', 60);
        } else {
          showToast(data.message || '发送失败，请重试', 'error');
          this.refreshCaptcha('register');
        }
      } catch (_error) {
        showToast('发送失败，请检查网络连接', 'error');
      } finally {
        this.submitting.sendRegisterCode = false;
      }
    },

    async sendResetEmailCode() {
      if (!this.canSendResetCode) return;
      this.submitting.sendResetCode = true;

      try {
        var response = await fetch('/web-api/v1/user/send-email-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: this.resetEmail,
            purpose: 'reset-password',
            captcha: this.resetCaptcha.input,
            captchaType: 'number',
          }),
          credentials: 'include'
        });

        var data = await response.json();

        if (data.success) {
          showToast('验证码已发送至您的邮箱！', 'success');
          this.resetCaptcha.verified = true;
          this.startCooldown('reset', 60);
        } else {
          showToast(data.message || '发送失败，请重试', 'error');
          this.refreshCaptcha('reset');
        }
      } catch (_error) {
        showToast('发送失败，请检查网络连接', 'error');
      } finally {
        this.submitting.sendResetCode = false;
      }
    },
  }
}
