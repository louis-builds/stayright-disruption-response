using System.ComponentModel;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;
using TravelDisruptionAgent.Api.Infrastructure.Data;

namespace TravelDisruptionAgent.Api.Features.Mcp;

[McpServerToolType]
public class HotelPolicyTools(AppDbContext db)
{
    [McpServerTool, Description("Get a hotel's cancellation/rebooking policy text for a guest's question.")]
    public async Task<string> GetCancellationPolicy(Guid hotelId, string question)
    {
        var content = await db.HotelRefundPolicies
            .Where(p => p.HotelId == hotelId && p.IsActive)
            .Select(p => p.Content)
            .FirstOrDefaultAsync();

        return content ?? $"No cancellation policy on file for hotel {hotelId}.";
    }
}
