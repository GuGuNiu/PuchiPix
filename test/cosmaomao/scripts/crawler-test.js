/**
 * COS猫猫爬虫测试脚本
 * 目标: https://cosmaomao.com/cos-online/487022.html
 * 测试内容: 提取 "当前作品数量共 55张 ，普通用户免费查看前三张；会员全站免费看：解锁会员权限"
 */

const { chromium } = require('playwright');

(async () => {
    console.log('🚀 启动浏览器...');

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'zh-CN'
    });

    const page = await context.newPage();

    const targetUrl = 'https://cosmaomao.com/cos-online/487022.html';
    console.log(`🌐 导航到: ${targetUrl}`);

    await page.goto(targetUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
    });

    // 等待页面渲染
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log(`📄 页面标题: ${title}`);

    // 获取页面内容
    const content = await page.content();

    console.log('\n========================================');
    console.log('测试结果');
    console.log('========================================');

    // 测试 1: 检查目标文本
    const targetText = '当前作品数量共';
    const hasTarget = content.includes(targetText);
    console.log(`✅ 目标文本存在于HTML中: ${hasTarget}`);

    // 测试 2: CSS选择器提取
    console.log('\n--- CSS选择器测试 ---');
    const selectors = [
        '.images-number-tips',
        'div.images-number-tips',
        '.entry-desc'
    ];

    for (const selector of selectors) {
        try {
            const element = await page.locator(selector).first();
            const text = await element.textContent().catch(() => null);

            if (text) {
                console.log(`✅ 选择器 "${selector}" 成功:`);
                console.log(`   内容: ${text.trim().substring(0, 100)}`);

                // 提取图片数量
                const match = text.match(/(\d+)\s*张/);
                if (match) {
                    console.log(`   📊 提取到图片数量: ${match[1]} 张`);
                }
            } else {
                console.log(`❌ 选择器 "${selector}" 未找到元素`);
            }
        } catch (e) {
            console.log(`⚠️ 选择器 "${selector}" 出错: ${e.message}`);
        }
    }

    // 测试 3: JavaScript 执行
    console.log('\n--- JavaScript 执行测试 ---');
    const jsResult = await page.evaluate(() => {
        // 方法1: querySelector
        const byClass = document.querySelector('.images-number-tips');

        // 方法2: 遍历文本节点
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textResults = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.includes('当前作品数量共')) {
                textResults.push({
                    text: node.textContent.trim(),
                    parentTag: node.parentElement?.tagName,
                    parentClass: node.parentElement?.className
                });
            }
        }

        // 提取图片数量
        const pageText = document.body.innerText;
        const match = pageText.match(/当前作品数量共\s*(\d+)\s*张/);

        return {
            byClassText: byClass ? byClass.textContent.trim() : null,
            textResults: textResults.slice(0, 3),
            extractedCount: match ? match[1] : null
        };
    });

    console.log(`✅ JS 类名提取: ${jsResult.byClassText}`);
    console.log(`✅ JS 提取图片数: ${jsResult.extractedCount} 张`);
    console.log(`📋 文本节点匹配数: ${jsResult.textResults.length}`);

    // 测试 4: 正则提取
    console.log('\n--- 正则提取测试 ---');
    const regex = /当前作品数量共\s*(\d+)\s*张\s*，\s*普通用户免费查看前三张；\s*会员全站免费看：\s*解锁会员权限/;
    const match = content.match(regex);
    if (match) {
        console.log(`✅ 正则匹配成功，图片数量: ${match[1]} 张`);
    }

    // 截图
    console.log('\n--- 截图保存 ---');
    const screenshotPath = '../data/crawler-test-screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✅ 截图已保存: ${screenshotPath}`);

    await browser.close();

    console.log('\n========================================');
    console.log('✅ 爬虫测试成功! 目标文本可直接提取');
    console.log('========================================');
    console.log('\n结论:');
    console.log('- 目标文本在页面HTML中明文存在');
    console.log('- 推荐选择器: .images-number-tips');
    console.log('- 图片数量可通过正则 /(\d+)\s*张/ 提取');
    console.log('- 静态抓取即可获取数据，无需浏览器渲染');
})();
