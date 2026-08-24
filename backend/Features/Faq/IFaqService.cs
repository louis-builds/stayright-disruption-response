namespace TravelDisruptionAgent.Api.Features.Faq;

public interface IFaqService
{
    Task ProcessNewQuestionsAsync(CancellationToken ct = default);
    Task<List<FaqQuestionDto>> GetTopQuestionsAsync(CancellationToken ct = default);
}
