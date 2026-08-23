using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRagVectorAndGoldenTestRuns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "effective_from",
                table: "rag_documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "effective_until",
                table: "rag_documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source_type",
                table: "rag_documents",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "golden_test_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    trigger_document_name = table.Column<string>(type: "text", nullable: true),
                    trigger_version = table.Column<int>(type: "integer", nullable: true),
                    pass_count = table.Column<int>(type: "integer", nullable: false),
                    fail_count = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_golden_test_runs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "rag_document_chunks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    rag_document_id = table.Column<Guid>(type: "uuid", nullable: false),
                    chunk_index = table.Column<int>(type: "integer", nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    embedding = table.Column<float[]>(type: "real[]", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_rag_document_chunks", x => x.id);
                    table.ForeignKey(
                        name: "fk_rag_document_chunks_rag_documents_rag_document_id",
                        column: x => x.rag_document_id,
                        principalTable: "rag_documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_document_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_name = table.Column<string>(type: "text", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_document_versions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "golden_test_run_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    golden_test_id = table.Column<Guid>(type: "uuid", nullable: false),
                    input = table.Column<string>(type: "text", nullable: false),
                    expect = table.Column<string>(type: "text", nullable: false),
                    actual = table.Column<string>(type: "text", nullable: false),
                    passed = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_golden_test_run_items", x => x.id);
                    table.ForeignKey(
                        name: "fk_golden_test_run_items_golden_test_runs_run_id",
                        column: x => x.run_id,
                        principalTable: "golden_test_runs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_golden_test_run_items_run_id",
                table: "golden_test_run_items",
                column: "run_id");

            migrationBuilder.CreateIndex(
                name: "ix_rag_document_chunks_rag_document_id",
                table: "rag_document_chunks",
                column: "rag_document_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_document_versions_user_id_document_name",
                table: "user_document_versions",
                columns: new[] { "user_id", "document_name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "golden_test_run_items");

            migrationBuilder.DropTable(
                name: "rag_document_chunks");

            migrationBuilder.DropTable(
                name: "user_document_versions");

            migrationBuilder.DropTable(
                name: "golden_test_runs");

            migrationBuilder.DropColumn(
                name: "effective_from",
                table: "rag_documents");

            migrationBuilder.DropColumn(
                name: "effective_until",
                table: "rag_documents");

            migrationBuilder.DropColumn(
                name: "source_type",
                table: "rag_documents");
        }
    }
}
