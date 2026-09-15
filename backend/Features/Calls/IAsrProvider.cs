namespace TravelDisruptionAgent.Api.Features.Calls;

/// <summary>语音转文本的抽象。Mock 阶段用规则生成假文本，真实接入 Whisper/Speech API 时
/// 新写一个实现替换掉 MockAsrProvider 即可，不用改调用方。</summary>
public interface IAsrProvider
{
    Task<string> TranscribeAsync(string recordingFileUrl, CancellationToken ct = default);
}
