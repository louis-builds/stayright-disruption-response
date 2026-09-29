using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator/knowledge-base")]
[Authorize(Roles = "coordinator,admin")]
public class KnowledgeBaseController(IKnowledgeBaseService kb) : ControllerBase
{
    [HttpGet("documents")]
    public async Task<ActionResult<ApiResponse<List<RagDocumentDto>>>> ListDocuments(CancellationToken ct) =>
        Ok(ApiResponse<List<RagDocumentDto>>.Ok(await kb.ListDocumentsAsync(ct)));

    [HttpPost("documents")]
    public async Task<ActionResult<ApiResponse<UploadResultDto>>> Upload([FromBody] UploadDocumentRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(ApiResponse<object?>.Fail(400, "Name and content are required"));
        return Ok(ApiResponse<UploadResultDto>.Ok(await kb.UploadDocumentAsync(request, ct)));
    }

    [HttpPost("documents/{name}/default-version")]
    public async Task<ActionResult<ApiResponse<object?>>> SetDefault(string name, [FromBody] SetDefaultVersionRequest request, CancellationToken ct)
    {
        try
        {
            await kb.SetDefaultVersionAsync(name, request.Version, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Document version not found"));
        }
    }

    [HttpPost("documents/{name}/user-version")]
    public async Task<ActionResult<ApiResponse<object?>>> SetUserVersion(string name, [FromBody] SetUserDocumentVersionRequest request, CancellationToken ct)
    {
        await kb.SetUserDocumentVersionAsync(request.UserId, name, request.Version, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }

    [HttpGet("golden-tests")]
    public async Task<ActionResult<ApiResponse<List<GoldenTestDto>>>> ListGoldenTests(CancellationToken ct) =>
        Ok(ApiResponse<List<GoldenTestDto>>.Ok(await kb.ListGoldenTestsAsync(ct)));

    [HttpPost("golden-tests")]
    public async Task<ActionResult<ApiResponse<object?>>> AddGoldenTest([FromBody] AddGoldenTestRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Input)) return BadRequest(ApiResponse<object?>.Fail(400, "Input is required"));
        await kb.AddGoldenTestAsync(request, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }

    [HttpPost("golden-tests/run")]
    public async Task<ActionResult<ApiResponse<GoldenTestRunDto>>> RunGoldenTests(CancellationToken ct) =>
        Ok(ApiResponse<GoldenTestRunDto>.Ok(await kb.RunGoldenTestsAsync(null, null, ct)));

    [HttpGet("golden-tests/latest-run")]
    public async Task<ActionResult<ApiResponse<GoldenTestRunDto?>>> LatestRun(CancellationToken ct) =>
        Ok(ApiResponse<GoldenTestRunDto?>.Ok(await kb.GetLatestRunAsync(ct)));

    [HttpGet("dashboard")]
    public async Task<ActionResult<ApiResponse<KnowledgeDashboardDto>>> Dashboard(CancellationToken ct) =>
        Ok(ApiResponse<KnowledgeDashboardDto>.Ok(await kb.GetDashboardAsync(ct)));

    /// <summary>ragas 评测用：不做阈值截断，返回 top-k 完整排名。</summary>
    [HttpGet("search")]
    public async Task<ActionResult<ApiResponse<List<RagSearchResultDto>>>> Search(
        [FromQuery] string q, [FromQuery] int topK, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q))
            return BadRequest(ApiResponse<object?>.Fail(400, "q is required"));

        var boundedTopK = topK <= 0 ? 10 : Math.Min(topK, 50);
        return Ok(ApiResponse<List<RagSearchResultDto>>.Ok(await kb.SearchAsync(q, boundedTopK, ct)));
    }
}
