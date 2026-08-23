using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Bookings;

public interface IBookingRepository
{
    Task<List<Booking>> ListForGuestAsync(Guid guestUserId, CancellationToken ct = default);
    /// <summary>预订可能被多次中断影响，取最近一条关联案件代表"当前结果"。</summary>
    Task<Case?> FindLatestCaseForBookingAsync(Guid bookingId, CancellationToken ct = default);
    Task<RefundConfirmation?> FindRefundConfirmationAsync(Guid caseId, CancellationToken ct = default);
}
