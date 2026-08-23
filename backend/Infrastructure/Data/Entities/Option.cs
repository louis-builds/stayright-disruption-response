namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>option_type: defer|alternate|cancel; availability: pending|available|unavailable.
/// payload 是 jsonb，内容按 option_type 变化（日期/酒店/房型/费用）。</summary>
public class Option
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public string OptionType { get; set; } = "defer";
    public string PayloadJson { get; set; } = "{}";
    public string Availability { get; set; } = "pending";
    public bool Selected { get; set; }
    public bool Locked { get; set; }
    public string? UnavailableReason { get; set; }
    /// <summary>option_type == "custom" 时的展示标题(酒店自定义方案，比如"免费升级房型")；
    /// 标准三类型(defer/alternate/cancel)标题走前端固定映射，这个字段留空。</summary>
    public string? CustomTitle { get; set; }
    /// <summary>酒店附加的权益快照(免费早餐等)，来自 HotelPerk 目录选取时拷贝的名字，见 HotelPerk 注释。</summary>
    public List<string> PerkNames { get; set; } = [];
    /// <summary>客人在P7点了"确认执行"、系统实际发起询问酒店的时间(不是P5单纯选中)。
    /// H2"客人已选定方案"待办必须按这个字段来判断,不能按Selected判断——只选未确认不能打扰酒店。</summary>
    public DateTimeOffset? ExecutionRequestedAt { get; set; }
    /// <summary>null=跟着 AI 政策判断走(目前只对 cancel 类型生效)；true/false=协调员手动强制显示/隐藏，覆盖 AI。</summary>
    public bool? CoordinatorVisibilityOverride { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Case? Case { get; set; }
}
