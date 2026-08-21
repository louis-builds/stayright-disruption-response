namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>sender_role: system|ai|guest|coordinator.</summary>
public class Message
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public string SenderRole { get; set; } = "system";
    // ai: 客人跟 AI 的对话(含自动转人工);coordinator: 客人跟协调员的人工对话。两条独立线程，
    // AI 永远不进 coordinator 线程。叫 Thread 不叫 Channel 是为了不跟 Notification.Channel(投递渠道:
    // in_app/email)撞名。
    public string Thread { get; set; } = "ai"; // ai|coordinator
    public string Content { get; set; } = "";
    public string? Vote { get; set; } // like|dislike|null，供 P9 差评分析
    public bool Escalated { get; set; } // AI 回复触发了转人工，供看板"转人工率"统计
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } // 消息不可编辑，随 ReadAt 变化而更新，满足审计字段规范
    public DateTimeOffset? ReadAt { get; set; }

    public Case? Case { get; set; }
}
