using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TravelDisruptionAgent.Api.Features.Push;

/// <summary>Sends via Expo's push HTTP API (https://exp.host/--/api/v2/push/send), batched at
/// Expo's own 100-message cap. A "DeviceNotRegistered" receipt means the app was uninstalled
/// or the token rotated — that token is deleted so future saves stop trying it.</summary>
public class ExpoPushSender(IHttpClientFactory httpClientFactory, IDeviceTokenRepository tokens, ILogger<ExpoPushSender> logger) : IExpoPushSender
{
    private const int BatchSize = 100;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task SendAsync(List<PushMessage> messages, CancellationToken ct = default)
    {
        if (messages.Count == 0) return;
        var client = httpClientFactory.CreateClient();

        for (var offset = 0; offset < messages.Count; offset += BatchSize)
        {
            var batch = messages.Skip(offset).Take(BatchSize).ToList();
            var body = JsonSerializer.Serialize(batch, JsonOptions);
            using var response = await client.PostAsync(
                "https://exp.host/--/api/v2/push/send",
                new StringContent(body, Encoding.UTF8, "application/json"), ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Expo push batch failed with status {Status}", response.StatusCode);
                continue;
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            var receipt = JsonSerializer.Deserialize<ExpoPushResponse>(json, JsonOptions);
            var tickets = receipt?.Data;
            if (tickets is null) continue;

            for (var i = 0; i < tickets.Count && i < batch.Count; i++)
            {
                if (tickets[i].Details?.Error == "DeviceNotRegistered")
                {
                    await tokens.UnregisterAsync(batch[i].To, ct);
                }
                else if (tickets[i].Status == "error")
                {
                    logger.LogWarning("Expo push error for token {Token}: {Message}", batch[i].To, tickets[i].Message);
                }
            }
        }
    }

    private class ExpoPushResponse
    {
        public List<ExpoPushTicket>? Data { get; set; }
    }

    private class ExpoPushTicket
    {
        public string? Status { get; set; }
        public string? Message { get; set; }
        public ExpoPushTicketDetails? Details { get; set; }
    }

    private class ExpoPushTicketDetails
    {
        public string? Error { get; set; }
    }
}
