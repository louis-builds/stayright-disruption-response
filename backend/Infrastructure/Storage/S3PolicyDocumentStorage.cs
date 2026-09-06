using System.Text.RegularExpressions;
using Amazon;
using Amazon.S3;
using Amazon.S3.Model;

namespace TravelDisruptionAgent.Api.Infrastructure.Storage;

/// <summary>S3 实现：桶名 env S3_POLICY_BUCKET，区域固定 ap-southeast-2，凭证走默认链
/// （本机 AWS 凭证 / EC2 实例角色）。本地联调可设 S3_ENDPOINT_URL 指到 MinIO/LocalStack。
/// 客户端做成进程级单例，与 GeminiClient 里的 Bedrock 一致。</summary>
public class S3PolicyDocumentStorage(ILogger<S3PolicyDocumentStorage> logger) : IPolicyDocumentStorage
{
    private static readonly Lazy<IAmazonS3> S3 = new(() =>
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

    private static string? Bucket => Environment.GetEnvironmentVariable("S3_POLICY_BUCKET");

    public async Task<string?> UploadAsync(Guid hotelId, Guid policyId, string fileName, string? contentType, Stream content, CancellationToken ct = default)
    {
        var bucket = Bucket;
        if (string.IsNullOrWhiteSpace(bucket))
        {
            logger.LogInformation("S3_POLICY_BUCKET not configured; skipping policy file archival for hotel {HotelId}", hotelId);
            return null;
        }

        var key = $"hotel-policies/{hotelId}/{DateTime.UtcNow:yyyyMMdd}/{policyId}-{Sanitize(fileName)}";
        var request = new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = content,
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
        };
        await S3.Value.PutObjectAsync(request, ct);
        logger.LogInformation("Archived policy file to s3://{Bucket}/{Key}", bucket, key);
        return key;
    }

    public string? CreatePresignedGetUrl(string key, TimeSpan expiry)
    {
        var bucket = Bucket;
        if (string.IsNullOrWhiteSpace(bucket) || string.IsNullOrWhiteSpace(key)) return null;
        try
        {
            return S3.Value.GetPreSignedURL(new GetPreSignedUrlRequest
            {
                BucketName = bucket,
                Key = key,
                Expires = DateTime.UtcNow.Add(expiry),
                Verb = HttpVerb.GET,
            });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to create presigned URL for s3://{Bucket}/{Key}", bucket, key);
            return null;
        }
    }

    // S3 key 里不能有空格/中文/路径分隔符之类，只留安全字符，长度截断防止超长 key。
    private static string Sanitize(string fileName)
    {
        var name = Path.GetFileName(fileName);
        name = Regex.Replace(name, "[^a-zA-Z0-9._-]", "_");
        return name.Length <= 80 ? name : name[..80];
    }
}
