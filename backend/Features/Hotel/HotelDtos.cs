namespace TravelDisruptionAgent.Api.Features.HotelPortal;

// IsReturningGuest: 在这家酒店本身≥2单(HotelRepository)。IsHighValueGuest: 平台口径,近12个月≥2单且
// 累计消费≥NZD 1000(CoordinatorRepository/DisruptionRepository 同一套)。两个概念不同,标签颜色也不同。
// FinalOutcome: 案件结案后，客人最终有没有留在这家酒店("stayed"/"moved")——酒店点了 Accept 之后
// 案子会继续往下走(客人后续可能选了别的方案换到别家)，H1 这条请求本身的 Status 永远停在
// accepted 不会变，不看这个字段的话酒店无从知道自己批的方案最终有没有真被用上。还没结案时是 null。
// ProposedNewCheckIn/Out: 酒店点 Confirm 之前，案子往往还没有真正的 defer 方案草稿——新日期要等
// 确认之后系统才按固定规则(3 天后入住、保持原住宿晚数，见 OptionsAdminService.BuildDraftOptionsAsync
// 的 defer 分支)现造出来。这里用同一套规则提前算一遍给酒店预览，不然它是在盲批一个看不到
// 具体日期的请求。真实生效日期取决于"到底哪天被确认"，这两个字段只是预估，不是锁定值。
// GuestCommitted: 客人已对这个 case 的 defer 方案点过 P7 确认(ExecutionRequestedAt!=null)。pending 的
// H1 卡靠它把"请确认方案是否可行"升级成"客人已拍板，等你核实空房"——这正是 defer 不再另发 H2 卡
// 之后(见 HotelRepository.ListSelectedPendingOptionsAsync 的过滤)酒店感知客人承诺的唯一通道。
public record InquiryItemDto(
    Guid Id, Guid CaseId, string ConfirmationNo, string GuestNickname, string DisruptionTitle,
    DateOnly CheckIn, DateOnly CheckOut, string RoomTypeName, string Status, DateTimeOffset RequestedAt, TimeSpan WaitTime, bool Overdue,
    bool IsReturningGuest, bool IsHighValueGuest, DateTimeOffset? RespondedAt, string? RejectReason, string? FinalOutcome,
    DateOnly? ProposedNewCheckIn, DateOnly? ProposedNewCheckOut, bool GuestCommitted);

public record ConfirmInquiryRequest(DateOnly? NewCheckIn, DateOnly? NewCheckOut, string? Note);

public record RejectInquiryRequest(string Reason);

public record SelectedOptionItemDto(
    Guid OptionId, Guid CaseId, string ConfirmationNo, string GuestNickname, string OptionType,
    string PayloadJson, DateTimeOffset SelectedSince, string? CustomTitle, List<string> PerkNames,
    bool IsReturningGuest, bool IsHighValueGuest, string Availability, string? UnavailableReason);

public record HotelWorkbenchItemDto(
    string Kind, Guid CaseId, string ConfirmationNo, string GuestNickname, string DisruptionTitle,
    string Status, DateTimeOffset RequestedAt, TimeSpan WaitTime, bool Overdue);

public record HotelProfileDto(Guid Id, string Name, string Address, double Lat, double Lng, List<string> ImageUrls, int PrimaryImageIndex, List<RoomTypeDto> RoomTypes, List<HotelPerkDto> Perks);

public record RoomTypeDto(Guid Id, string Name, string Description, List<string> Amenities, int Capacity, decimal PriceAmount, string Currency, List<string> ImageUrls);

public record UpdateHotelProfileRequest(string Name, string Address, double Lat, double Lng, List<string> ImageUrls, int PrimaryImageIndex);

public record UpsertRoomTypeRequest(string Name, string Description, List<string> Amenities, int Capacity, decimal PriceAmount, string Currency, List<string> ImageUrls);

public record HotelPerkDto(Guid Id, string Name);

public record AddHotelPerkRequest(string Name);

public record SetOptionPerksRequest(List<string> PerkNames);

public record CreateCustomOptionRequest(string Title, List<string> PerkNames);

public record HotelRefundPolicyDto(
    Guid Id, string Content, string? StructuredRulesJson,
    DateTimeOffset? EffectiveFrom, DateTimeOffset? EffectiveUntil,
    bool IsActive, DateTimeOffset UpdatedAt,
    string? SourceFileName, string? SourceFileUrl);

public record UpsertHotelRefundPolicyRequest(
    string Content, string? StructuredRulesJson,
    DateTimeOffset? EffectiveFrom, DateTimeOffset? EffectiveUntil,
    bool IsActive);

public record UploadRefundPolicyFileRequest(
    string? StructuredRulesJson,
    DateTimeOffset? EffectiveFrom, DateTimeOffset? EffectiveUntil);

// 从政策自由文本提取结构化规则的预填请求/响应。响应里政策没提到的字段为 null，
// 前端只回填非 null 字段，其余保持表单现状，绝不拿 AI 的猜测覆盖酒店人员的输入。
// AiUsed=false 表示 LLM 不可用、走了本地正则兜底，前端据此提示"预填可能不完整"。
public record ExtractRefundRulesRequest(string Content);

public record ExtractedRefundRulesDto(
    int? FreeCancellationHours, decimal? CancellationFeePercent,
    decimal? CancellationFeeFixed, string? Currency, bool AiUsed);
