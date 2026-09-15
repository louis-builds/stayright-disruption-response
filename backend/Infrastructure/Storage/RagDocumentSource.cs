using Amazon;
using Amazon.S3;
using Amazon.S3.Model;

namespace TravelDisruptionAgent.Api.Infrastructure.Storage;

/// <summary>桶名 env S3_RAG_DOCS_BUCKET，区域固定 ap-southeast-2，凭证走默认链——同一套约定见
/// S3PolicyDocumentStorage。RAG_DOC_SOURCE=local 或桶未配置或读取失败时都退回本地种子文件，
/// 未设置 RAG_DOC_SOURCE 时默认 "s3"。客户端做成进程级单例。</summary>
public class RagDocumentSource(ILogger<RagDocumentSource> logger) : IRagDocumentSource
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

    private static string? Bucket => Environment.GetEnvironmentVariable("S3_RAG_DOCS_BUCKET");

    private static bool UseS3 =>
        (Environment.GetEnvironmentVariable("RAG_DOC_SOURCE") ?? "s3").Equals("s3", StringComparison.OrdinalIgnoreCase);

    public async Task<string> ReadAsync(string fileName, string localFallbackPath, CancellationToken ct = default)
    {
        var bucket = Bucket;
        if (UseS3 && !string.IsNullOrWhiteSpace(bucket))
        {
            try
            {
                using var response = await S3.Value.GetObjectAsync(new GetObjectRequest { BucketName = bucket, Key = $"rag-docs/{fileName}" }, ct);
                using var reader = new StreamReader(response.ResponseStream);
                return await reader.ReadToEndAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Failed to read {FileName} from s3://{Bucket}/rag-docs/, falling back to local seed file", fileName, bucket);
            }
        }
        return await File.ReadAllTextAsync(localFallbackPath, ct);
    }
}
