namespace TravelDisruptionAgent.Api.Features.Bookings;

public class BookingService(IBookingRepository bookings) : IBookingService
{
    public async Task<List<BookingSummaryDto>> GetMyBookingsAsync(Guid guestUserId, CancellationToken ct = default)
    {
        var list = await bookings.ListForGuestAsync(guestUserId, ct);
        var result = new List<BookingSummaryDto>();

        foreach (var b in list)
        {
            var latestCase = await bookings.FindLatestCaseForBookingAsync(b.Id, ct);
            var refund = latestCase is null ? null : await bookings.FindRefundConfirmationAsync(latestCase.Id, ct);

            result.Add(new BookingSummaryDto(
                b.Id, b.ConfirmationNo, b.Status,
                b.Hotel?.Name ?? "", b.RoomType?.Name ?? "", b.CheckIn, b.CheckOut,
                b.GuestsCount, b.TotalAmount, b.Currency,
                b.GuestUser?.Nickname ?? "", b.GuestUser?.Phone ?? "",
                latestCase?.Id, latestCase?.Status, latestCase?.CloseReason,
                refund is not null, refund?.Amount, b.UpdatedAt));
        }

        return result;
    }
}
