using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class UsePgvectorEmbeddings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:vector", ",,");

            // real[] → vector 必须 USING，否则 Postgres 拒绝隐式转换。
            // Gemini embedding-001 是 3072 维，超过 HNSW 索引 2000 维上限，语料量很小，先不建索引。
            migrationBuilder.Sql("""
                ALTER TABLE rag_document_chunks
                    ALTER COLUMN embedding TYPE vector(3072)
                    USING CASE WHEN embedding IS NULL THEN NULL ELSE embedding::vector(3072) END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE faq_questions
                    ALTER COLUMN embedding TYPE vector(3072)
                    USING embedding::vector(3072);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE rag_document_chunks
                    ALTER COLUMN embedding TYPE real[]
                    USING CASE WHEN embedding IS NULL THEN NULL ELSE embedding::real[] END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE faq_questions
                    ALTER COLUMN embedding TYPE real[]
                    USING embedding::real[];
                """);

            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:vector", ",,");
        }
    }
}
