/**
 * 记录本次页面会话内有没有发生过站内跳转，供返回按钮决定是
 * router.back()（回真实的上一页）还是 router.push()（回上级页面）。
 *
 * 为什么不用 window.history.length > 1：用户从搜索结果或微信点链接进来时它
 * 同样 ≥ 2，此时 back() 会把用户踢出站点——这正是要避免的失败。
 *
 * 为什么是模块级变量而不是组件里的 ref：AppChrome 分别挂在 (app) 与 (static)
 * 两个路由组下，跨组导航会让整棵 chrome 子树重新挂载，组件内的计数会归零，
 * 把刚刚的站内跳转误判成外部直入。模块级状态不受重挂载影响，而真正的整页
 * 刷新会重新加载模块、自然归零——语义正好吻合。
 */

let lastPath: string | null = null;
let navigatedInApp = false;

/**
 * 每次路径变化时调用（含组件重新挂载后的首次渲染）。
 *
 * 判定靠「和上一次记录的路径比对」而不是「首次挂载时跳过」：后者在跨路由组
 * 重挂载时，会把那一次真实的站内跳转当成首次而漏记。
 */
export function recordPath(pathname: string): void {
  if (lastPath !== null && lastPath !== pathname) {
    navigatedInApp = true;
  }
  lastPath = pathname;
}

/** 本次页面会话内是否发生过站内跳转——为真时 router.back() 才是安全的。 */
export function hasInAppHistory(): boolean {
  return navigatedInApp;
}

/**
 * 返回按钮自己发起的「退到上级」跳转。
 *
 * 它不是用户的站内浏览，不能记成历史：记了的话，随后的 effect 会把
 * navigatedInApp 置为 true，下一次按返回就会 back() 回到用户刚离开的
 * 那一页，来回打转，再按一次甚至直接退出站点。
 *
 * 先把 lastPath 设成即将跳到的路径，随后 effect 里的 recordPath 就是
 * 同路径调用、不会计数。
 */
export function recordSyntheticBack(pathname: string): void {
  lastPath = pathname;
  navigatedInApp = false;
}

/** 仅供测试：模块级状态在同一个 vitest 进程内会跨用例残留。 */
export function resetInAppHistoryForTests(): void {
  lastPath = null;
  navigatedInApp = false;
}
