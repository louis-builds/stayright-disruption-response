using System.ComponentModel;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using TravelDisruptionAgent.Api.Infrastructure.Data;

namespace TravelDisruptionAgent.Api.Features.Mcp;

[McpServerToolType]
public class HotelPolicyTools(AppDbContext db)
{
    [McpServerTool, Description("Get a hotel's cancellation/rebooking policy text for a guest's question. hotelId must be the booking's hotel_id, a UUID string.")]
    public async Task<string> GetCancellationPolicy(string hotelId, string question)
    {
        // hotelId comes from the model's tool call, not a validated system boundary -- a
        // malformed string here must not become an unhandled 500, it should read like any
        // other tool result so the calling agent can see what went wrong and retry.
        if (!Guid.TryParse(hotelId, out var parsedHotelId))
        {
            return $"Invalid hotelId '{hotelId}': expected a UUID.";
        }

        var content = await db.HotelRefundPolicies
            .Where(p => p.HotelId == parsedHotelId && p.IsActive)
            .Select(p => p.Content)
            .FirstOrDefaultAsync();

        return content ?? $"No cancellation policy on file for hotel {hotelId}.";
    }
}
