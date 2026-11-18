// 在 ego-browser nodejs 里运行：按名字取用 task space（有就接着用，没有才在指定 profile 上新建）。
// 只取用、不建 profile；Profile 6 一律拒绝。
export const FORBIDDEN_PROFILE = 'Profile 6';

/**
 * @param {{ listTaskSpaces: Function, taskSpace: Function, claimTaskSpace: Function }} ego  ego-browser 提供的全局函数
 * @param {{ name: string, profileId: string }} opts
 */
export async function openSpace(ego, { name, profileId }) {
  if (!profileId || profileId === FORBIDDEN_PROFILE) throw new Error(`不允许使用 ${profileId || '默认 profile'}`);
  const found = (await ego.listTaskSpaces()).find((s) => s.name === name);
  if (!found) return ego.taskSpace(name, { profileId });
  if (found.profileId !== profileId) throw new Error(`space ${name} 在 ${found.profileId} 上，不是 ${profileId}`);
  if (found.ownership === 'agent') return ego.taskSpace(found.id);
  if (found.ownership === 'user') return ego.claimTaskSpace(found.id);
  throw new Error(`space ${name} 现在由用户控制（ownership=${found.ownership}），不接管`);
}
