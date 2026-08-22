namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>
/// 退款强制规则的落地：唯一能让退款"生效"的记录。没有这行记录，退款永远停在"待确认"。
/// 只能由协调员创建（见 CasesController），不存在任何直接把退款标记为"已完成"的接口。
/// </summary>
public class RefundConfirmation
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public Guid? OptionId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "NZD";
    public string Reason { get; set; } = "";
    public Guid ConfirmedByCoordinatorId { get; set; }
    public DateTimeOffset ConfirmedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Case? Case { get; set; }
    public Option? Option { get; set; }
}
