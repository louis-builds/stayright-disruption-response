// 后端把升级原因存成中文短语(跟后端 CoordinatorService.EscalationFilterMap 是同一份，改成英文
// 存值会牵动那边的过滤逻辑)，这里只做展示层翻译，不动实际存的值——跟 Web 前端
// frontend/src/features/coordinator/escalationLabels.ts 保持同一份映射，别各写一套。
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
