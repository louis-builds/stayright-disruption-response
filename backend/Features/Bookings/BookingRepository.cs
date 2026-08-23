using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Bookings;

public class BookingRepository(AppDbContext db) : IBookingRepository
{
    public Task<List<Booking>> ListForGuestAsync(Guid guestUserId, CancellationToken ct = default) =>
        db.Bookings
            .Include(b => b.Hotel)
            .Include(b => b.RoomType)
            .Include(b => b.GuestUser)
            .Where(b => b.GuestUserId == guestUserId)
            .OrderByDescending(b => b.CheckIn)
            .ToListAsync(ct);

    public Task<Case?> FindLatestCaseForBookingAsync(Guid bookingId, CancellationToken ct = default) =>
        db.Cases.Where(c => c.BookingId == bookingId).OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(ct);

    public Task<RefundConfirmation?> FindRefundConfirmationAsync(Guid caseId, CancellationToken ct = default) =>
        db.RefundConfirmations.FirstOrDefaultAsync(r => r.CaseId == caseId, ct);
}
