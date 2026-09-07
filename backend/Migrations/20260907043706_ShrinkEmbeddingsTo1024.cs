using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class ShrinkEmbeddingsTo1024 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE rag_document_chunks
                    ALTER COLUMN embedding TYPE vector(1024)
                    USING CASE
                        WHEN embedding IS NULL THEN NULL
                        ELSE ((embedding::real[])[1:1024])::vector(1024)
                    END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE faq_questions
                    ALTER COLUMN embedding TYPE vector(1024)
                    USING ((embedding::real[])[1:1024])::vector(1024);
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS idx_rag_document_chunks_embedding
                    ON rag_document_chunks USING hnsw (embedding vector_cosine_ops);
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS idx_faq_questions_embedding
                    ON faq_questions USING hnsw (embedding vector_cosine_ops);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS idx_rag_document_chunks_embedding;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS idx_faq_questions_embedding;");

            migrationBuilder.Sql("""
                ALTER TABLE rag_document_chunks
                    ALTER COLUMN embedding TYPE vector(3072)
                    USING CASE
                        WHEN embedding IS NULL THEN NULL
                        ELSE (embedding::real[] || array_fill(0::real, ARRAY[2048]))::vector(3072)
                    END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE faq_questions
                    ALTER COLUMN embedding TYPE vector(3072)
                    USING (embedding::real[] || array_fill(0::real, ARRAY[2048]))::vector(3072);
                """);
        }
    }
}
