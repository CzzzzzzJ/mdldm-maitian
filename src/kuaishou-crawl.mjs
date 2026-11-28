// 账号作品总数包含私密/未发布作品，不能拿公开作品数或 DOM 节点数判断翻页完成。
export async function crawlKuaishouList({ snapshot, advance, wait, attempts = 90 }, { workId } = {}) {
  const seen = new Map();
  let candidateTotal, confirmed = 0, last;
  for (let i = 0; i < attempts; i++) {
    const page = await snapshot();
    if (page?.login) throw new Error('请先登录快手创作者后台');
    if (page && Number.isSafeInteger(page.total) && page.total >= 0) {
      if (page.total !== candidateTotal) { candidateTotal = page.total; seen.clear(); confirmed = 0; }
      for (const card of page.cards) if (card.id) seen.set(card.id, card);
      const match = workId && seen.get(workId);
      if (match?.state === 'public') return match.video;
      if (match?.state === 'private' || match?.state === 'unpublished') return null;
      const unknown = [...seen.values()].filter(card => card.state === 'unknown').length;
      // 零计数还需要明确的空页面，正数则要求 ID 完整且当前卡片都识别成功。
      const complete = !page.loading && (page.total === 0 ? page.empty && !page.cards.length :
        seen.size === page.total && !unknown && page.cards.length > 0 && page.cards.every(card => card.id));
      confirmed = complete ? confirmed + 1 : 0;
      last = { total: page.total, checked: seen.size, unknown };
      if (confirmed >= 2) {
        if (workId) return null;
        const rows = [], skipped = { private: 0, unpublished: 0 };
        for (const card of seen.values()) {
          if (card.state === 'public') rows.push(card.video);
          else skipped[card.state]++;
        }
        return { rows, total: page.total, checked: seen.size, skipped };
      }
      if (!complete && page.cards.length) await advance();
    } else {
      confirmed = 0;
    }
    if (i + 1 < attempts) await wait();
  }
  const progress = last ? `（后台 ${last.total}，已检查 ${last.checked}，未识别 ${last.unknown}）` : '';
  throw new Error('未读到完整作品列表' + progress + '，保留上次采集结果');
}
