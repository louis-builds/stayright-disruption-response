namespace TravelDisruptionAgent.Api.Features.Calls;

public static class TwilioSettings
{
    public static string? AccountSid => Env("TWILIO_ACCOUNT_SID");
    public static string? AuthToken => Env("TWILIO_AUTH_TOKEN");
    public static string? ApiKeySid => Env("TWILIO_API_KEY_SID");
    public static string? ApiKeySecret => Env("TWILIO_API_KEY_SECRET");
    public static string? TwimlAppSid => Env("TWILIO_TWIML_APP_SID");
    public static string? FromNumber => Env("TWILIO_FROM_NUMBER");
    public static string? WebhookBaseUrl => Env("TWILIO_WEBHOOK_BASE_URL")?.TrimEnd('/');
    public static string? CoordinatorOverride => Env("TWILIO_COORDINATOR_NUMBER");
    public static string? CalleeOverride => Env("TWILIO_CALLEE_NUMBER");

    public static bool IsConfigured() =>
        Has(AccountSid) && Has(AuthToken) && Has(FromNumber) && Has(WebhookBaseUrl);

    public static bool VoiceEnabled =>
        IsConfigured() && Has(ApiKeySid) && Has(ApiKeySecret) && Has(TwimlAppSid);

    public static bool SkipSignatureValidation =>
        Env("TWILIO_SKIP_SIGNATURE_VALIDATION") == "true";

    public static string Absolute(string path) => $"{WebhookBaseUrl}{path}";

    public static string ProviderName => IsConfigured() ? "twilio" : "mock";

    static bool Has(string? value) => !string.IsNullOrWhiteSpace(value);

    static string? Env(string key) => Environment.GetEnvironmentVariable(key);
}
