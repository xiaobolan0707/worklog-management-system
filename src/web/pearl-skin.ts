/**
 * 珍珠玻璃换皮开关（本地预览用）
 *
 * 只做两件事：把皮肤写到 <body data-skin>，以及在顶栏注入一个切换开关。
 * 不改任何现有组件，也不触碰业务数据；偏好记在 localStorage，刷新后保持。
 * 默认 current（森林绿现有外观），需要对比时可一键切到珍珠玻璃。
 * 使用 v2 键是为了让此前预览时写入的 pearl 偏好失效，确保回到森林绿。
 */

const STORAGE_KEY = "worklog.skin.v2";
type Skin = "current" | "pearl";

function readSkin(): Skin {
  try {
    return localStorage.getItem(STORAGE_KEY) === "pearl" ? "pearl" : "current";
  } catch {
    return "current";
  }
}

function applySkin(skin: Skin): void {
  document.body.dataset.skin = skin;
  try {
    localStorage.setItem(STORAGE_KEY, skin);
  } catch {
    // 隐私模式下 localStorage 不可用时，仅保留本次会话的皮肤状态。
  }
  document.querySelectorAll<HTMLButtonElement>(".skin-switch button[data-skin]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.skin === skin));
  });
}

function injectSwitch(): void {
  const host = document.querySelector<HTMLElement>(".top-actions");
  if (!host || host.querySelector(".skin-switch")) return;

  const group = document.createElement("div");
  group.className = "skin-switch";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "外观切换");
  group.innerHTML =
    '<button type="button" data-skin="current">森林绿</button>' +
    '<button type="button" data-skin="pearl">珍珠玻璃</button>';
  group.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-skin]");
    if (!button || (button.dataset.skin !== "current" && button.dataset.skin !== "pearl")) return;
    applySkin(button.dataset.skin);
  });

  host.prepend(group);
  applySkin(readSkin());
}

// 尽早落盘 data-skin，避免首屏闪一下旧外观。
applySkin(readSkin());

// React 路由切换会重建顶栏，用观察器保证开关始终存在。
const observer = new MutationObserver(() => injectSwitch());
observer.observe(document.body, { childList: true, subtree: true });
injectSwitch();

export {};
