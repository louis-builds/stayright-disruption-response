namespace TravelDisruptionAgent.Api.Infrastructure.Storage;

/// <summary>酒店政策原始文件的归档存储。上传的文件解析完文本后把原件存这里，DB 只存 key。
/// 未配置 S3_POLICY_BUCKET 时全部方法退化为 no-op（返回 null），本地无 AWS 环境也能跑。</summary>
public interface IPolicyDocumentStorage
{
    /// <summary>上传原始文件，返回 S3 object key；未配置桶时返回 null。</summary>
    Task<string?> UploadAsync(Guid hotelId, Guid policyId, string fileName, string? contentType, Stream content, CancellationToken ct = default);

    /// <summary>生成预签名 GET URL；无 key 或未配置桶时返回 null。</summary>
    string? CreatePresignedGetUrl(string key, TimeSpan expiry);
}
