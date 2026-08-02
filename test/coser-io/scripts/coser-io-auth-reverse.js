/**
 * Coser.io 已认证逆向脚本
 * 
 * 使用 Playwright 进行已登录会话的 CDP 网络拦截，
 * 调用解锁 API 获取完整图片列表。
 * 
 * 基于前期 JS 源码分析的发现：
 * - 解锁 API: POST /purchase/gallery { id, type: 'gallery_view' }
 * - CSRF: window.__csrfToken 注入到 csrf-token header
 * - 解锁后 location.reload()，服务端重新渲染含全部图片的 HTML
 * - 图片 CDN: coserbox.static.iloli.io
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ===== 配置 =====
const CONFIG = {
  email: 'atlascrfat@outlook.com',
  password: 'YH86JzhrSBd4nP3',
  galleryUrl: 'https://coser.io/latp/69218.html',
  galleryId: 69218,
  loginUrl: 'https://coser.io/login.html',
  outputDir: 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data',
  imagesDir: 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\downloads\\auth-downloaded-images',
  headless: false, // 可视化模式，便于观察
  timeout: 30000,
};

// ===== 网络请求日志 =====
const networkLog = [];
const apiCalls = [];

// ===== 工具函数 =====
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(true);
        });
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        // 跟随重定向
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
      } else {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      reject(err);
    });
  });
}

// ===== 主流程 =====
async function main() {
  console.log('=== Coser.io 已认证逆向脚本启动 ===\n');
  ensureDir(CONFIG.outputDir);
  ensureDir(CONFIG.imagesDir);

  // 1. 启动浏览器
  console.log('[1] 启动 Playwright 浏览器...');
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });

  // 2. 设置网络请求拦截 - 记录所有 API 调用
  const page = await context.newPage();

  // 记录所有请求
  page.on('request', (request) => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();

    const logEntry = {
      timestamp: new Date().toISOString(),
      method,
      url,
      resourceType,
      headers: request.headers(),
      postData: request.postData() || null,
    };

    networkLog.push(logEntry);

    // 只记录 API 调用（非静态资源）
    if (resourceType === 'fetch' || resourceType === 'xhr' || url.includes('/web-api/') || url.includes('/purchase/') || url.includes('/login')) {
      console.log(`  → ${method} ${url}`);
      if (logEntry.postData) {
        console.log(`    Body: ${logEntry.postData}`);
      }
      apiCalls.push(logEntry);
    }
  });

  // 记录所有响应
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const method = response.request().method();

    if (url.includes('/web-api/') || url.includes('/purchase/') || url.includes('/login') || url.includes('/auth')) {
      console.log(`  ← ${status} ${method} ${url}`);

      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const body = await response.json();
          console.log(`    Response: ${JSON.stringify(body).substring(0, 300)}`);

          // 保存重要 API 响应
          const safeName = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80);
          fs.writeFileSync(
            path.join(CONFIG.outputDir, `auth-response-${safeName}.json`),
            JSON.stringify({ url, status, method, body }, null, 2)
          );
        }
      } catch (e) {
        // 响应体可能已被读取
      }
    }
  });

  try {
    // 3. 登录流程
    console.log('\n[2] 导航到登录页面...');
    await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    // 等待登录表单出现
    await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="邮箱"]', { timeout: 15000 });
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    console.log(`  登录页面已加载: ${page.url()}`);

    // 截图登录页
    await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-login-page.png'), fullPage: false });

    // 分析登录表单结构
    console.log('\n[3] 分析登录表单...');
    const formData = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      const forms = document.querySelectorAll('form');
      const buttons = document.querySelectorAll('button');

      return {
        forms: forms.length,
        formActions: [...forms].map(f => f.action),
        formMethods: [...forms].map(f => f.method),
        inputs: [...inputs].map(i => ({
          type: i.type,
          name: i.name,
          id: i.id,
          placeholder: i.placeholder,
          required: i.required,
        })),
        buttons: [...buttons].map(b => ({
          type: b.type,
          text: b.textContent.trim().substring(0, 50),
          class: b.className.substring(0, 80),
        })),
        // 检查页面中的 JS 变量
        csrfToken: window.__csrfToken || null,
        isLoggedIn: window.isLoggedIn || false,
      };
    });
    console.log('  表单数据:', JSON.stringify(formData, null, 2));
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-login-form-analysis.json'),
      JSON.stringify(formData, null, 2)
    );

    // 填写登录表单
    console.log('\n[4] 填写登录凭据...');

    // 尝试多种选择器来找到输入框
    const emailSelector = 'input[type="email"], input[name="email"], input[placeholder*="邮箱"], input[placeholder*="邮"], input[name="account"], #email';
    const passwordSelector = 'input[type="password"], input[name="password"], #password';

    await page.waitForSelector(emailSelector, { timeout: 10000 });
    await page.waitForSelector(passwordSelector, { timeout: 10000 });

    await page.fill(emailSelector, CONFIG.email);
    await page.fill(passwordSelector, CONFIG.password);
    console.log(`  邮箱已填写: ${CONFIG.email}`);
    console.log('  密码已填写: ***');

    // 截图填写后
    await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-login-filled.png'), fullPage: false });

    // 提交登录 - 直接调用正确的登录 API
    console.log('\n[5] 提交登录...');

    // 登录 API 端点从表单分析中得知: /web-api/v1/user/login
    const loginResult = await page.evaluate(async (credentials) => {
      try {
        const csrfToken = window.__csrfToken || '';
        
        const response = await fetch('/web-api/v1/user/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'csrf-token': csrfToken,
          },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
          credentials: 'include',
        });
        
        const data = await response.json();
        return {
          status: response.status,
          ok: response.ok,
          data: data,
        };
      } catch (error) {
        return { error: error.message };
      }
    }, { email: CONFIG.email, password: CONFIG.password });

    console.log(`  登录 API 响应: ${JSON.stringify(loginResult).substring(0, 300)}`);
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-login-response.json'),
      JSON.stringify(loginResult, null, 2)
    );

    if (loginResult.data && loginResult.data.success) {
      console.log('  ✅ 登录成功！');
      // 等待一下让 Cookie 设置好
      await page.waitForTimeout(1000);
      // 导航到首页确认登录状态
      await page.goto('https://coser.io/', { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    } else {
      console.log(`  ❌ 登录失败: ${loginResult.data ? loginResult.data.message : '未知错误'}`);
      console.log('  尝试继续操作...');
    }

    // 检查登录状态
    console.log('\n[6] 检查登录状态...');
    const loginStatus = await page.evaluate(() => {
      return {
        url: window.location.href,
        isLoggedIn: window.isLoggedIn || false,
        csrfToken: window.__csrfToken || null,
        // 检查页面上是否有用户头像/用户名等登录标志
        hasUserMenu: !!document.querySelector('[class*="user-avatar"], [class*="avatar"], .user-info, #userMenu'),
        hasLoginLink: !!document.querySelector('a[href*="login"]'),
        bodyText: document.body.innerText.substring(0, 500),
      };
    });
    console.log(`  当前URL: ${loginStatus.url}`);
    console.log(`  已登录: ${loginStatus.isLoggedIn}`);
    console.log(`  CSRF Token: ${loginStatus.csrfToken ? loginStatus.csrfToken.substring(0, 20) + '...' : '未找到'}`);
    console.log(`  用户菜单: ${loginStatus.hasUserMenu}`);
    console.log(`  登录链接: ${loginStatus.hasLoginLink}`);

    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-login-status.json'),
      JSON.stringify(loginStatus, null, 2)
    );

    // 截图登录后
    await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-after-login.png'), fullPage: false });

    if (!loginStatus.isLoggedIn && loginStatus.hasLoginLink) {
      console.log('\n  ⚠️ 登录可能失败，检查响应...');
      // 即使 window.isLoggedIn 未设置，也可能已经登录（Cookie 方式）
      // 继续尝试访问需要登录的页面
    }

    // 获取 cookies
    const cookies = await context.cookies();
    console.log(`\n  Cookies: ${cookies.length}个`);
    const importantCookies = cookies.filter(c =>
      c.name.includes('session') || c.name.includes('token') || c.name.includes('auth') || c.name.includes('user') || !c.name.startsWith('_')
    );
    importantCookies.forEach(c => {
      console.log(`    ${c.name}=${c.value.substring(0, 30)}... (domain: ${c.domain}, httpOnly: ${c.httpOnly})`);
    });
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-cookies.json'),
      JSON.stringify(cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure })), null, 2)
    );

    // 4. 访问图集页面
    console.log('\n[7] 导航到图集页面...');
    await page.goto(CONFIG.galleryUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    // 等待页面配置对象加载
    await page.waitForFunction(() => window.__latpConfig !== undefined, { timeout: 15000 });
    console.log(`  图集页面已加载: ${page.url()}`);

    // 截图图集页（登录后）
    await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-gallery-before-unlock.png'), fullPage: false });

    // 提取页面配置
    const pageConfig = await page.evaluate(() => {
      const cfg = window.__latpConfig || {};
      return {
        galleryId: cfg.galleryId,
        isPurchase: cfg.isPurchase,
        isBuyVideo: cfg.isBuyVideo,
        isPurchaseDownload: cfg.isPurchaseDownload,
        isFavorite: cfg.isFavorite,
        autoUnlocked: cfg.autoUnlocked,
        canUseVipForGallery: cfg.canUseVipForGallery,
        previewCount: cfg.previewCount,
        userPoints: cfg.userPoints,
        viewPrice: cfg.viewPrice,
        videoPrice: cfg.videoPrice,
        downloadPrice: cfg.downloadPrice,
        folderId: cfg.folderId,
        imageCount: cfg.imageCount,
        cdnDomain: cfg.cdnDomain,
        csrfToken: window.__csrfToken || null,
        isLoggedIn: window.isLoggedIn || false,
        enablePointsGuide: window.__enablePointsGuide || false,
      };
    });
    console.log('\n[8] 图集页面配置:');
    console.log(JSON.stringify(pageConfig, null, 2));
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-gallery-config.json'),
      JSON.stringify(pageConfig, null, 2)
    );

    // 提取当前可见的图片
    const beforeImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[data-fancybox="gallery"], img[src*="coserbox"], img[src*="gallery/"]');
      return [...imgs].map(img => ({
        src: img.src,
        alt: img.alt,
        dataSrc: img.dataset.src || null,
      }));
    });
    console.log(`\n  解锁前可见图片数: ${beforeImages.length}`);
    beforeImages.forEach((img, i) => {
      console.log(`    [${i + 1}] ${img.src.substring(0, 100)}...`);
    });
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-images-before-unlock.json'),
      JSON.stringify(beforeImages, null, 2)
    );

    // 5. 调用解锁 API
    if (!pageConfig.isPurchase) {
      console.log('\n[9] 图集未解锁，调用解锁 API...');
      console.log(`  用户积分: ${pageConfig.userPoints}`);
      console.log(`  解锁价格: ${pageConfig.viewPrice} 积分`);

      if (pageConfig.userPoints < pageConfig.viewPrice) {
        console.log(`  ⚠️ 积分不足！需要 ${pageConfig.viewPrice}，当前 ${pageConfig.userPoints}`);
      }

      // 通过页面上下文调用解锁 API（自动携带 Cookie + CSRF）
      const unlockResult = await page.evaluate(async (galleryId) => {
        try {
          const response = await fetch('/purchase/gallery', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'csrf-token': window.__csrfToken || '',
            },
            body: JSON.stringify({
              id: parseInt(galleryId),
              type: 'gallery_view',
            }),
          });
          const result = await response.json();
          return {
            status: response.status,
            ok: response.ok,
            result: result,
          };
        } catch (error) {
          return { error: error.message };
        }
      }, CONFIG.galleryId);

      console.log('\n  解锁 API 响应:');
      console.log(JSON.stringify(unlockResult, null, 2));
      fs.writeFileSync(
        path.join(CONFIG.outputDir, 'auth-unlock-response.json'),
        JSON.stringify(unlockResult, null, 2)
      );

      if (unlockResult.result && unlockResult.result.success) {
        console.log('\n  ✅ 解锁成功！等待页面刷新...');

        // 解锁成功后，页面会 location.reload()
        // 我们直接重新导航到图集页面
        await page.waitForTimeout(1500); // 等待服务端处理
        await page.goto(CONFIG.galleryUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
        await page.waitForFunction(() => window.__latpConfig !== undefined, { timeout: 15000 });
        console.log('  页面已刷新');
      } else {
        console.log('\n  ❌ 解锁失败，尝试其他方式...');

        // 尝试直接在页面上点击解锁按钮
        console.log('  尝试点击页面上的解锁按钮...');
        try {
          const unlockBtn = await page.$('button:has-text("解锁"), button:has-text("立即解锁"), [x-show*="!isPurchased"] button, .latp-gallery-lock-panel button, a:has-text("解锁")');
          if (unlockBtn) {
            await unlockBtn.click();
            console.log('  点击了解锁按钮');
            await page.waitForTimeout(3000);

            // 检查是否有确认弹窗
            const confirmBtn = await page.$('button:has-text("立即解锁"), button:has-text("确认"), button:has-text("确定")');
            if (confirmBtn) {
              await confirmBtn.click();
              console.log('  确认了解锁操作');
              await page.waitForTimeout(3000);
              await page.goto(CONFIG.galleryUrl, { waitUntil: 'networkidle', timeout: CONFIG.timeout });
            }
          }
        } catch (e) {
          console.log(`  点击解锁按钮失败: ${e.message}`);
        }
      }
    } else {
      console.log('\n[9] 图集已解锁，直接提取图片');
    }

    // 6. 提取解锁后的完整图片列表
    console.log('\n[10] 提取完整图片列表...');

    // 截图解锁后
    await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-gallery-after-unlock.png'), fullPage: false });

    // 重新提取页面配置
    const afterConfig = await page.evaluate(() => {
      const cfg = window.__latpConfig || {};
      return {
        isPurchase: cfg.isPurchase,
        userPoints: cfg.userPoints,
        imageCount: cfg.imageCount,
        csrfToken: window.__csrfToken || null,
      };
    });
    console.log('  解锁后配置:', JSON.stringify(afterConfig, null, 2));

    // 提取所有图片 URL
    const allImages = await page.evaluate(() => {
      // 方法1: 查找所有带 data-fancybox 的图片
      const fancyboxImgs = document.querySelectorAll('img[data-fancybox="gallery"]');
      // 方法2: 查找所有 CDN 图片
      const cdnImgs = document.querySelectorAll('img[src*="coserbox"], img[src*="iloli"]');
      // 方法3: 查找所有 gallery 路径图片
      const galleryImgs = document.querySelectorAll('img[src*="gallery/"]');
      // 方法4: 查找 data-src 属性
      const lazyImgs = document.querySelectorAll('img[data-src]');
      // 方法5: 查找 Fancybox 数据源
      const fancyboxAnchors = document.querySelectorAll('a[data-fancybox="gallery"]');
      // 方法6: 查找所有图片元素
      const allImgs = document.querySelectorAll('img');

      // 从 HTML 中提取所有图片 URL（包括在 script 标签中的）
      const html = document.documentElement.outerHTML;
      const urlPattern = /https?:\/\/[^"'\s]+coserbox[^"'\s]+\.webp[^"'\s]*/g;
      const htmlUrls = html.match(urlPattern) || [];

      // 从内联脚本中查找
      const scriptUrls = [];
      document.querySelectorAll('script').forEach(script => {
        const matches = script.textContent.match(/https?:\/\/[^"'\s]+coserbox[^"'\s]+\.webp[^"'\s]*/g);
        if (matches) scriptUrls.push(...matches);
      });

      // 从 data-href 或 data-src 属性中查找
      const dataHrefImgs = document.querySelectorAll('[data-href*="gallery/"], [data-src*="gallery/"], [data-full*="gallery/"]');

      return {
        fancyboxCount: fancyboxImgs.length,
        cdnCount: cdnImgs.length,
        galleryCount: galleryImgs.length,
        lazyCount: lazyImgs.length,
        fancyboxAnchorCount: fancyboxAnchors.length,
        allImgCount: allImgs.length,
        dataHrefCount: dataHrefImgs.length,
        htmlUrls: [...new Set(htmlUrls)],
        scriptUrls: [...new Set(scriptUrls)],
        fancyboxImages: [...fancyboxImgs].map(img => ({
          src: img.src,
          dataSrc: img.dataset.src || null,
          dataHref: img.dataset.href || null,
          alt: img.alt,
        })),
        fancyboxAnchors: [...fancyboxAnchors].map(a => ({
          href: a.href,
          dataHref: a.dataset.href || null,
          dataSrc: a.dataset.src || null,
        })),
        allImageSrcs: [...allImgs].map(img => img.src).filter(src => src.includes('coserbox') || src.includes('gallery/')),
      };
    });

    console.log(`\n  图片提取结果:`);
    console.log(`    Fancybox 图片: ${allImages.fancyboxCount}`);
    console.log(`    CDN 图片: ${allImages.cdnCount}`);
    console.log(`    Gallery 图片: ${allImages.galleryCount}`);
    console.log(`    懒加载图片: ${allImages.lazyCount}`);
    console.log(`    Fancybox 锚点: ${allImages.fancyboxAnchorCount}`);
    console.log(`    所有 img 标签: ${allImages.allImgCount}`);
    console.log(`    HTML 中的 URL: ${allImages.htmlUrls.length}`);
    console.log(`    Script 中的 URL: ${allImages.scriptUrls.length}`);

    // 合并所有唯一图片 URL
    const allImageUrls = new Set();
    allImages.htmlUrls.forEach(u => allImageUrls.add(u));
    allImages.scriptUrls.forEach(u => allImageUrls.add(u));
    allImages.fancyboxImages.forEach(img => {
      if (img.src) allImageUrls.add(img.src);
      if (img.dataSrc) allImageUrls.add(img.dataSrc);
      if (img.dataHref) allImageUrls.add(img.dataHref);
    });
    allImages.fancyboxAnchors.forEach(a => {
      if (a.href) allImageUrls.add(a.href);
      if (a.dataHref) allImageUrls.add(a.dataHref);
      if (a.dataSrc) allImageUrls.add(a.dataSrc);
    });
    allImages.allImageSrcs.forEach(src => allImageUrls.add(src));

    const uniqueUrls = [...allImageUrls].filter(url => url.includes('.webp'));
    console.log(`\n  唯一图片 URL 总数: ${uniqueUrls.length}`);

    if (uniqueUrls.length > 0) {
      console.log('\n  图片 URL 列表:');
      uniqueUrls.forEach((url, i) => {
        console.log(`    [${i + 1}] ${url.substring(0, 120)}...`);
      });
    }

    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-all-images-extracted.json'),
      JSON.stringify({
        summary: {
          fancyboxCount: allImages.fancyboxCount,
          cdnCount: allImages.cdnCount,
          galleryCount: allImages.galleryCount,
          htmlUrlCount: allImages.htmlUrls.length,
          scriptUrlCount: allImages.scriptUrls.length,
          uniqueUrlCount: uniqueUrls.length,
        },
        uniqueUrls,
        fancyboxImages: allImages.fancyboxImages,
        fancyboxAnchors: allImages.fancyboxAnchors,
        htmlUrls: allImages.htmlUrls,
        scriptUrls: allImages.scriptUrls,
      }, null, 2)
    );

    // 7. 如果图片数量不够，尝试从页面 HTML 源码中提取
    if (uniqueUrls.length < 85) {
      console.log(`\n[11] 图片数量不足 (${uniqueUrls.length}/85)，从 HTML 源码深度提取...`);

      // 获取完整页面源码
      const htmlContent = await page.content();
      fs.writeFileSync(path.join(CONFIG.outputDir, 'auth-gallery-after-unlock.html'), htmlContent);

      // 用正则提取所有图片 URL 模式
      const patterns = [
        /https?:\/\/[^"'\s)]+coserbox[^"'\s)]+\.webp[^"'\s)]*/g,
        /https?:\/\/[^"'\s)]+iloli\.io[^"'\s)]+\.webp[^"'\s)]*/g,
        /\/gallery\/[^"'\s)]+\.webp[^"'\s)]*/g,
        /[a-f0-9]{12}\.webp/g,
      ];

      const allMatches = new Set();
      patterns.forEach(pattern => {
        const matches = htmlContent.match(pattern);
        if (matches) {
          matches.forEach(m => allMatches.add(m));
        }
      });

      console.log(`  HTML 源码中发现 ${allMatches.size} 个图片 URL 模式`);

      // 如果找到了更多 URL，补全到 uniqueUrls
      const cdnDomain = pageConfig.cdnDomain || 'https://coserbox.static.iloli.io';
      allMatches.forEach(match => {
        if (match.startsWith('http')) {
          if (match.includes('.webp')) allImageUrls.add(match);
        } else if (match.startsWith('/gallery/')) {
          allImageUrls.add(cdnDomain + match);
        }
      });

      const updatedUrls = [...allImageUrls].filter(url => url.includes('.webp'));
      console.log(`  补全后唯一图片 URL 数: ${updatedUrls.length}`);

      if (updatedUrls.length > uniqueUrls.length) {
        uniqueUrls.length = 0;
        uniqueUrls.push(...updatedUrls);
      }
    }

    // 8. 下载所有图片
    console.log(`\n[12] 下载 ${uniqueUrls.length} 张图片...`);

    const downloadResults = [];
    for (let i = 0; i < uniqueUrls.length; i++) {
      const url = uniqueUrls[i];
      const filename = url.split('/').pop().split('?')[0] || `image_${i + 1}.webp`;
      const filepath = path.join(CONFIG.imagesDir, `${String(i + 1).padStart(3, '0')}_${filename}`);

      try {
        await downloadImage(url, filepath);
        const stats = fs.statSync(filepath);
        downloadResults.push({
          index: i + 1,
          url: url.substring(0, 150),
          filename,
          size: stats.size,
          status: 'success',
        });
        console.log(`  [${i + 1}/${uniqueUrls.length}] ✅ ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
      } catch (error) {
        downloadResults.push({
          index: i + 1,
          url: url.substring(0, 150),
          filename,
          error: error.message,
          status: 'failed',
        });
        console.log(`  [${i + 1}/${uniqueUrls.length}] ❌ ${filename} - ${error.message}`);
      }

      // 间隔 200ms 避免频率限制
      await new Promise(r => setTimeout(r, 200));
    }

    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-download-results.json'),
      JSON.stringify(downloadResults, null, 2)
    );

    const successCount = downloadResults.filter(r => r.status === 'success').length;
    const failCount = downloadResults.filter(r => r.status === 'failed').length;
    console.log(`\n  下载完成: ✅ ${successCount} 成功, ❌ ${failCount} 失败`);

    // 9. 保存完整网络日志
    console.log('\n[13] 保存网络请求日志...');
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-network-log.json'),
      JSON.stringify(networkLog, null, 2)
    );
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-api-calls.json'),
      JSON.stringify(apiCalls, null, 2)
    );
    console.log(`  总请求: ${networkLog.length}, API 调用: ${apiCalls.length}`);

    // 10. 生成最终报告
    console.log('\n[14] 生成最终报告...');
    const report = {
      testTime: new Date().toISOString(),
      target: CONFIG.galleryUrl,
      galleryId: CONFIG.galleryId,
      account: CONFIG.email,

      loginStatus: {
        isLoggedIn: loginStatus.isLoggedIn,
        currentUrl: loginStatus.url,
        cookieCount: cookies.length,
      },

      galleryConfig: {
        beforeUnlock: pageConfig,
        afterUnlock: afterConfig,
      },

      imageExtraction: {
        targetCount: pageConfig.imageCount || 85,
        extractedCount: uniqueUrls.length,
        fancyboxCount: allImages.fancyboxCount,
        cdnCount: allImages.cdnCount,
        htmlUrlCount: allImages.htmlUrls.length,
        scriptUrlCount: allImages.scriptUrls.length,
      },

      downloadResult: {
        total: uniqueUrls.length,
        success: successCount,
        failed: failCount,
      },

      apiDiscovery: {
        unlockEndpoint: '/purchase/gallery',
        unlockMethod: 'POST',
        unlockBody: { id: CONFIG.galleryId, type: 'gallery_view' },
        pointsEndpoint: '/web-api/v1/user/points',
        galleriesEndpoint: '/web-api/v1/galleries',
        csrfRequired: true,
        csrfHeaderName: 'csrf-token',
        afterUnlockBehavior: 'location.reload()',
      },

      conclusion: uniqueUrls.length >= 85
        ? '✅ 成功获取全部图片'
        : uniqueUrls.length > 2
        ? `⚠️ 部分成功：获取 ${uniqueUrls.length}/${pageConfig.imageCount || 85} 张图片`
        : '❌ 未能获取图片',
    };

    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-final-report.json'),
      JSON.stringify(report, null, 2)
    );

    console.log('\n=== 最终报告 ===');
    console.log(JSON.stringify(report, null, 2));

  } catch (error) {
    console.error('\n❌ 脚本执行错误:', error.message);
    console.error(error.stack);

    // 错误时截图
    try {
      await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-error-screenshot.png'), fullPage: false });
    } catch (e) {}

    // 保存错误日志
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-error-log.json'),
      JSON.stringify({ error: error.message, stack: error.stack, timestamp: new Date().toISOString() }, null, 2)
    );
  } finally {
    // 保存浏览器状态
    try {
      const storageState = await context.storageState();
      fs.writeFileSync(
        path.join(CONFIG.outputDir, 'auth-storage-state.json'),
        JSON.stringify(storageState, null, 2)
      );
      console.log('\n浏览器状态已保存');
    } catch (e) {}

    await browser.close();
    console.log('\n浏览器已关闭');
    console.log('=== 脚本执行完毕 ===');
  }
}

main().catch(console.error);
