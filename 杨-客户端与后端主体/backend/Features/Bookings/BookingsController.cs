using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Bookings;

[ApiController]
[Route("api/bookings")]
[Authorize(Roles = "guest")]
public class BookingsController(IBookingService bookingService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("mine")]
    public async Task<ActionResult<ApiResponse<List<BookingSummaryDto>>>> GetMine(CancellationToken ct)
    {
        var list = await bookingService.GetMyBookingsAsync(CurrentUserId, ct);
        return Ok(ApiResponse<List<BookingSummaryDto>>.Ok(list));
    }
}
