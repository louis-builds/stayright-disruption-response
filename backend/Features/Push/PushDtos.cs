namespace TravelDisruptionAgent.Api.Features.Push;

public record RegisterDeviceTokenRequest(string ExpoPushToken, string Platform);

public record PushMessage(string To, string Title, string Body, Dictionary<string, string>? Data = null);
