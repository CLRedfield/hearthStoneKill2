// ====================== 武将聚合器 ======================
// 汇总各武将包，对外提供统一接口。新增武将只需在 generals/ 下加文件并在此合并。
import { PACK } from './constants.js';
import { SGS_GENERALS } from './generals/sgs.js';
import { HS_GENERALS } from './generals/hs.js';

// 给每个武将打上所属包标记
for (const g of Object.values(SGS_GENERALS)) g.pack = PACK.SGS;
for (const g of Object.values(HS_GENERALS)) g.pack = PACK.HS;

export const GENERALS = { ...SGS_GENERALS, ...HS_GENERALS };
export const GENERAL_LIST = Object.values(GENERALS);

export function getGeneral(id) {
  return GENERALS[id];
}

// 按武将包返回可用武将 id 列表
export function generalPool(pack = PACK.SGS) {
  return GENERAL_LIST.filter((g) => (g.pack || PACK.SGS) === pack).map((g) => g.id);
}
