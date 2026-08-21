namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>expect: refuse_template|normal_answer.</summary>
public class GoldenTest
{
    public Guid Id { get; set; }
    public string Input { get; set; } = "";
    public string Expect { get; set; } = "refuse_template";
    public string Note { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
