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
    /// <summary>小段结构化附件(如 {"kind":"room_card", hotel, room_type, room_image_urls, reason})，
    /// 目前只在"确认更便宜候补方案"后的系统消息上使用，前端据 kind 渲染成图文卡片。null=纯文本消息。</summary>
    public string? AttachmentJson { get; set; }
    public string? Vote { get; set; } // like|dislike|null，供 P9 差评分析
    public bool Escalated { get; set; } // AI 回复触发了转人工，供看板"转人工率"统计
    /// <summary>协调员对"被踩+没转人工"的AI回复复核：这条其实该转人工吗。用来补
    /// EscalationReviewedAsReasonable 那份反馈查不出的漏报（该转没转）——那份数据只覆盖真正转了
    /// 人工的案子，测不出阈值定太高的一面。null=还没复核。</summary>
    public bool? MissedEscalationConfirmed { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } // 消息不可编辑，随 ReadAt 变化而更新，满足审计字段规范
    public DateTimeOffset? ReadAt { get; set; }

    public Case? Case { get; set; }
}
