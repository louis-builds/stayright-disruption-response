namespace TravelDisruptionAgent.Api.Infrastructure.Storage;

/// <summary>种子 RAG 文档（使用说明.md / 常见问题.md）的读取来源：S3 或本地仓库文件，
/// 由环境变量 RAG_DOC_SOURCE 全局控制，默认 S3。</summary>
public interface IRagDocumentSource
{
    /// <summary>读取一份文档。localFallbackPath 在未配置 S3、或 S3 读取失败时使用——
    /// 本地无 AWS 环境也能跑，跟这个仓库其它 S3 集成（S3PolicyDocumentStorage）同一个原则。</summary>
    Task<string> ReadAsync(string fileName, string localFallbackPath, CancellationToken ct = default);
}
