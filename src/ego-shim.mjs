// Ego Lite 垫片：把一个 Ego Lite task space 包成插件（麦田发布助手）lib 要用的那几个 chrome.* 接口，
// 插件的 lib/publish.js、lib/cdp.js 不用改就能在 ego-browser nodejs 脚本里跑。
// 一个垫片实例绑定一个 space；tabId 是本进程内的数字，内部对应 space 里的 Page label。
// 对照：chrome-shim.mjs（直连专用 Chrome 的同款垫片）。

const BLANK = /^(about:blank|chrome:\/\/new-?tab(-page)?\/?)?$/;

/**
 * @param {object} task  ego-browser 的 TaskSpace（taskSpace()/claimTaskSpace() 的返回值）
 * @returns {{ chrome: object, recoverTabs: (re: RegExp) => Promise<number[]>, pageOf: (tabId: number) => object }}
 */
export function createEgoChrome(task) {
  const windowId = task.spaceId;
  const labelById = new Map();
  const idByLabel = new Map();
  const attached = new Set();
  const detachListeners = [];
  let nextId = 1;
  let reusedFirstPage = false;

  const idOf = (label) => {
    let id = idByLabel.get(label);
    if (id == null) { id = nextId++; idByLabel.set(label, id); labelById.set(id, label); }
    return id;
  };
  const forget = (id) => {
    const label = labelById.get(id);
    labelById.delete(id); idByLabel.delete(label);
    if (attached.delete(id)) for (const fn of detachListeners) { try { fn({ tabId: id }, 'target_closed'); } catch { /* 监听方自己的错 */ } }
  };
  const labelOf = (id) => {
    const label = labelById.get(id);
    if (label == null) throw new Error(`No tab with id: ${id}.`);
    return label;
  };
  const pageOf = (id) => task.page(labelOf(id));
  // space 里这一页还在不在（被用户或页面自己关掉时，忘掉这个 tabId）
  async function liveTab(id) {
    const label = labelOf(id);
    const tab = (await task.tabs()).find((t) => t.label === label);
    if (!tab) { forget(id); throw new Error(`No tab with id: ${id}.`); }
    return tab;
  }
  const info = async (id, tab) => {
    const page = task.page(tab.label);
    return { id, url: await page.url(), title: await page.title(), windowId, active: !!tab.active };
  };

  // 新 space 自带一个空白 p1：第一次 create 时拿来用，不另开一页
  async function blankFirstPage() {
    if (reusedFirstPage) return null;
    reusedFirstPage = true;
    const tab = (await task.tabs()).find((t) => t.label && !idByLabel.has(t.label) && BLANK.test(t.url || ''));
    return tab ? task.page(tab.label) : null;
  }

  const chrome = {
    runtime: { id: 'maitian-ego-shim' },
    scripting: { executeScript: async () => { throw new Error('Ego Lite 垫片不支持 scripting'); } },
    tabs: {
      async create({ url, active = false } = {}) {
        const page = (await blankFirstPage()) ?? (await task.newPage());
        if (url) await page.goto(url);
        if (active) await page.cdp('Page.bringToFront');
        return { id: idOf(page.label), url, windowId };
      },
      async get(id) { return info(id, await liveTab(id)); },
      async query({ active } = {}) {
        const tabs = (await task.tabs()).filter((t) => t.label && (active == null || !!t.active === active));
        return Promise.all(tabs.map((t) => info(idOf(t.label), t)));
      },
      async update(id, { active } = {}) {
        await liveTab(id);
        if (active) await pageOf(id).cdp('Page.bringToFront');
        return { id, windowId };
      },
      async remove(ids) {
        for (const id of [].concat(ids)) {
          if (!labelById.has(id)) continue;
          await pageOf(id).close().catch(() => { /* 已经不在了 */ });
          forget(id);
        }
      },
    },
    debugger: {
      onDetach: { addListener(fn) { detachListeners.push(fn); } },
      async attach({ tabId }) { await liveTab(tabId); attached.add(tabId); },
      async detach({ tabId }) { attached.delete(tabId); },   // 不关页面，后面的回读和提交还要用
      async sendCommand({ tabId }, method, params = {}) { return pageOf(tabId).cdp(method, params); },
    },
  };

  /**
   * 找回：列出 space 里 URL 匹配 re 的页（含上一个进程留下、本进程还没管的，先 adopt），返回本进程可用的 tabId。
   */
  async function recoverTabs(re) {
    const ids = [];
    for (const t of await task.tabs()) {
      if (!re.test(t.url || '')) continue;
      const label = t.label ?? (await task.adopt(t.page)).label;
      ids.push(idOf(label));
    }
    return ids;
  }

  return { chrome, recoverTabs, pageOf };
}
