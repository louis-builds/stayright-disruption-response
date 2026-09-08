using System.ComponentModel.DataAnnotations;

namespace TravelDisruptionAgent.Api.Features.Cases;

public record MessageDto(Guid Id, Guid CaseId, string SenderRole, string Content, string? Vote, string Thread, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt, string? AttachmentJson = null);

public class PostMessageRequest
{
    [Required] public string Content { get; set; } = "";
    [Required, RegularExpression("^(ai|coordinator)$")] public string Thread { get; set; } = "";
}

// /chat 永远隐式 "ai" 线程，不需要客户端传 thread——跟 PostMessageRequest 分开两个类，
// 不然 Thread 上的 [Required] 会让 /chat 的请求体校验失败(前端那边确实不传这个字段)。
public class PostChatMessageRequest
{
    [Required] public string Content { get; set; } = "";
}

public class VoteMessageRequest
{
    [Required, RegularExpression("^(like|dislike)$")] public string Vote { get; set; } = "like";
}

public class ConfirmRefundRequest
{
    [Range(0, double.MaxValue)] public decimal Amount { get; set; }
    [Required] public string Reason { get; set; } = "";
    public Guid? OptionId { get; set; }
}

public record RefundStatusDto(bool Confirmed, decimal? Amount, string? Reason, DateTimeOffset? ConfirmedAt);

public record CaseWorkflowProgressDto(string State, bool Current);

/// <summary>客人首页"我的待办"卡片，也是案件详情页(GetCaseAsync)用的DTO。StatusLabel 是给 UI 直接展示
/// 的人话状态，Status 是原始枚举值。Escalated/UnreadAiCount/UnreadCoordinatorCount 只有 GetCaseAsync
/// 会真正算(案件详情页页签用)，GetMyCasesAsync(首页列表，没有页签)一律填 false/0/0，不为列表页多跑查询。</summary>
public record CaseSummaryDto(
    Guid Id, string Status, string StatusLabel, string Priority,
    string? DisruptionType, string? DisruptionTitle,
    string? HotelName, DateOnly? CheckIn, DateOnly? CheckOut, DateTimeOffset CreatedAt,
    bool Escalated = false, int UnreadAiCount = 0, int UnreadCoordinatorCount = 0,
    Guid? DisruptionId = null, string? DisruptionDescription = null, string? ConfirmationNo = null,
    string? GuestNickname = null, string? GuestAvatarUrl = null, string? GuestEmail = null, string? GuestPhone = null,
    Guid? AssigneeCoordinatorId = null, string? AssigneeNickname = null,
    string? HotelImageUrl = null,
    string? EscalationReason = null, bool? EscalationReviewedAsReasonable = null, string? EscalationReviewNote = null,
    Guid? GuestUserId = null);

public record ReviewEscalationRequest(bool Reasonable, string? Note);

/// <summary>P5 三选项卡片。PayloadJson 原样透传给前端解析（日期/酒店/房型/费用按 option_type 变化，结构不固定）。</summary>
public record OptionDto(Guid Id, string OptionType, string Availability, bool Selected, string PayloadJson, DateTimeOffset CreatedAt, string? CustomTitle, List<string> PerkNames);

public record PolicySummaryDto(string? Excerpt, string? DocName, int? DocVersion, string PayloadJson);

/// <summary>P7 确认执行的结果。outcome: success|processing|failed，对应"已完成/等酒店确认/转人工"三态。</summary>
public record ConfirmExecutionResultDto(
    string Outcome, string Message, string? NewConfirmationNo, DateOnly? NewCheckIn, DateOnly? NewCheckOut);

public record ProposeDeferDatesRequest(DateOnly NewCheckIn, DateOnly NewCheckOut);

/// <summary>客人对默认延期日期不满意时提出别的日期——不管酒店有没有已经批准过默认方案，
/// 都可以重新提，酒店那边会变回待确认。Success=false 时 Message 说明原因(比如案子已结案)。</summary>
public record ProposeDeferDatesResultDto(bool Success, string Message);
