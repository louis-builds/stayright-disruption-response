namespace TravelDisruptionAgent.Api.Features.Calls;

// ponytail: 没有真实音频可转录，用一批模板句子随机拼一段"转录文本"，保证不同通话内容不同、
// 喂给 Gemini 做总结时不会每次都是同一个结果。真实 Whisper/Speech API 接入后整个类直接删掉换实现。
public class MockAsrProvider : IAsrProvider
{
    private static readonly string[] GuestLines =
    [
        "客人说因为这次中断行程被打乱了，问接下来怎么安排。",
        "客人确认了新的入住日期，但希望酒店能保留原来的房型。",
        "客人情绪比较着急，反复问什么时候能有结果。",
        "客人问退款大概什么时候能到账。",
        "客人对目前提供的备选酒店不太满意，希望换一家离市区更近的。",
    ];

    private static readonly string[] HotelLines =
    [
        "酒店确认了指定日期还有空房，可以直接安排。",
        "酒店表示需要请示经理才能给出最终答复。",
        "酒店同意延长退房时间，不额外收费。",
        "酒店提到这几天房源比较紧张，建议尽快确认。",
        "酒店确认可以保留客人原来的房型不变。",
    ];

    public Task<string> TranscribeAsync(string recordingFileUrl, CancellationToken ct = default)
    {
        var pool = recordingFileUrl.Contains("hotel", StringComparison.OrdinalIgnoreCase) ? HotelLines : GuestLines;
        var pickCount = Random.Shared.Next(2, 4);
        var lines = Enumerable.Range(0, pickCount).Select(_ => pool[Random.Shared.Next(pool.Length)]);
        return Task.FromResult(string.Join(" ", lines));
    }
}
