using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Cases;

public interface ICaseService
{
    Task<PagedResult<MessageDto>> GetMessagesAsync(Guid caseId, Guid userId, string userRole, string thread, int page, int pageSize, CancellationToken ct = default);
    Task<MessageDto> PostMessageAsync(Guid caseId, Guid userId, string userRole, string content, string thread, CancellationToken ct = default);
    Task<List<MessageDto>> PostChatMessageAsync(Guid caseId, Guid guestUserId, string content, CancellationToken ct = default);
    Task VoteMessageAsync(Guid caseId, Guid messageId, Guid userId, string userRole, string vote, CancellationToken ct = default);
    Task MarkThreadReadAsync(Guid caseId, Guid userId, string userRole, string thread, CancellationToken ct = default);
    Task MarkMessageReadAsync(Guid caseId, Guid messageId, Guid userId, string userRole, CancellationToken ct = default);
    Task ConfirmRefundAsync(Guid caseId, Guid coordinatorId, decimal amount, string reason, Guid? optionId, CancellationToken ct = default);
    Task<RefundStatusDto> GetRefundStatusAsync(Guid caseId, CancellationToken ct = default);
    Task<List<CaseSummaryDto>> GetMyCasesAsync(Guid guestUserId, bool includeClosed, CancellationToken ct = default);
    Task<CaseSummaryDto> GetCaseAsync(Guid caseId, Guid userId, string userRole, CancellationToken ct = default);
    Task<List<OptionDto>> GetOptionsAsync(Guid caseId, Guid userId, string userRole, CancellationToken ct = default);
    Task SelectOptionAsync(Guid caseId, Guid optionId, Guid userId, string userRole, CancellationToken ct = default);
    Task<ConfirmExecutionResultDto> ConfirmExecutionAsync(Guid caseId, Guid optionId, Guid userId, string userRole, CancellationToken ct = default);
    Task<ConfirmExecutionResultDto?> ResolveOptionAvailableAsync(Guid caseId, Guid optionId, CancellationToken ct = default);
    Task<PolicySummaryDto> GetPolicySummaryAsync(Guid caseId, Guid optionId, Guid userId, string userRole, CancellationToken ct = default);
    /// <summary>酒店对询单(Inquiry)做出确认/拒绝决定后调用——独立于案件里有没有 defer 类型 Option,
    /// 通知这件事不该依赖那个偶然条件（Hotel 用"custom option"响应时就没有 defer Option）。</summary>
    Task NotifyGuestOfInquiryDecisionAsync(Guid caseId, bool accepted, string? rejectReason, CancellationToken ct = default);
}
