using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFaqQuestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "faq_processed_through",
                table: "system_settings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "faq_questions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_text = table.Column<string>(type: "text", nullable: false),
                    embedding = table.Column<float[]>(type: "real[]", nullable: false),
                    ask_count = table.Column<int>(type: "integer", nullable: false),
                    last_asked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_faq_questions", x => x.id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "faq_questions");

            migrationBuilder.DropColumn(
                name: "faq_processed_through",
                table: "system_settings");
        }
    }
}
