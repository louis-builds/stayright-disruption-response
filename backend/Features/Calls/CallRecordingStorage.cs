using System.Text.RegularExpressions;
using Amazon;
using Amazon.S3;
using Amazon.S3.Model;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallRecordingStorage(IWebHostEnvironment env, ILogger<CallRecordingStorage> logger)
{
    static readonly Lazy<IAmazonS3> S3 = new(() =>
    {
        var config = new AmazonS3Config
        {
            RegionEndpoint = RegionEndpoint.APSoutheast2,
            Timeout = TimeSpan.FromSeconds(60),
        };
        var endpoint = Environment.GetEnvironmentVariable("S3_ENDPOINT_URL");
        if (!string.IsNullOrWhiteSpace(endpoint)) config.ServiceURL = endpoint;
        return new AmazonS3Client(config);
    });

    public async Task<string> SaveAsync(Guid callId, string fileName, string? contentType, Stream content, CancellationToken ct)
    {
        var ext = Path.GetExtension(fileName);
        if (string.IsNullOrWhiteSpace(ext) || ext.Length > 8)
            ext = contentType?.Contains("webm", StringComparison.OrdinalIgnoreCase) == true ? ".webm"
                : contentType?.Contains("wav", StringComparison.OrdinalIgnoreCase) == true ? ".wav"
                : ".m4a";
        var safeExt = Regex.IsMatch(ext, @"^\.[a-zA-Z0-9]+$") ? ext.ToLowerInvariant() : ".m4a";

        if (CallSettings.RecordingStore == "s3")
        {
            var bucket = CallSettings.S3Bucket!;
            var key = $"call-recordings/{DateTime.UtcNow:yyyyMMdd}/{callId}{safeExt}";
            await S3.Value.PutObjectAsync(new PutObjectRequest
            {
                BucketName = bucket,
                Key = key,
                InputStream = content,
                ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
            }, ct);
            logger.LogInformation("Stored call recording at s3://{Bucket}/{Key}", bucket, key);
            return $"s3:{key}";
        }

        var dir = Path.Combine(env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot"), "call-recordings");
        Directory.CreateDirectory(dir);
        var relativeName = $"{callId}{safeExt}";
        await using var file = File.Create(Path.Combine(dir, relativeName));
        await content.CopyToAsync(file, ct);
        return $"/call-recordings/{relativeName}";
    }

    public string ResolvePlayableUrl(string fileUrl)
    {
        if (!fileUrl.StartsWith("s3:", StringComparison.Ordinal) || string.IsNullOrWhiteSpace(CallSettings.S3Bucket))
            return fileUrl;
        var key = fileUrl["s3:".Length..];
        return S3.Value.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = CallSettings.S3Bucket,
            Key = key,
            Expires = DateTime.UtcNow.AddHours(1),
            Verb = HttpVerb.GET,
        });
    }
}
