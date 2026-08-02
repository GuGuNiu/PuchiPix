/**
 * Coser.io 技术栈深度分析脚本
 * 目标: 识别站点使用的框架、CMS、技术架构
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';

// HTTP请求工具
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        ...options.headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        let body;
        try {
          if (encoding === 'gzip') {
            body = zlib.gunzipSync(buffer).toString('utf-8');
          } else if (encoding === 'deflate') {
            body = zlib.inflateSync(buffer).toString('utf-8');
          } else if (encoding === 'br') {
            body = zlib.brotliDecompressSync(buffer).toString('utf-8');
          } else {
            body = buffer.toString('utf-8');
          }
        } catch (e) {
          body = buffer.toString('utf-8');
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(options.timeout || 10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// 1. 分析HTTP响应头
async function analyzeHeaders() {
  console.log('=== 1. HTTP响应头分析 ===\n');

  const urls = [
    'https://coser.io/',
    'https://coser.io/latp/69218.html',
    'https://coser.io/web-api/v1/galleries'
  ];

  const results = [];
  for (const url of urls) {
    try {
      const res = await request(url);
      const headers = res.headers;

      console.log(`${url}:`);
      console.log(`  Status: ${res.statusCode}`);
      console.log(`  Server: ${headers.server || 'Not specified'}`);
      console.log(`  X-Powered-By: ${headers['x-powered-by'] || 'Not specified'}`);
      console.log(`  Content-Type: ${headers['content-type']}`);
      console.log(`  Set-Cookie: ${headers['set-cookie'] ? 'Yes' : 'No'}`);
      console.log(`  X-Frame-Options: ${headers['x-frame-options'] || 'Not specified'}`);
      console.log(`  X-Content-Type-Options: ${headers['x-content-type-options'] || 'Not specified'}`);
      console.log(`  Content-Security-Policy: ${headers['content-security-policy'] ? 'Present' : 'Not specified'}`);
      console.log();

      results.push({
        url,
        statusCode: res.statusCode,
        headers: {
          server: headers.server,
          'x-powered-by': headers['x-powered-by'],
          'content-type': headers['content-type'],
          'set-cookie': headers['set-cookie'],
          'x-frame-options': headers['x-frame-options'],
          'content-security-policy': headers['content-security-policy'] ? 'Present' : null
        }
      });
    } catch (err) {
      console.log(`${url}: Error - ${err.message}\n`);
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'http-headers-analysis.json'), JSON.stringify(results, null, 2));
}

// 2. 分析HTML特征
async function analyzeHTMLFeatures() {
  console.log('=== 2. HTML特征分析 ===\n');

  try {
    const res = await request('https://coser.io/latp/69218.html');
    const html = res.body;

    // 检测框架特征
    const features = {
      // 框架检测
      alpinejs: html.includes('x-data') || html.includes('x-show') || html.includes('alpine'),
      vue: html.includes('vue') || html.includes('v-') || html.includes('data-v-'),
      react: html.includes('react') || html.includes('data-reactroot') || html.includes('__REACT__'),
      angular: html.includes('ng-') || html.includes('angular'),
      svelte: html.includes('svelte'),
      nextjs: html.includes('__NEXT_DATA__'),
      nuxtjs: html.includes('__NUXT__'),

      // 模板引擎检测
      twig: html.includes('{%') || html.includes('{{'),
      blade: html.includes('@php') || html.includes('@end') || html.includes('@section'),
      jinja2: html.includes('{% for') || html.includes('{% if'),
      ejs: html.includes('<%-') || html.includes('<%='),
      pug: html.includes('doctype html') && !html.includes('<!DOCTYPE'),

      // CSS框架
      tailwind: html.includes('tailwind') || html.includes('class="grid ') || html.includes('class="flex '),
      bootstrap: html.includes('bootstrap') || html.includes('class="container"') || html.includes('class="row"'),
      bulma: html.includes('bulma'),

      // 其他特征
      cdn: (html.match(/cdn\./g) || []).length,
      nonce: html.includes('nonce='),
      csrf: html.includes('csrf') || html.includes('_token'),
      gzip: res.headers['content-encoding'] === 'gzip',

      // 服务端标识
      poweredBy: html.includes('Powered by') || html.includes('powered by'),
      generator: html.includes('<meta name="generator"'),

      // 特定技术
      cloudflare: html.includes('cloudflare') || html.includes('__cf'),
      aws: html.includes('aws') || html.includes('amazonaws'),
      aliyun: html.includes('aliyun') || html.includes('alicdn'),

      // 图片处理
      webp: (html.match(/\.webp/g) || []).length,
      lazyLoad: html.includes('loading="lazy"') || html.includes('data-src'),
    };

    console.log('框架检测:');
    Object.entries(features).forEach(([key, value]) => {
      if (typeof value === 'boolean') {
        console.log(`  ${key}: ${value ? '✅ 检测到' : '❌ 未检测到'}`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    });

    // 提取script标签
    const scriptMatches = html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g);
    const scripts = [...new Set([...scriptMatches].map(m => m[1]))];
    console.log(`\n外部脚本 (${scripts.length}个):`);
    scripts.slice(0, 10).forEach(s => console.log(`  - ${s}`));

    // 提取link标签
    const linkMatches = html.matchAll(/<link[^>]*href="([^"]+)"[^>]*>/g);
    const links = [...new Set([...linkMatches].map(m => m[1]))];
    console.log(`\n外部链接 (${links.length}个):`);
    links.slice(0, 10).forEach(l => console.log(`  - ${l}`));

    // 提取meta标签
    const metaMatches = html.matchAll(/<meta[^>]*name="([^"]+)"[^>]*content="([^"]+)"[^>]*>/g);
    const metas = [...metaMatches].map(m => ({ name: m[1], content: m[2] }));
    console.log(`\nMeta标签:`);
    metas.forEach(m => console.log(`  ${m.name}: ${m.content.substring(0, 50)}`));

    fs.writeFileSync(path.join(OUTPUT_DIR, 'html-features-analysis.json'), JSON.stringify({
      features,
      scripts: scripts.slice(0, 20),
      links: links.slice(0, 20),
      metas
    }, null, 2));

  } catch (err) {
    console.error('HTML分析失败:', err.message);
  }
}

// 3. 探测常见技术路径
async function probeTechPaths() {
  console.log('\n=== 3. 技术路径探测 ===\n');

  const paths = [
    // 框架标识文件
    '/.env',
    '/.git/HEAD',
    '/.git/config',
    '/composer.json',
    '/package.json',
    '/yarn.lock',
    '/package-lock.json',
    '/webpack.config.js',
    '/vite.config.js',
    '/rollup.config.js',
    '/tsconfig.json',
    '/jsconfig.json',
    '/.htaccess',
    '/nginx.conf',
    '/robots.txt',
    '/sitemap.xml',
    '/sitemap_index.xml',

    // 框架路由
    '/_next/static/',
    '/_nuxt/',
    '/assets/',
    '/static/',
    '/public/',
    '/dist/',
    '/build/',

    // 管理后台
    '/admin',
    '/admin/',
    '/dashboard',
    '/manage',
    '/cms',
    '/backend',

    // API文档
    '/api',
    '/api/',
    '/api/docs',
    '/swagger',
    '/swagger-ui',
    '/openapi.json',
    '/graphql',

    // 健康检查
    '/health',
    '/healthz',
    '/ready',
    '/alive',
    '/status',

    // 常见CMS
    '/wp-admin',
    '/wp-content',
    '/wp-includes',
    '/administrator',
    '/admin.php',
    '/typo3',
    '/drupal',
    '/joomla',
  ];

  const results = [];
  for (const p of paths) {
    try {
      const res = await request(`https://coser.io${p}`, { timeout: 5000 });
      const result = {
        path: p,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'],
        hasBody: res.body.length > 0,
        bodyPreview: res.body.substring(0, 100)
      };
      results.push(result);

      if (res.statusCode !== 404) {
        console.log(`${p} -> ${res.statusCode}`);
        if (res.statusCode === 200) {
          console.log(`  Content-Type: ${res.headers['content-type']}`);
          console.log(`  Preview: ${res.body.substring(0, 150)}...\n`);
        }
      }
    } catch (err) {
      results.push({ path: p, error: err.message });
    }

    await new Promise(r => setTimeout(r, 300));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'tech-paths-probe.json'), JSON.stringify(results, null, 2));
}

// 4. 分析Cookie和Session
async function analyzeCookies() {
  console.log('\n=== 4. Cookie和Session分析 ===\n');

  try {
    const res = await request('https://coser.io/');
    const cookies = res.headers['set-cookie'];

    if (cookies) {
      console.log('Set-Cookie:');
      cookies.forEach(c => {
        const [nameValue] = c.split(';');
        const [name, value] = nameValue.split('=');
        console.log(`  ${name}: ${value.substring(0, 30)}...`);
      });

      fs.writeFileSync(path.join(OUTPUT_DIR, 'cookies-analysis.json'), JSON.stringify({
        cookies: cookies.map(c => {
          const parts = c.split(';').map(p => p.trim());
          const [nameValue] = parts[0].split('=');
          const attrs = {};
          parts.slice(1).forEach(p => {
            const [k, v] = p.split('=');
            attrs[k] = v || true;
          });
          return {
            name: nameValue,
            attributes: attrs,
            raw: c
          };
        })
      }, null, 2));
    } else {
      console.log('未收到Set-Cookie');
    }
  } catch (err) {
    console.error('Cookie分析失败:', err.message);
  }
}

// 5. 分析JS文件内容
async function analyzeJSContent() {
  console.log('\n=== 5. JS文件内容分析 ===\n');

  const jsFiles = [
    '/js/theme.js?v=4.4.4',
    '/js/latp.js?v=4.4.4',
    '/js/frontend/crisp-button.js?v=4.4.4',
  ];

  for (const jsPath of jsFiles) {
    try {
      const res = await request(`https://coser.io${jsPath}`);
      const content = res.body;

      console.log(`${jsPath}:`);
      console.log(`  大小: ${content.length} 字节`);

      // 检测JS中的线索
      const clues = {
        framework: content.match(/(react|vue|angular|svelte|next|nuxt)/i)?.[0],
        fetch: content.includes('fetch('),
        axios: content.includes('axios'),
        jquery: content.includes('jquery') || content.includes('jQuery') || content.includes('$('),
        alpine: content.includes('alpine') || content.includes('Alpine'),
        apiEndpoint: content.match(/['"`]\/(api|web-api)\/[^'"`]+['"`]/g),
        version: content.match(/v\d+\.\d+\.\d+/),
        buildTime: content.match(/\d{4}-\d{2}-\d{2}/),
      };

      Object.entries(clues).forEach(([key, value]) => {
        if (value) {
          if (Array.isArray(value)) {
            console.log(`  ${key}: ${value.slice(0, 5).join(', ')}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        }
      });

      console.log();
    } catch (err) {
      console.log(`${jsPath}: 获取失败 - ${err.message}\n`);
    }
  }
}

// 6. 分析CSS特征
async function analyzeCSS() {
  console.log('=== 6. CSS特征分析 ===\n');

  try {
    const res = await request('https://coser.io/css/base.css?v=4.4.4');
    const css = res.body;

    console.log(`CSS文件大小: ${css.length} 字节`);

    // 检测CSS框架
    const features = {
      tailwind: css.includes('tailwind') || css.includes('--tw-'),
      bootstrap: css.includes('bootstrap') || css.includes('.container'),
      bulma: css.includes('bulma'),
      customProperties: (css.match(/--[\w-]+:/g) || []).length,
      cssVariables: css.includes('var(--'),
    };

    console.log('CSS特征:');
    Object.entries(features).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

  } catch (err) {
    console.log('CSS分析失败:', err.message);
  }
}

// 主函数
async function main() {
  console.log('Coser.io 技术栈深度分析\n');
  console.log('=======================\n');

  await analyzeHeaders();
  await analyzeHTMLFeatures();
  await probeTechPaths();
  await analyzeCookies();
  await analyzeJSContent();
  await analyzeCSS();

  console.log('\n=== 分析完成 ===');
  console.log(`结果保存在: ${OUTPUT_DIR}`);
}

main().catch(console.error);
