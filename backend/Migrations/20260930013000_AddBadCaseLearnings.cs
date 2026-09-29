using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TravelDisruptionAgent.Api.Infrastructure.Data;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260930013000_AddBadCaseLearnings")]
    public partial class AddBadCaseLearnings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "bad_case_learnings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    message_id = table.Column<Guid>(type: "uuid", nullable: false),
                    evaluator_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    evaluation_note = table.Column<string>(type: "text", nullable: false),
                    draft_markdown = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "text", nullable: false),
                    approved_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    approved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    rag_document_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bad_case_learnings", x => x.id);
                    table.ForeignKey(
                        name: "fk_bad_case_learnings_messages_message_id",
                        column: x => x.message_id,
                        principalTable: "messages",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_bad_case_learnings_users_evaluator_user_id",
                        column: x => x.evaluator_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_bad_case_learnings_rag_documents_rag_document_id",
                        column: x => x.rag_document_id,
                        principalTable: "rag_documents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_bad_case_learnings_message_id",
                table: "bad_case_learnings",
                column: "message_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_bad_case_learnings_evaluator_user_id",
                table: "bad_case_learnings",
                column: "evaluator_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_bad_case_learnings_rag_document_id",
                table: "bad_case_learnings",
                column: "rag_document_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "bad_case_learnings");
        }
    }
}
