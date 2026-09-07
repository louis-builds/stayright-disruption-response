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
    List<CustomTagDto> CustomTags);

public record CustomTagDto(Guid Id, string Label, string OwnerRole);

public record CreateCustomTagRequest(string Label);
