namespace TravelDisruptionAgent.Api.Features.Calls;

public static class CallSettings
{
    public static string RequestedDialer => (Env("CALLS_DIALER") ?? "system").Trim().ToLowerInvariant();

    public static string Dialer
    {
        get
        {
            var wanted = RequestedDialer;
            if (wanted is "twilio" && TwilioSettings.IsConfigured()) return "twilio";
            if (wanted is "mock") return "mock";
            return "system";
        }
    }

    public static string RecordingStore
    {
        get
        {
            var wanted = (Env("CALLS_RECORDING_STORE") ?? "local").Trim().ToLowerInvariant();
            if (wanted is "s3" && !string.IsNullOrWhiteSpace(Env("S3_CALL_RECORDINGS_BUCKET"))) return "s3";
            return "local";
        }
    }

    public static bool VoiceEnabled => Dialer == "twilio" && TwilioSettings.VoiceEnabled;

    public static string? S3Bucket => Env("S3_CALL_RECORDINGS_BUCKET");

    static string? Env(string key) => Environment.GetEnvironmentVariable(key);
}
