/**
 * 4KHD (qbep.uuss.uk) — 页面结构逆向分析脚本
 * 
 * 使用 Playwright 导航到目标页面，抓取：
 * 1. 页面完整 HTML 源码
 * 2. 所有图片 URL（含 data-src / lazy-loading）
 * 3. 网络请求清单（图片 / 脚本 / API）
 * 4. DOM 结构关键元素
 * 5. WAF / 反爬虫检测
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://qbep.uuss.uk/content/02/island-fish-prince-eugen-bunny-girl.html';
const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORT_PATH = path.join(DATA_DIR, 'page-analysis-report.json');
const HTML_PATH = path.join(DATA_DIR, 'page-source.html');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  const page = await context.newPage();

  // 收集所有网络请求
  const networkRequests = [];
  const imageRequests = [];
  const scriptRequests = [];
  const xhrRequests = [];

  page.on('request', (request) => {
    const url = request.url();
    const resourceType = request.resourceType();
    const entry = { url, resourceType, method: request.method() };

    networkRequests.push(entry);
    if (resourceType === 'image') imageRequests.push(url);
    if (resourceType === 'script') scriptRequests.push(url);
    if (resourceType === 'xhr' || resourceType === 'fetch') xhrRequests.push(url);
  });

  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    const headers = response.headers();

    // 记录图片响应状态
    const imgIdx = imageRequests.indexOf(url);
    if (imgIdx >= 0) {
      if (!networkRequests[imgIdx]) networkRequests[imgIdx] = {};
      networkRequests[imgIdx].status = status;
      networkRequests[imgIdx].contentType = headers['content-type'] || '';
    }
  });

  console.log('[1/5] Navigating to:', TARGET_URL);

  try {
    const response = await page.goto(TARGET_URL, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    console.log('[1/5] Page loaded. Status:', response?.status());
    console.log('[1/5] Page size:', (await response?.body()).length, 'bytes');
  } catch (e) {
    console.error('[1/5] Navigation error:', e.message);
    // 继续即使超时也收集已有数据
  }

  // 等待页面稳定
  await page.waitForTimeout(3000);

  console.log('[2/5] Extracting page data...');

  // 提取页面数据
  const pageData = await page.evaluate(() => {
    const result = {};

    // 基本信息
    result.title = document.title;
    result.url = window.location.href;
    result.htmlLength = document.documentElement.outerHTML.length;

    // meta 标签
    result.meta = {};
    document.querySelectorAll('meta').forEach(m => {
      const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      const content = m.getAttribute('content');
      if (name && content) result.meta[name] = content;
    });

    // 检测 generator meta (WordPress/Wix/etc.)
    result.generator = result.meta['generator'] || '';

    // 检测 CMS 框架
    result.cms = {};
    result.cms.wordpress = !!document.querySelector('head > link[href*="wp-content"], head > link[href*="wp-includes"], meta[name="generator"][content*="WordPress"]');
    result.cms.wix = !!document.querySelector('script[src*="wix"], meta[name="generator"][content*="Wix"]');
    result.cms.blogger = !!document.querySelector('link[href*="blogger"]');
    result.cms.b2 = !!document.querySelector('script[src*="/b2/"], .b2-content');
    result.cms.modown = !!document.querySelector('script[src*="modown"], .modown');
    result.cms.discuz = !!document.querySelector('script[src*="discuz"], #discuz_tips');

    // H1 标题
    const h1 = document.querySelector('h1');
    result.h1 = h1 ? h1.textContent.trim() : '';

    // 面包屑导航
    const breadcrumb = document.querySelector('nav[aria-label="breadcrumb"], .breadcrumb, .breadcrumbs');
    result.breadcrumb = breadcrumb ? breadcrumb.textContent.trim().replace(/\s+/g, ' ') : '';

    // 检测分页
    const pagination = document.querySelector('.pagination, .page-navigation, .wp-pagenavi, nav.pagination, .nav-links');
    result.pagination = pagination ? pagination.textContent.trim().replace(/\s+/g, ' ') : '';
    result.paginationHTML = pagination ? pagination.innerHTML : '';

    // 文章内容区域
    const article = document.querySelector('article, .post-content, .entry-content, .content-area, .post, #content');
    result.article = {
      exists: !!article,
      className: article ? article.className : '',
      id: article ? article.id : '',
      textLength: article ? article.textContent.length : 0,
    };

    // 提取所有图片
    result.allImages = [];
    document.querySelectorAll('img').forEach((img, idx) => {
      const src = img.getAttribute('src') || '';
      const dataSrc = img.getAttribute('data-src') || '';
      const dataOriginal = img.getAttribute('data-original') || '';
      const dataLazy = img.getAttribute('data-lazy-src') || '';
      const dataOriginalSrc = img.getAttribute('data-original-src') || '';
      const srcset = img.getAttribute('srcset') || '';
      const alt = img.getAttribute('alt') || '';
      const width = img.getAttribute('width') || '';
      const height = img.getAttribute('height') || '';
      const className = img.className || '';
      const parent = img.parentElement;
      const parentClass = parent ? parent.className : '';
      const parentTag = parent ? parent.tagName.toLowerCase() : '';

      result.allImages.push({
        idx,
        src,
        dataSrc,
        dataOriginal,
        dataLazy,
        dataOriginalSrc,
        srcset,
        alt,
        width,
        height,
        className,
        parentClass,
        parentTag,
      });
    });

    // 检测 lazy-loading 属性
    result.lazyLoading = {
      loadingAttr: document.querySelectorAll('img[loading="lazy"]').length,
      dataSrcCount: document.querySelectorAll('img[data-src]').length,
      dataOriginalCount: document.querySelectorAll('img[data-original]').length,
    };

    // 检测 Cloudflare / WAF
    result.waf = {};
    result.waf.cloudflare = {
      cfRay: document.querySelector('meta[name="cf-ray"], script[src*="cloudflare"]') !== null,
      challenge: document.querySelector('#cf-challenge-running, #challenge-form, .cf-browser-verification') !== null,
      turnstile: document.querySelector('.cf-turnstile, script[src*="challenges.cloudflare.com/turnstile"]') !== null,
    };
    result.waf.captcha = {
      recaptcha: document.querySelector('.g-recaptcha, script[src*="recaptcha"]') !== null,
      hcaptcha: document.querySelector('.h-captcha, script[src*="hcaptcha"]') !== null,
    };
    result.waf.jsChallenge = document.body && document.body.textContent.includes('Please enable JavaScript') ||
      document.body && document.body.textContent.includes('请启用 JavaScript');

    // 检测 script 标签中的关键信息
    result.scripts = [];
    document.querySelectorAll('script[src]').forEach(s => {
      result.scripts.push({ src: s.getAttribute('src'), type: s.getAttribute('type') || '' });
    });

    // 检测 inline 脚本中的 JSON-LD
    result.jsonLd = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        result.jsonLd.push(JSON.parse(s.textContent));
      } catch (e) {
        result.jsonLd.push({ raw: s.textContent.substring(0, 500) });
      }
    });

    // 检测链接结构
    result.links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        result.links.push({
          href,
          text: a.textContent.trim().substring(0, 100),
          rel: a.getAttribute('rel') || '',
        });
      }
    });

    // 检测下载/ZIP 相关元素
    result.download = {};
    result.download.buttons = [];
    document.querySelectorAll('a[href*="download"], .download-btn, .btn-download, [class*="download"]').forEach(el => {
      result.download.buttons.push({
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
        text: el.textContent.trim().substring(0, 200),
        className: el.className,
      });
    });

    // 检测分类/标签
    result.tags = [];
    document.querySelectorAll('a[href*="/tag/"], a[rel="tag"], .tag-cloud a, .post-tags a').forEach(a => {
      result.tags.push({ text: a.textContent.trim(), href: a.getAttribute('href') });
    });

    // 检测发布时间
    const timeEl = document.querySelector('time, .post-date, .publish-date, .date, .entry-date');
    result.publishTime = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : '';

    // 检测分类
    const catEl = document.querySelector('.post-category, .entry-category, .cat-links, .category');
    result.category = catEl ? catEl.textContent.trim().replace(/\s+/g, ' ') : '';

    // body class
    result.bodyClass = document.body ? document.body.className : '';

    // 检测 next/prev 分页
    const nextLink = document.querySelector('a.next, a[rel="next"], .nav-next a');
    const prevLink = document.querySelector('a.prev, a[rel="prev"], .nav-previous a');
    result.nextPage = nextLink ? nextLink.getAttribute('href') : '';
    result.prevPage = prevLink ? prevLink.getAttribute('href') : '';

    // 页面 URL 模式
    result.urlPattern = window.location.pathname;

    // 提取 body 的完整 HTML（前5000字符用于结构分析）
    result.bodyStructure = document.body ? document.body.innerHTML.substring(0, 5000) : '';

    return result;
  });

  console.log('[2/5] Page data extracted:');
  console.log('  Title:', pageData.title);
  console.log('  H1:', pageData.h1);
  console.log('  HTML length:', pageData.htmlLength);
  console.log('  Images found:', pageData.allImages.length);
  console.log('  Generator:', pageData.generator);
  console.log('  CMS detection:', JSON.stringify(pageData.cms));
  console.log('  WAF detection:', JSON.stringify(pageData.waf));

  console.log('[3/5] Saving page HTML...');
  const html = await page.content();
  fs.writeFileSync(HTML_PATH, html, 'utf-8');

  console.log('[4/5] Collecting network requests...');
  console.log('  Total requests:', networkRequests.length);
  console.log('  Image requests:', imageRequests.length);
  console.log('  Script requests:', scriptRequests.length);
  console.log('  XHR/Fetch requests:', xhrRequests.length);

  console.log('[5/5] Saving analysis report...');
  const report = {
    timestamp: new Date().toISOString(),
    targetUrl: TARGET_URL,
    pageData,
    networkRequests: {
      total: networkRequests.length,
      images: imageRequests,
      scripts: scriptRequests,
      xhr: xhrRequests,
      all: networkRequests,
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n=== Analysis Complete ===');
  console.log('Report saved to:', REPORT_PATH);
  console.log('HTML saved to:', HTML_PATH);

  await browser.close();
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
