namespace TravelDisruptionAgent.Api.Features.Bookings;

public interface IBookingService
{
    Task<List<BookingSummaryDto>> GetMyBookingsAsync(Guid guestUserId, CancellationToken ct = default);
}
