/**
 * 4KHD — Deep page reverse analysis (phase 2).
 * Fixes:
 * 1. Wait for the Cloudflare challenge to complete
 * 2. Wait for real DOM content (not about:blank)
 * 3. Intercept admin-ajax.php requests/responses
 * 4. Analyze lazy-loading image strategy
 * 5. Detect Cloudflare anti-bot mechanisms
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://qbep.uuss.uk/content/02/island-fish-prince-eugen-bunny-girl.html';
const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORT_PATH = path.join(DATA_DIR, 'deep-analysis-report.json');
const HTML_PATH = path.join(DATA_DIR, 'page-full.html');
const AJAX_PATH = path.join(DATA_DIR, 'ajax-response.json');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  // Hide webdriver fingerprints
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Override Chrome runtime to avoid detection
    window.chrome = { runtime: {} };
    // Override permissions
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }
  });

  const page = await context.newPage();

  // Collect all network requests
  const allRequests = [];
  const ajaxResponses = [];

  page.on('request', (request) => {
    allRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      headers: request.headers(),
      postData: request.postData() || '',
    });
  });

  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const headers = response.headers();

    // Intercept AJAX requests
    if (url.includes('admin-ajax.php') || url.includes('4khd.php') || url.includes('/api/')) {
      try {
        const body = await response.text();
        ajaxResponses.push({
          url,
          status,
          contentType: headers['content-type'] || '',
          body: body.substring(0, 5000),
          bodyLength: body.length,
        });
      } catch (e) {
        ajaxResponses.push({
          url,
          status,
          error: e.message,
        });
      }
    }

    // Log Cloudflare challenge responses
    if (url.includes('cdn-cgi/challenge-platform') || status === 403 || status === 503) {
      try {
        const body = await response.text();
        allRequests.push({
          url,
          status,
          contentType: headers['content-type'] || '',
          bodyPreview: body.substring(0, 2000),
          bodyLength: body.length,
          isChallenge: true,
        });
      } catch (e) {
        // ignore
      }
    }
  });

  // Intercept page navigation events
  const navigations = [];
  page.on('framenavigated', (frame) => {
    navigations.push({
      url: frame.url(),
      name: frame.name(),
      timestamp: new Date().toISOString(),
    });
  });

  console.log('[1/6] Navigating to:', TARGET_URL);

  // Use domcontentloaded instead of networkidle so the Cloudflare challenge can finish
  const response = await page.goto(TARGET_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('[1/6] Initial status:', response?.status());
  console.log('[1/6] Initial URL:', page.url());

  // Wait for the Cloudflare challenge to complete
  console.log('[2/6] Waiting for Cloudflare challenge to complete...');
  try {
    // Cloudflare challenges usually finish within 5-10 seconds
    await page.waitForFunction(
      () => {
        // Check whether still on the challenge page
        const challengeForm = document.querySelector('#challenge-form, #cf-challenge-running');
        if (challengeForm) return false;
        
        // Check whether real content is present
        const hasContent = document.body && document.body.textContent.length > 100;
        const hasArticle = document.querySelector('article, .post, .entry-content, .content-area, #content') !== null;
        const hasImages = document.querySelectorAll('img').length > 0;
        const hasTitle = document.title && document.title.length > 0;
        
        return (hasContent || hasArticle || hasImages) && hasTitle;
      },
      { timeout: 30000 }
    ).catch(() => {
      console.log('[2/6] Timeout waiting for content. Current URL:', page.url());
    });
  } catch (e) {
    console.log('[2/6] Challenge wait error:', e.message);
  }

  // Extra wait for dynamic content to load
  console.log('[3/6] Waiting for dynamic content...');
  await page.waitForTimeout(5000);

  // Try scrolling to trigger lazy-loading
  console.log('[4/6] Scrolling to trigger lazy-loading...');
  await page.evaluate(async () => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const scrollHeight = document.body.scrollHeight;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      window.scrollTo(0, (scrollHeight * i) / steps);
      await delay(500);
    }
    window.scrollTo(0, 0);
  });

  await page.waitForTimeout(2000);

  console.log('[5/6] Extracting page data...');
  const currentUrl = page.url();
  const html = await page.content();
  const title = await page.title();
  console.log('[5/6] Current URL:', currentUrl);
  console.log('[5/6] Page title:', title);
  console.log('[5/6] HTML length:', html.length);

  // Extract detailed page data
  const pageData = await page.evaluate(() => {
    const result = {};

    result.title = document.title;
    result.url = window.location.href;
    result.htmlLength = document.documentElement.outerHTML.length;

    // meta
    result.meta = {};
    document.querySelectorAll('meta').forEach(m => {
      const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      const content = m.getAttribute('content');
      if (name && content) result.meta[name] = content;
    });

    result.generator = result.meta['generator'] || '';

    // CMS detection
    result.cms = {
      wordpress: !!document.querySelector('head > link[href*="wp-content"], head > link[href*="wp-includes"], meta[name="generator"][content*="WordPress"]'),
      wix: !!document.querySelector('script[src*="wix"], meta[name="generator"][content*="Wix"]'),
      b2: !!document.querySelector('script[src*="/b2/"], .b2-content'),
      modown: !!document.querySelector('script[src*="modown"], .modown'),
      erphpdown: !!document.querySelector('script[src*="erphpdown"], .erphpdown'),
    };

    // H1
    const h1 = document.querySelector('h1');
    result.h1 = h1 ? h1.textContent.trim() : '';

    // Article content
    const article = document.querySelector('article, .post-content, .entry-content, .content-area, .post, #content, .single-content');
    result.article = {
      exists: !!article,
      className: article ? article.className : '',
      id: article ? article.id : '',
      textLength: article ? article.textContent.trim().length : 0,
    };

    // All images
    result.allImages = [];
    document.querySelectorAll('img').forEach((img, idx) => {
      result.allImages.push({
        idx,
        src: img.getAttribute('src') || '',
        dataSrc: img.getAttribute('data-src') || '',
        dataOriginal: img.getAttribute('data-original') || '',
        dataLazySrc: img.getAttribute('data-lazy-src') || '',
        dataOriginalSrc: img.getAttribute('data-original-src') || '',
        srcset: img.getAttribute('srcset') || '',
        dataSrcset: img.getAttribute('data-srcset') || '',
        alt: img.getAttribute('alt') || '',
        width: img.getAttribute('width') || '',
        height: img.getAttribute('height') || '',
        loading: img.getAttribute('loading') || '',
        className: img.className || '',
        parentClass: img.parentElement ? img.parentElement.className : '',
        parentTag: img.parentElement ? img.parentElement.tagName.toLowerCase() : '',
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    });

    // Pagination
    const pagination = document.querySelector('.pagination, .page-navigation, .wp-pagenavi, nav.pagination, .nav-links, .page-numbers');
    result.pagination = pagination ? pagination.textContent.trim().replace(/\s+/g, ' ') : '';
    result.paginationHTML = pagination ? pagination.innerHTML.trim() : '';

    // Breadcrumbs
    const breadcrumb = document.querySelector('nav[aria-label="breadcrumb"], .breadcrumb, .breadcrumbs, .crumbs');
    result.breadcrumb = breadcrumb ? breadcrumb.textContent.trim().replace(/\s+/g, ' ') : '';

    // Download related
    result.downloadButtons = [];
    document.querySelectorAll('a[href*="download"], .download-btn, .btn-download, [class*="download"], a[href*=".zip"], a[href*=".rar"]').forEach(el => {
      result.downloadButtons.push({
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
        text: el.textContent.trim().substring(0, 200),
        className: el.className,
        dataAttrs: Object.keys(el.dataset || {}),
      });
    });

    // Tags
    result.tags = [];
    document.querySelectorAll('a[href*="/tag/"], a[rel="tag"], .tag-cloud a, .post-tags a, .tags a').forEach(a => {
      result.tags.push({ text: a.textContent.trim(), href: a.getAttribute('href') });
    });

    // Publish time
    const timeEl = document.querySelector('time, .post-date, .publish-date, .date, .entry-date, .post-meta time');
    result.publishTime = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : '';

    // Category
    const catEl = document.querySelector('.post-category, .entry-category, .cat-links, .category, .post-meta .category');
    result.category = catEl ? catEl.textContent.trim().replace(/\s+/g, ' ') : '';

    // Pagination links
    const nextLink = document.querySelector('a.next, a[rel="next"], .nav-next a, .next-page a');
    const prevLink = document.querySelector('a.prev, a[rel="prev"], .nav-previous a, .prev-page a');
    result.nextPage = nextLink ? nextLink.getAttribute('href') : '';
    result.prevPage = prevLink ? prevLink.getAttribute('href') : '';

    // Cloudflare detection
    result.waf = {
      cfRay: document.querySelector('script[src*="cloudflare"], script[src*="cdn-cgi/challenge-platform"]') !== null,
      challenge: document.querySelector('#cf-challenge-running, #challenge-form, .cf-browser-verification') !== null,
      turnstile: document.querySelector('.cf-turnstile, script[src*="challenges.cloudflare.com/turnstile"]') !== null,
    };

    // JSON-LD
    result.jsonLd = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        result.jsonLd.push(JSON.parse(s.textContent));
      } catch (e) {
        result.jsonLd.push({ raw: s.textContent.substring(0, 1000) });
      }
    });

    // Inline scripts content
    result.inlineScripts = [];
    document.querySelectorAll('script:not([src])').forEach(s => {
      const text = s.textContent.trim();
      if (text.length > 0) {
        result.inlineScripts.push(text.substring(0, 2000));
      }
    });

    // External scripts
    result.externalScripts = [];
    document.querySelectorAll('script[src]').forEach(s => {
      result.externalScripts.push({
        src: s.getAttribute('src'),
        async: s.hasAttribute('async'),
        defer: s.hasAttribute('defer'),
      });
    });

    // Link analysis
    result.contentLinks = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
        result.contentLinks.push({
          href,
          text: a.textContent.trim().substring(0, 100),
        });
      }
    });

    // body class
    result.bodyClass = document.body ? document.body.className : '';

    // Page structure analysis — direct children of main containers
    const main = document.querySelector('main, #main, .site-main, #content, .content-area') || document.body;
    if (main) {
      result.mainStructure = [];
      Array.from(main.children).forEach(child => {
        result.mainStructure.push({
          tag: child.tagName.toLowerCase(),
          class: child.className,
          id: child.id,
          textPreview: child.textContent.trim().substring(0, 200),
        });
      });
    }

    return result;
  });

  console.log('[5/6] Extracted data:');
  console.log('  Title:', pageData.title);
  console.log('  H1:', pageData.h1);
  console.log('  Generator:', pageData.generator);
  console.log('  CMS:', JSON.stringify(pageData.cms));
  console.log('  Images:', pageData.allImages.length);
  console.log('  Tags:', pageData.tags.length);
  console.log('  Links:', pageData.contentLinks.length);
  console.log('  Download buttons:', pageData.downloadButtons.length);
  console.log('  WAF:', JSON.stringify(pageData.waf));
  console.log('  JSON-LD:', pageData.jsonLd.length);
  console.log('  Inline scripts:', pageData.inlineScripts.length);
  console.log('  External scripts:', pageData.externalScripts.length);

  console.log('[6/6] Saving reports...');
  fs.writeFileSync(HTML_PATH, html, 'utf-8');
  fs.writeFileSync(AJAX_PATH, JSON.stringify(ajaxResponses, null, 2), 'utf-8');

  const report = {
    timestamp: new Date().toISOString(),
    targetUrl: TARGET_URL,
    finalUrl: currentUrl,
    navigations,
    pageData,
    networkRequests: {
      total: allRequests.length,
      all: allRequests,
    },
    ajaxResponses,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  // Output image URL list
  const imageUrls = pageData.allImages
    .map(img => img.dataSrc || img.dataOriginal || img.dataLazySrc || img.dataOriginalSrc || img.src)
    .filter(u => u && !u.startsWith('data:') && u !== '');

  const imagePath = path.join(DATA_DIR, 'image-urls.json');
  fs.writeFileSync(imagePath, JSON.stringify(imageUrls, null, 2), 'utf-8');
  console.log('\nImage URLs saved:', imageUrls.length, 'images');

  console.log('\n=== Deep Analysis Complete ===');
  console.log('Report:', REPORT_PATH);
  console.log('HTML:', HTML_PATH);
  console.log('AJAX:', AJAX_PATH);
  console.log('Images:', imagePath);

  await browser.close();
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
