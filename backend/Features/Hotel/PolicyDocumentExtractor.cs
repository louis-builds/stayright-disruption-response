using DocumentFormat.OpenXml.Packaging;
using UglyToad.PdfPig;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public static class PolicyDocumentExtractor
{
    private const long MaxFileSizeBytes = 10 * 1024 * 1024;

    public static string Extract(Stream stream, string fileName, long length)
    {
        if (length > MaxFileSizeBytes)
            throw new ArgumentException("Policy file must be under 10 MB.");

        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".pdf" => ExtractPdf(stream),
            ".docx" => ExtractDocx(stream),
            ".md" or ".txt" => new StreamReader(stream).ReadToEnd(),
            _ => throw new NotSupportedException($"Unsupported policy file format: {ext}. Use .pdf, .docx, .md or .txt.")
        };
    }

    private static string ExtractPdf(Stream stream)
    {
        using var pdf = PdfDocument.Open(stream);
        return string.Join("\n", pdf.GetPages().Select(p => p.Text));
    }

    private static string ExtractDocx(Stream stream)
    {
        using var doc = WordprocessingDocument.Open(stream, false);
        var body = doc.MainDocumentPart?.Document?.Body;
        return body is null ? "" : string.Join("\n", body.Descendants<DocumentFormat.OpenXml.Wordprocessing.Text>().Select(t => t.Text));
    }
}
