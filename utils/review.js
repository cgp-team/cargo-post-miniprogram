/**
 * 承运审核 reasonCode → 文案映射（与后端 ReviewReasonCodeEnum 对齐，禁止在页面散落硬编码）。
 * 后端只返回原因码，前端统一在此映射文案。
 */
const REASON_TEXT_MAP = {
  PROHIBITED_GOODS: '禁运品',
  DANGEROUS_GOODS: '危险品',
  OVER_WEIGHT: '超重',
  OVER_SIZE: '超尺寸',
  ROAD_UNREACHABLE: '道路不可达',
  DETOUR_TOO_LARGE: '绕行代价过大',
  PASSENGER_SERVICE_CONFLICT: '与客运服务冲突',
  NO_SAFE_HANDOFF_POINT: '无安全交接点',
  CUSTOMER_ACTION_REQUIRED: '需您到指定站点交接',
  MANUAL_REVIEW_REQUIRED: '需人工确认'
}

/** 逗号分隔原因码字符串 → 中文文案（如 "危险品、超重"）；空串返回 '' */
function reasonText(reasonCodes) {
  if (!reasonCodes) return ''
  return reasonCodes
    .split(',')
    .filter(Boolean)
    .map((code) => REASON_TEXT_MAP[code] || code)
    .join('、')
}

module.exports = { REASON_TEXT_MAP, reasonText }
