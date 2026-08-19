/**
 * 文件描述：图集详情页 GA4 view_item 埋点上报脚本。
 * 日期：2026-07-05
 * 作者：ike
 */

(function () {
  if (typeof window.ga4Track !== 'function') {
    return;
  }

  var payload = window.__latpGa4;
  if (!payload || !payload.item_id) {
    return;
  }

  window.ga4Track('view_item', payload);
})();
