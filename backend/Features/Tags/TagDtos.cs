namespace TravelDisruptionAgent.Api.Features.Tags;

/// <summary>IsReturningGuest 只有调用方是 hotel 角色时才真的算(要跟具体哪家酒店比对)；
/// 协调员视角看不到"是不是我这家的回头客"这个概念，恒为 false。</summary>
public record GuestTagsDto(
    bool IsHighValueGuest,
    bool IsReturningGuest,
    bool EmotionallySensitive,
    bool AiDifficult,
    bool HighRejectionRate,
    bool SlowResponder,
    bool KeepMessagesSimple,
    bool SpeakSlowly,
    string? StayPreference,
    List<CustomTagDto> CustomTags);

public record GuestCommunicationPrefs(bool KeepMessagesSimple, bool SpeakSlowly, string? StayPreference);

public record CustomTagDto(Guid Id, string Label, string OwnerRole);

public record CreateCustomTagRequest(string Label);

/// <summary>批量查多个客人的标签。酒店任务队列一屏几十张卡片，一次 POST 比每卡片一个 GET 省得多。</summary>
public record GuestTagsQueryRequest(List<Guid> GuestUserIds);
