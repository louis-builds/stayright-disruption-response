using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Faq;

[ApiController]
[Route("api/faq")]
[Authorize]
public class FaqController(IFaqService faqService) : ControllerBase
{
    [HttpGet("top")]
    public async Task<ActionResult<ApiResponse<List<FaqQuestionDto>>>> GetTop(CancellationToken ct) =>
        Ok(ApiResponse<List<FaqQuestionDto>>.Ok(await faqService.GetTopQuestionsAsync(ct)));
}
