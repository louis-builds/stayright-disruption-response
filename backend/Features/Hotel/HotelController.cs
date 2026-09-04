using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

[ApiController]
[Route("api/hotel")]
[Authorize(Roles = "hotel")]
public class HotelController(IHotelService hotelService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private async Task<ActionResult<ApiResponse<T>>> HandleAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return new OkObjectResult(ApiResponse<T>.Ok(await action()));
        }
        catch (HotelNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "No hotel is linked to this account"));
        }
        catch (HotelItemNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Not found"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; this option can no longer be changed"));
        }
    }

    [HttpGet("inquiries")]
    public Task<ActionResult<ApiResponse<List<InquiryItemDto>>>> ListInquiries([FromQuery] string? status, CancellationToken ct) =>
        HandleAsync(() => hotelService.ListInquiriesAsync(CurrentUserId, status, ct));

    [HttpPost("inquiries/{id:guid}/confirm")]
    public Task<ActionResult<ApiResponse<object?>>> ConfirmInquiry(Guid id, [FromBody] ConfirmInquiryRequest request, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.ConfirmInquiryAsync(CurrentUserId, id, request, ct); return null; });

    [HttpPost("inquiries/{id:guid}/reject")]
    public Task<ActionResult<ApiResponse<object?>>> RejectInquiry(Guid id, [FromBody] RejectInquiryRequest request, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.RejectInquiryAsync(CurrentUserId, id, request, ct); return null; });

    [HttpGet("selected-options")]
    public Task<ActionResult<ApiResponse<List<SelectedOptionItemDto>>>> ListSelectedOptions(CancellationToken ct) =>
        HandleAsync(() => hotelService.ListSelectedOptionsAsync(CurrentUserId, ct));

    [HttpGet("selected-options/history")]
    public Task<ActionResult<ApiResponse<List<SelectedOptionItemDto>>>> ListSelectedOptionsHistory(CancellationToken ct) =>
        HandleAsync(() => hotelService.ListResolvedOptionsHistoryAsync(CurrentUserId, ct));

    [HttpPost("selected-options/{optionId:guid}/confirm")]
    public Task<ActionResult<ApiResponse<object?>>> ConfirmOption(Guid optionId, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.ConfirmOptionAsync(CurrentUserId, optionId, ct); return null; });

    [HttpPost("selected-options/{optionId:guid}/reject")]
    public Task<ActionResult<ApiResponse<object?>>> RejectOption(Guid optionId, [FromBody] RejectInquiryRequest request, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.RejectOptionAsync(CurrentUserId, optionId, request, ct); return null; });

    [HttpGet("profile")]
    public Task<ActionResult<ApiResponse<HotelProfileDto>>> GetProfile(CancellationToken ct) =>
        HandleAsync(() => hotelService.GetProfileAsync(CurrentUserId, ct));

    [HttpPut("profile")]
    public Task<ActionResult<ApiResponse<object?>>> UpdateProfile([FromBody] UpdateHotelProfileRequest request, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.UpdateProfileAsync(CurrentUserId, request, ct); return null; });

    [HttpGet("profile/refund-policy")]
    public Task<ActionResult<ApiResponse<HotelRefundPolicyDto?>>> GetRefundPolicy(CancellationToken ct) =>
        HandleAsync(() => hotelService.GetRefundPolicyAsync(CurrentUserId, ct));

    [HttpPut("profile/refund-policy")]
    public Task<ActionResult<ApiResponse<HotelRefundPolicyDto>>> UpsertRefundPolicy([FromBody] UpsertHotelRefundPolicyRequest request, CancellationToken ct) =>
        HandleAsync(() => hotelService.UpsertRefundPolicyAsync(CurrentUserId, request, ct));

    [HttpPost("profile/refund-policy/file")]
    [Consumes("multipart/form-data")]
    public Task<ActionResult<ApiResponse<HotelRefundPolicyDto>>> UploadRefundPolicyFile(
        [FromForm] UploadRefundPolicyFileRequest request, IFormFile file, CancellationToken ct) =>
        HandleAsync(() => hotelService.UploadRefundPolicyFileAsync(CurrentUserId, file, request, ct));

    [HttpPost("profile/refund-policy/extract")]
    public Task<ActionResult<ApiResponse<ExtractedRefundRulesDto>>> ExtractRefundRules([FromBody] ExtractRefundRulesRequest request, CancellationToken ct) =>
        HandleAsync(() => hotelService.ExtractRefundRulesAsync(CurrentUserId, request, ct));

    [HttpPost("profile/room-types")]
    public Task<ActionResult<ApiResponse<RoomTypeDto>>> AddRoomType([FromBody] UpsertRoomTypeRequest request, CancellationToken ct) =>
        HandleAsync(() => hotelService.AddRoomTypeAsync(CurrentUserId, request, ct));

    [HttpPut("profile/room-types/{id:guid}")]
    public Task<ActionResult<ApiResponse<object?>>> UpdateRoomType(Guid id, [FromBody] UpsertRoomTypeRequest request, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.UpdateRoomTypeAsync(CurrentUserId, id, request, ct); return null; });

    [HttpDelete("profile/room-types/{id:guid}")]
    public Task<ActionResult<ApiResponse<object?>>> DeleteRoomType(Guid id, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.DeleteRoomTypeAsync(CurrentUserId, id, ct); return null; });

    [HttpPost("profile/perks")]
    public Task<ActionResult<ApiResponse<HotelPerkDto>>> AddPerk([FromBody] AddHotelPerkRequest request, CancellationToken ct) =>
        HandleAsync(() => hotelService.AddPerkAsync(CurrentUserId, request, ct));

    [HttpDelete("profile/perks/{id:guid}")]
    public Task<ActionResult<ApiResponse<object?>>> DeletePerk(Guid id, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.DeletePerkAsync(CurrentUserId, id, ct); return null; });

    [HttpPut("options/{optionId:guid}/perks")]
    public Task<ActionResult<ApiResponse<object?>>> SetOptionPerks(Guid optionId, [FromBody] SetOptionPerksRequest request, CancellationToken ct) =>
        HandleAsync<object?>(async () => { await hotelService.SetOptionPerksAsync(CurrentUserId, optionId, request, ct); return null; });

    [HttpPost("cases/{caseId:guid}/custom-option")]
    public Task<ActionResult<ApiResponse<SelectedOptionItemDto>>> CreateCustomOption(Guid caseId, [FromBody] CreateCustomOptionRequest request, CancellationToken ct) =>
        HandleAsync(() => hotelService.CreateCustomOptionAsync(CurrentUserId, caseId, request, ct));
}
