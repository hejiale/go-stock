// 欧洲主要 bidding zone 元数据。
// - code 对应 Energy-Charts 的 bzn 参数
// - 坐标用于 Open-Meteo 气象查询（取该区域代表城市）
// - 时区用于展示与日期边界

export interface Region {
  code: string;
  name: string;
  timezone: string;
  lat: number;
  lon: number;
  /** ENTSO-E EIC code（可选，用于 A65 负荷预测） */
  eic?: string;
}

export const REGIONS: Record<string, Region> = {
  "DE-LU": { code: "DE-LU", name: "德国/卢森堡", timezone: "Europe/Berlin", lat: 52.52, lon: 13.405, eic: "10Y1001A1001A82H" },
  FR: { code: "FR", name: "法国", timezone: "Europe/Paris", lat: 48.8566, lon: 2.3522, eic: "10YFR-RTE------C" },
  NL: { code: "NL", name: "荷兰", timezone: "Europe/Amsterdam", lat: 52.3676, lon: 4.9041, eic: "10YNL----------L" },
  BE: { code: "BE", name: "比利时", timezone: "Europe/Brussels", lat: 50.8503, lon: 4.3517, eic: "10YBE----------2" },
  AT: { code: "AT", name: "奥地利", timezone: "Europe/Vienna", lat: 48.2082, lon: 16.3738, eic: "10YAT-APG------L" },
  ES: { code: "ES", name: "西班牙", timezone: "Europe/Madrid", lat: 40.4168, lon: -3.7038, eic: "10YES-REE------0" },
  PT: { code: "PT", name: "葡萄牙", timezone: "Europe/Lisbon", lat: 38.7223, lon: -9.1393, eic: "10YPT-REN------W" },
  "IT-NORD": { code: "IT-NORD", name: "意大利北部", timezone: "Europe/Rome", lat: 45.4642, lon: 9.19, eic: "10Y1001A1001A73I" },
  NO1: { code: "NO1", name: "挪威 NO1", timezone: "Europe/Oslo", lat: 59.9139, lon: 10.7522, eic: "10YNO-1--------2" },
  NO2: { code: "NO2", name: "挪威 NO2", timezone: "Europe/Oslo", lat: 58.1467, lon: 7.9956, eic: "10YNO-2--------T" },
  NO3: { code: "NO3", name: "挪威 NO3", timezone: "Europe/Oslo", lat: 63.4305, lon: 10.3951, eic: "10YNO-3--------J" },
  NO4: { code: "NO4", name: "挪威 NO4", timezone: "Europe/Oslo", lat: 69.6492, lon: 18.9553, eic: "10YNO-4--------9" },
  NO5: { code: "NO5", name: "挪威 NO5", timezone: "Europe/Oslo", lat: 60.3913, lon: 5.3221, eic: "10Y1001A1001A48H" },
  SE1: { code: "SE1", name: "瑞典 SE1", timezone: "Europe/Stockholm", lat: 67.8558, lon: 20.2253, eic: "10Y1001A1001A44P" },
  SE2: { code: "SE2", name: "瑞典 SE2", timezone: "Europe/Stockholm", lat: 62.3908, lon: 17.3069, eic: "10Y1001A1001A45N" },
  SE3: { code: "SE3", name: "瑞典 SE3", timezone: "Europe/Stockholm", lat: 59.3293, lon: 18.0686, eic: "10Y1001A1001A46L" },
  SE4: { code: "SE4", name: "瑞典 SE4", timezone: "Europe/Stockholm", lat: 55.605, lon: 13.0038, eic: "10Y1001A1001A47J" },
  DK1: { code: "DK1", name: "丹麦 DK1", timezone: "Europe/Copenhagen", lat: 55.6761, lon: 12.5683, eic: "10YDK-1--------W" },
  DK2: { code: "DK2", name: "丹麦 DK2", timezone: "Europe/Copenhagen", lat: 55.6761, lon: 12.5683, eic: "10YDK-2--------M" },
  FI: { code: "FI", name: "芬兰", timezone: "Europe/Helsinki", lat: 60.1699, lon: 24.9384, eic: "10YFI-1--------U" },
  PL: { code: "PL", name: "波兰", timezone: "Europe/Warsaw", lat: 52.2297, lon: 21.0122, eic: "10YPL-AREA-----S" },
  CZ: { code: "CZ", name: "捷克", timezone: "Europe/Prague", lat: 50.0755, lon: 14.4378, eic: "10YCZ-CEPS-----N" },
  HU: { code: "HU", name: "匈牙利", timezone: "Europe/Budapest", lat: 47.4979, lon: 19.0402, eic: "10YHU-MAVIR----U" },
  // 英国不在欧洲日前耦合市场（SDAC）内，价格走 Elexon MID（非日前拍卖）
  GB: { code: "GB", name: "英国（N2EX 日前）", timezone: "Europe/London", lat: 51.5074, lon: -0.1278 },
};

export const DEFAULT_ZONE = "DE-LU";

export function resolveRegion(code?: string): Region {
  const key = (code ?? DEFAULT_ZONE).trim().toUpperCase();
  const region = REGIONS[key];
  if (!region) {
    throw new Error(
      `未知市场 ${code}。可用：${Object.keys(REGIONS).join(", ")}`
    );
  }
  return region;
}

export function listRegions(): Region[] {
  return Object.values(REGIONS);
}