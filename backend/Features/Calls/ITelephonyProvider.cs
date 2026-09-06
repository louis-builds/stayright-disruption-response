namespace TravelDisruptionAgent.Api.Features.Calls;

/// <summary>真实电话服务(比如 Twilio Programmable Voice)的抽象——上层(CallService)只管
/// "发起一通呼叫"，具体怎么接通、录音、状态怎么流转由实现决定。换成真实 Twilio 时只需要新写一个
/// TwilioTelephonyProvider 实现这个接口(用 Twilio Webhook 回调驱动状态，而不是像 Mock 那样自己模拟)，
/// 不用改 CallService 或 Controller 一行代码。</summary>
public interface ITelephonyProvider
{
    /// <summary>call 已经以 connecting 状态落库；这里负责把它真正"打出去"，
    /// 并在call结束后驱动它流转到 completed/failed/no_answer，再触发录音写入。
    /// simulateOutcome 只有 Mock 实现会用到。</summary>
    Task InitiateCallAsync(Guid callId, string? simulateOutcome, CancellationToken ct = default);

    /// <summary>协调员主动挂断。已经到终态(completed/failed/no_answer)的呼叫调用这个是无害的空操作。</summary>
    Task EndCallAsync(Guid callId, CancellationToken ct = default);
}
