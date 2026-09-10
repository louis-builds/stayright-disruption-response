namespace TravelDisruptionAgent.Api.Features.Push;

public interface IExpoPushSender
{
    Task SendAsync(List<PushMessage> messages, CancellationToken ct = default);
}
