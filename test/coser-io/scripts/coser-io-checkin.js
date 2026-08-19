/**
 * Coser.io 签到 + 解锁完整流程
 * 1. 登录
 * 2. 导航到首页获取新 CSRF token
 * 3. 尝试签到获取积分
 * 4. 解锁图集
 * 5. 提取全部图片
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
  email: 'atlascrfat@outlook.com',
  password: 'YH86JzhrSBd4nP3',
  galleryUrl: 'https://coser.io/latp/69218.html',
  galleryId: 69218,
  outputDir: 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data',
  imagesDir: 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\downloads\\auth-downloaded-images',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://coser.io/',
      }
    }, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
      } else {
        file.close();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    });
    req.on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      reject(err);
    });
  });
}

async function main() {
  console.log('=== Coser.io 签到+解锁完整流程 ===\n');
  ensureDir(CONFIG.outputDir);
  ensureDir(CONFIG.imagesDir);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });

  const page = await ctx.newPage();

  const apiLog = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/web-api/') || url.includes('/purchase/') || url.includes('/checkin') || url.includes('/sign')) {
      console.log(`  → ${req.method()} ${url}`);
      if (req.postData()) console.log(`    Body: ${req.postData()}`);
      apiLog.push({ method: req.method(), url, postData: req.postData(), timestamp: new Date().toISOString() });
    }
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/web-api/') || url.includes('/purchase/') || url.includes('/checkin') || url.includes('/sign')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await res.json();
          console.log(`  ← ${res.status()} ${url}`);
          console.log(`    Response: ${JSON.stringify(body).substring(0, 300)}`);
        }
      } catch (e) {}
    }
  });

  try {
    // === Step 1: 登录 ===
    console.log('[1] 登录...');
    await page.goto('https://coser.io/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });

    const loginResult = await page.evaluate(async (creds) => {
      const res = await fetch('/web-api/v1/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'csrf-token': window.__csrfToken || '' },
        body: JSON.stringify(creds),
        credentials: 'include',
      });
      return res.json();
    }, { email: CONFIG.email, password: CONFIG.password });

    console.log(`  登录: ${loginResult.success ? '✅ 成功' : '❌ 失败'} - ${loginResult.message}`);
    if (!loginResult.success) throw new Error('登录失败');

    // === Step 2: 导航到首页，获取新 CSRF ===
    console.log('\n[2] 导航到首页获取新 CSRF token...');
    await page.goto('https://coser.io/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const homeCsrf = await page.evaluate(() => ({
      csrf: window.__csrfToken || null,
      isLoggedIn: window.isLoggedIn || false,
    }));
    console.log(`  CSRF: ${homeCsrf.csrf ? homeCsrf.csrf.substring(0, 20) + '...' : '未找到'}`);
    console.log(`  已登录: ${homeCsrf.isLoggedIn}`);

    // === Step 3: 检查积分 ===
    console.log('\n[3] 检查当前积分...');
    const pointsResult = await page.evaluate(async () => {
      const res = await fetch('/web-api/v1/user/points', { credentials: 'include' });
      return res.json();
    });
    console.log(`  当前积分: ${pointsResult.data?.points || 0}`);

    // === Step 4: 尝试签到 ===
    console.log('\n[4] 尝试签到获取积分...');

    // 先尝试从会员页面签到
    await page.goto('https://coser.io/member.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const memberCsrf = await page.evaluate(() => window.__csrfToken || '');
    console.log(`  会员页面 CSRF: ${memberCsrf.substring(0, 20)}...`);

    // 尝试各种签到端点
    const checkinEndpoints = [
      { url: '/web-api/v1/user/checkin', method: 'POST' },
      { url: '/web-api/v1/checkin', method: 'POST' },
      { url: '/web-api/v1/user/sign', method: 'POST' },
      { url: '/web-api/v1/user/sign-in', method: 'POST' },
      { url: '/web-api/v1/user/daily-checkin', method: 'POST' },
      { url: '/web-api/v1/user/daily', method: 'POST' },
    ];

    let checkinSuccess = false;
    for (const ep of checkinEndpoints) {
      const result = await page.evaluate(async ({ url, csrf }) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'csrf-token': csrf,
            },
            body: JSON.stringify({}),
            credentials: 'include',
          });
          const data = await res.json();
          return { url, status: res.status, data };
        } catch (e) {
          return { url, error: e.message };
        }
      }, { url: ep.url, csrf: memberCsrf });

      if (result.status !== 404) {
        console.log(`  ${ep.method} ${ep.url} -> ${result.status}: ${JSON.stringify(result.data).substring(0, 200)}`);

        if (result.data?.success) {
          console.log(`  ✅ 签到成功！`);
          checkinSuccess = true;
          break;
        } else if (result.data?.code === 'ALREADY_CHECKED_IN' || result.data?.message?.includes('已签到')) {
          console.log(`  今日已签到`);
          checkinSuccess = true;
          break;
        }
      }
    }

    // 也尝试 GET 请求
    if (!checkinSuccess) {
      console.log('\n  尝试 GET 方式签到...');
      for (const ep of checkinEndpoints) {
        const result = await page.evaluate(async (url) => {
          try {
            const res = await fetch(url, { method: 'GET', credentials: 'include' });
            if (res.status === 404) return null;
            const data = await res.json();
            return { url, status: res.status, data };
          } catch (e) {
            return null;
          }
        }, ep.url);

        if (result) {
          console.log(`  GET ${ep.url} -> ${result.status}: ${JSON.stringify(result.data).substring(0, 200)}`);
          if (result.data?.success) {
            checkinSuccess = true;
            break;
          }
        }
      }
    }

    // === Step 5: 再次检查积分 ===
    console.log('\n[5] 签到后检查积分...');
    const pointsAfter = await page.evaluate(async () => {
      const res = await fetch('/web-api/v1/user/points', { credentials: 'include' });
      return res.json();
    });
    const currentPoints = pointsAfter.data?.points || 0;
    console.log(`  当前积分: ${currentPoints}`);

    // === Step 6: 尝试在会员页面找签到按钮 ===
    if (!checkinSuccess && currentPoints === 0) {
      console.log('\n[6] 在会员页面寻找签到按钮...');

      // 截图会员页面
      await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-member-page.png'), fullPage: true });

      // 查找签到按钮
      const buttons = await page.evaluate(() => {
        const btns = document.querySelectorAll('button, a');
        return [...btns].filter(b => {
          const text = b.textContent.trim();
          return text.includes('签到') || text.includes('打卡') || text.includes('check') ||
                 text.includes('领取') || text.includes('每日') || text.includes('签到');
        }).map(b => ({
          tag: b.tagName,
          text: b.textContent.trim().substring(0, 50),
          href: b.href || null,
          class: b.className.substring(0, 80),
          onclick: b.onclick ? 'has onclick' : null,
        }));
      });
      console.log('  签到按钮:', JSON.stringify(buttons, null, 2));

      // 尝试点击签到按钮
      if (buttons.length > 0) {
        try {
          await page.click(`text=签到`, { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(2000);
          console.log('  点击了签到按钮');
        } catch (e) {}
      }

      // 下载会员页面的所有 JS 文件
      console.log('\n  下载会员页面 JS 文件...');
      const memberJsFiles = await page.evaluate(() => {
        return [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.includes('/js/'));
      });

      for (const jsUrl of memberJsFiles) {
        const filename = jsUrl.split('/').pop().split('?')[0];
        if (filename.startsWith('member') || filename.startsWith('user') || filename.startsWith('account')) {
          const content = await page.evaluate(async (url) => {
            const res = await fetch(url);
            return await res.text();
          }, jsUrl);
          fs.writeFileSync(path.join(CONFIG.outputDir, `auth-js-${filename}`), content);
          console.log(`    下载: ${filename} (${content.length} bytes)`);

          // 搜索 API 端点
          const apiMatches = content.match(/fetch\(['"`]([^'"`]+)['"`]/g);
          if (apiMatches) {
            console.log(`    API 端点:`);
            apiMatches.forEach(m => console.log(`      ${m}`));
          }
        }
      }
    }

    // === Step 7: 如果有积分，解锁图集 ===
    console.log(`\n[7] 尝试解锁图集 (积分: ${currentPoints})...`);

    // 导航到图集页面
    await page.goto(CONFIG.galleryUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__latpConfig !== undefined, { timeout: 15000 });

    const galleryConfig = await page.evaluate(() => window.__latpConfig);
    console.log(`  图集已购: ${galleryConfig.isPurchase}`);
    console.log(`  图集价格: ${galleryConfig.viewPrice} 积分`);
    console.log(`  用户积分: ${galleryConfig.userPoints}`);

    if (!galleryConfig.isPurchase && galleryConfig.userPoints >= galleryConfig.viewPrice) {
      console.log('\n  积分充足，调用解锁 API...');

      const unlockResult = await page.evaluate(async (galleryId) => {
        const res = await fetch('/purchase/gallery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'csrf-token': window.__csrfToken || '',
          },
          body: JSON.stringify({ id: parseInt(galleryId), type: 'gallery_view' }),
        });
        return { status: res.status, data: await res.json() };
      }, CONFIG.galleryId);

      console.log(`  解锁结果: ${JSON.stringify(unlockResult).substring(0, 300)}`);
      fs.writeFileSync(
        path.join(CONFIG.outputDir, 'auth-unlock-final-response.json'),
        JSON.stringify(unlockResult, null, 2)
      );

      if (unlockResult.data?.success) {
        console.log('  ✅ 解锁成功！刷新页面...');
        await page.waitForTimeout(1500);
        await page.goto(CONFIG.galleryUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__latpConfig !== undefined, { timeout: 15000 });
      }
    } else if (!galleryConfig.isPurchase) {
      console.log(`  ❌ 积分不足: 需要 ${galleryConfig.viewPrice}，当前 ${galleryConfig.userPoints}`);

      // 即使积分不足，也尝试从页面中提取所有可见的图片
      console.log('\n  尝试从已加载的页面中提取所有可见图片...');
    }

    // === Step 8: 提取图片 ===
    console.log('\n[8] 提取所有图片...');

    // 截图
    await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-gallery-final.png'), fullPage: true });

    // 保存 HTML 源码
    const html = await page.content();
    fs.writeFileSync(path.join(CONFIG.outputDir, 'auth-gallery-final.html'), html);

    // 提取所有图片 URL（从 DOM + HTML 源码）
    const extracted = await page.evaluate(() => {
      const cfg = window.__latpConfig || {};
      const cdnDomain = cfg.cdnDomain || 'https://coserbox.static.iloli.io';

      // 从 DOM 中提取
      const domImages = [...document.querySelectorAll('img')].map(img => ({
        src: img.src,
        dataSrc: img.dataset.src || null,
        dataHref: img.dataset.href || null,
      }));

      // 从 HTML 源码中提取
      const htmlSource = document.documentElement.outerHTML;

      // 各种 URL 模式
      const patterns = [
        /https?:\/\/[^"'\s)<>]+coserbox[^"'\s)<>]+\.webp[^"'\s)<>]*/g,
        /\/gallery\/[^"'\s)<>]+\.webp[^"'\s)<>]*/g,
      ];

      const htmlUrls = new Set();
      patterns.forEach(p => {
        const matches = htmlSource.match(p);
        if (matches) matches.forEach(m => htmlUrls.add(m));
      });

      // 从 a[data-fancybox] 中提取
      const fancyboxAnchors = [...document.querySelectorAll('a[data-fancybox]')].map(a => ({
        href: a.href,
        dataHref: a.dataset.href || null,
        dataSrc: a.dataset.src || null,
      }));

      return {
        isPurchase: cfg.isPurchase,
        imageCount: cfg.imageCount,
        cdnDomain,
        domImages,
        htmlUrls: [...htmlUrls],
        fancyboxAnchors,
      };
    });

    console.log(`  图集已解锁: ${extracted.isPurchase}`);
    console.log(`  图片总数(配置): ${extracted.imageCount}`);
    console.log(`  DOM 图片数: ${extracted.domImages.length}`);
    console.log(`  HTML URL 数: ${extracted.htmlUrls.length}`);
    console.log(`  Fancybox 锚点数: ${extracted.fancyboxAnchors.length}`);

    // 合并所有唯一 URL
    const allUrls = new Set();
    extracted.htmlUrls.forEach(u => allUrls.add(u));
    extracted.domImages.forEach(img => {
      if (img.src && img.src.includes('.webp')) allUrls.add(img.src);
      if (img.dataSrc) allUrls.add(img.dataSrc);
      if (img.dataHref) allUrls.add(img.dataHref);
    });
    extracted.fancyboxAnchors.forEach(a => {
      if (a.href) allUrls.add(a.href);
      if (a.dataHref) allUrls.add(a.dataHref);
      if (a.dataSrc) allUrls.add(a.dataSrc);
    });

    // 标准化 URL（补全 CDN 域名）
    const cdnDomain = extracted.cdnDomain || 'https://coserbox.static.iloli.io';
    const normalizedUrls = [...allUrls].map(url => {
      if (url.startsWith('http')) return url;
      if (url.startsWith('/')) return cdnDomain + url;
      return url;
    }).filter(url => url.includes('.webp'));

    // 去重
    const uniqueUrls = [...new Set(normalizedUrls)];

    console.log(`\n  唯一图片 URL 数: ${uniqueUrls.length}`);
    uniqueUrls.forEach((url, i) => {
      console.log(`    [${i + 1}] ${url.substring(0, 120)}`);
    });

    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-final-image-urls.json'),
      JSON.stringify({ uniqueUrls, summary: { total: uniqueUrls.length, target: extracted.imageCount } }, null, 2)
    );

    // === Step 9: 下载图片 ===
    if (uniqueUrls.length > 0) {
      console.log(`\n[9] 下载 ${uniqueUrls.length} 张图片...`);

      const results = [];
      for (let i = 0; i < uniqueUrls.length; i++) {
        const url = uniqueUrls[i];
        const cleanUrl = url.split('?')[0]; // 去掉查询参数获取原始图片
        const filename = cleanUrl.split('/').pop() || `image_${i + 1}.webp`;
        const filepath = path.join(CONFIG.imagesDir, `${String(i + 1).padStart(3, '0')}_${filename}`);

        // 使用带 class 参数的 URL 下载（获取最大质量）
        const downloadUrl = url.includes('?class=') ? url : url + '?class=normalvip';

        try {
          await downloadImage(downloadUrl, filepath);
          const stats = fs.statSync(filepath);
          results.push({ index: i + 1, url: downloadUrl.substring(0, 100), filename, size: stats.size, status: 'success' });
          console.log(`  [${i + 1}/${uniqueUrls.length}] ✅ ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
        } catch (error) {
          results.push({ index: i + 1, url: downloadUrl.substring(0, 100), filename, error: error.message, status: 'failed' });
          console.log(`  [${i + 1}/${uniqueUrls.length}] ❌ ${filename} - ${error.message}`);
        }
        await new Promise(r => setTimeout(r, 300));
      }

      const success = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      console.log(`\n  下载完成: ✅ ${success} 成功, ❌ ${failed} 失败`);

      fs.writeFileSync(path.join(CONFIG.outputDir, 'auth-final-download-results.json'), JSON.stringify(results, null, 2));
    }

    // === Step 10: 最终报告 ===
    console.log('\n[10] 最终报告:');
    const report = {
      time: new Date().toISOString(),
      account: CONFIG.email,
      userId: loginResult.data?.userId,
      loginSuccess: loginResult.success,
      pointsBefore: pointsResult.data?.points || 0,
      pointsAfter: currentPoints,
      checkinAttempted: true,
      galleryId: CONFIG.galleryId,
      galleryImageCount: extracted.imageCount,
      galleryPurchased: extracted.isPurchase,
      extractedImageCount: uniqueUrls.length,
      apiDiscovery: {
        loginApi: 'POST /web-api/v1/user/login { email, password }',
        pointsApi: 'GET /web-api/v1/user/points',
        unlockApi: 'POST /purchase/gallery { id, type: "gallery_view" }',
        csrfHeader: 'csrf-token',
        csrfSource: 'window.__csrfToken',
        checkinApi: 'POST /web-api/v1/user/checkin (需验证)',
        configApi: 'GET /web-api/v1/config/register',
        galleriesApi: 'GET /web-api/v1/galleries',
        favoriteApi: 'POST /web-api/v1/favorite { galleryId, action }',
        cdnDomain: cdnDomain,
        imageClass: 'normalvip / categorycovermobile / categoryicon',
      },
    };
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(CONFIG.outputDir, 'auth-final-report-v2.json'), JSON.stringify(report, null, 2));

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error(error.stack);
    try { await page.screenshot({ path: path.join(CONFIG.outputDir, 'auth-error-v2.png') }); } catch (e) {}
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'auth-error-log-v2.json'),
      JSON.stringify({ error: error.message, stack: error.stack, time: new Date().toISOString() }, null, 2)
    );
  } finally {
    try {
      const state = await ctx.storageState();
      fs.writeFileSync(path.join(CONFIG.outputDir, 'auth-storage-state-v2.json'), JSON.stringify(state, null, 2));
    } catch (e) {}
    await browser.close();
    console.log('\n=== 完成 ===');
  }
}

main().catch(console.error);
