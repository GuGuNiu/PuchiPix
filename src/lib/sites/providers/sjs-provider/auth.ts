import type { BrowserContext } from "playwright";
import type { CookieData } from "../../site-account-manager";
import { getSiteAccountManager } from "../../site-account-manager";
import { DomainHealthTracker } from "@/lib/core/domain-health-tracker";
import { logT } from "@/lib/i18n/server";
import { SITE_DOMAINS, DISCUZ_COOKIE_PREFIX } from "./constants";

/** 域名健康度跟踪器 */
const domainHealthTracker = new DomainHealthTracker();

export function getBestDomain(): string {
  return domainHealthTracker.getBestDomain(SITE_DOMAINS);
}

export function getAllDomainsOrdered(): string[] {
  return domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
}

export function markDomainHealthy(domain: string): void {
  domainHealthTracker.markHealthy(domain);
}

export function markDomainRateLimited(domain: string): void {
  domainHealthTracker.markRateLimited(domain);
}

/**
 * 设置浏览器上下文 Cookie。
 */
export async function setupSjsBrowserContext(
  context: BrowserContext,
): Promise<{ accountId: number | null }> {
  const accountManager = getSiteAccountManager();
  const account = await accountManager.getAvailableAccount("sjs");

  if (!account) {
    console.warn(logT("log.sjs.noAccount"));
    return { accountId: null };
  }

  const cookies = await accountManager.getAuthCookies(account.id);

  if (cookies && cookies.length > 0) {
    const allCookies = [];
    for (const domain of SITE_DOMAINS) {
      const parsedDomain = new URL(domain).hostname;
      for (const cookie of cookies) {
        allCookies.push({
          ...cookie,
          domain: parsedDomain,
        });
      }
    }

    try {
      await context.addCookies(allCookies);
      console.log(
        logT("log.sjs.cookieInjected", { id: account.id, count: cookies.length }),
      );
    } catch (err) {
      console.warn(logT("log.sjs.cookieInjectionFailed"), err);
    }
  } else {
    console.log(logT("log.sjs.noCookieStartLogin"));
    await performLogin(context, account.id, account.username, account.password);
  }

  return { accountId: account.id };
}

/**
 * 执行 Discuz 论坛登录流程。
 */
async function performLogin(
  context: BrowserContext,
  accountId: number,
  username: string,
  password: string,
): Promise<void> {
  const accountManager = getSiteAccountManager();
  const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);

  const page = await context.newPage();

  try {
    const loginUrl = `${domain}/member.php?mod=logging&action=login`;
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const loginForm = await page.locator('form[id^="loginform_"]').first();
    if (!loginForm) {
      throw new Error("未找到登录表单");
    }

    const _formhash = await page
      .locator('form[id^="loginform_"] input[name="formhash"]')
      .inputValue();

    const formId = await loginForm.getAttribute("id");
    const suffix = formId?.replace("loginform_", "") || "";

    await page.locator(`#username_${suffix}`).fill(username);
    await page.locator(`#password3_${suffix}`).fill(password);
    await page.locator(`#cookietime_${suffix}`).check().catch(() => {});

    await page
      .locator(
        `form#loginform_${suffix} button[type="submit"], form#loginform_${suffix} input[type="submit"]`,
      )
      .click();

    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});

    await page
      .goto(`${domain}/`, { waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => {});

    const logoutLink = await page.locator('a[href*="action=logout"]').first();
    const isLoggedIn = await logoutLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (!isLoggedIn) {
      throw new Error("登录失败：未检测到登录状态");
    }

    const cookies = await context.cookies();
    const sjsCookies = cookies
      .filter((c) => {
        const hostname = new URL(domain).hostname;
        return c.domain.includes(hostname);
      })
      .map(
        (c): CookieData => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite:
            c.sameSite === "Strict"
              ? "Strict"
              : c.sameSite === "None"
                ? "None"
                : "Lax",
          ...(c.expires > 0 ? { expires: c.expires } : {}),
        }),
      );

    if (sjsCookies.length === 0) {
      throw new Error("登录后未获取到 Cookie");
    }

    await accountManager.saveAuthCookies(accountId, sjsCookies, DISCUZ_COOKIE_PREFIX);
    console.log(
      logT("log.sjs.loginSuccess", { id: accountId, count: sjsCookies.length }),
    );

    domainHealthTracker.markHealthy(domain);
  } catch (err) {
    console.error(logT("log.sjs.loginFailed"), err);
    await accountManager.markLoginFailed(
      accountId,
      err instanceof Error ? err.message : String(err),
    );

    domainHealthTracker.markRateLimited(domain);

    throw new Error(`司机社登录失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await page.close().catch(() => {});
  }
}
