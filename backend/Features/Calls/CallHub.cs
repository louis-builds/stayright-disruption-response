using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace TravelDisruptionAgent.Api.Features.Calls;

[Authorize(AuthenticationSchemes = CallSignalingAuthentication.SchemeName, Roles = "coordinator,guest")]
public class CallHub(ICallService callService) : Hub
{
    public static string GroupName(Guid callId) => $"call:{callId}";

    public async Task JoinCall(Guid callId)
    {
        await EnsureParticipantAsync(callId);
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(callId));
    }

    public Task LeaveCall(Guid callId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(callId));

    public async Task SendOffer(Guid callId, string sdp)
    {
        await EnsureSignalingAsync(callId, "coordinator");
        if (string.IsNullOrWhiteSpace(sdp) || sdp.Length > 24000) throw new HubException("Invalid offer");
        await Clients.OthersInGroup(GroupName(callId)).SendAsync("ReceiveOffer", new { callId, sdp });
    }

    public async Task SendAnswer(Guid callId, string sdp)
    {
        await EnsureSignalingAsync(callId, "guest");
        if (string.IsNullOrWhiteSpace(sdp) || sdp.Length > 24000) throw new HubException("Invalid answer");
        await Clients.OthersInGroup(GroupName(callId)).SendAsync("ReceiveAnswer", new { callId, sdp });
    }

    public async Task SendIceCandidate(Guid callId, object candidate)
    {
        await EnsureSignalingAsync(callId);
        await Clients.OthersInGroup(GroupName(callId)).SendAsync("ReceiveIceCandidate", new { callId, candidate });
    }

    private async Task EnsureParticipantAsync(Guid callId)
    {
        var userIdValue = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        var role = Context.User?.FindFirstValue(ClaimTypes.Role);
        if (!Guid.TryParse(userIdValue, out var userId)
            || role is null
            || !await callService.CanAccessAsync(callId, userId, role, Context.ConnectionAborted))
        {
            throw new HubException("You are not a participant in this call");
        }
    }

    private async Task EnsureSignalingAsync(Guid callId, string? requiredRole = null)
    {
        await EnsureParticipantAsync(callId);
        var role = Context.User!.FindFirstValue(ClaimTypes.Role)!;
        if (requiredRole is not null && role != requiredRole) throw new HubException("Invalid signaling role");
        var call = await callService.GetAsync(callId,
            Guid.Parse(Context.User!.FindFirstValue(ClaimTypes.NameIdentifier)!), role, Context.ConnectionAborted);
        if (call.Status != "in_progress") throw new HubException("Call is not active");
    }
}
