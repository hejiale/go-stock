// 用户偏好 / 资产参数（长期记忆的结构化部分）。
//
// 演示用内存 Map，生产换成数据库表（user_profile）即可。

export interface UserProfile {
  userId: string;
  market: string;
  timezone: string;
  /** storage=储能, load=可调负荷, gen=新能源, trader=交易员 */
  assetType: "storage" | "load" | "gen" | "trader";
  /** 风险偏好：影响报告里对 P10/P90 的强调程度 */
  riskPreference: "conservative" | "balanced" | "aggressive";
  capacityMwh?: number;
  powerMw?: number;
  notes?: string;
}

const profiles = new Map<string, UserProfile>();

export function getProfile(userId: string): UserProfile {
  return (
    profiles.get(userId) ?? {
      userId,
      market: "DE-LU",
      timezone: "Europe/Berlin",
      assetType: "trader",
      riskPreference: "balanced",
    }
  );
}

export function upsertProfile(p: UserProfile): void {
  profiles.set(p.userId, p);
}

/** 渲染成提示词片段。 */
export function formatProfile(p: UserProfile): string {
  const lines = [
    `- 默认市场：${p.market}`,
    `- 时区：${p.timezone}`,
    `- 资产类型：${p.assetType}`,
    `- 风险偏好：${p.riskPreference}`,
  ];
  if (p.capacityMwh) lines.push(`- 储能容量：${p.capacityMwh} MWh`);
  if (p.powerMw) lines.push(`- 功率：${p.powerMw} MW`);
  if (p.notes) lines.push(`- 备注：${p.notes}`);
  return lines.join("\n");
}