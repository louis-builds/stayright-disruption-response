// 后端把升级原因存成中文短语(跟 EscalationFilterMap 是同一份，改成英文存值会牵动那边的过滤逻辑)，
// 这里只做展示层翻译，不动实际存的值。CoordinatorHomePage 和 DisruptionsPanel 都要用，
// 放共享文件避免两边互相 import 出循环依赖。
const ESCALATION_REASON_LABELS: Record<string, string> = {
  客人拒绝全部方案: "Guest rejected all options",
  必须人工: "Must be manual",
  AI搞不定: "AI stuck",
  AI没把握: "AI low confidence",
  客人情绪激动: "Guest sounds frustrated",
  高风险: "High risk",
  无可用候补或全拒方案: "No available options left",
};

export function escalationReasonLabel(reason: string) {
  return ESCALATION_REASON_LABELS[reason] ?? reason;
}
