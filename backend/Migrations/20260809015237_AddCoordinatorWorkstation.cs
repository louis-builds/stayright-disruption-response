using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCoordinatorWorkstation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "closed_at",
                table: "cases",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "closed_by_user_id",
                table: "cases",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "escalation_reason",
                table: "cases",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "result_summary",
                table: "cases",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "case_assignments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    case_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_coordinator_id = table.Column<Guid>(type: "uuid", nullable: true),
                    to_coordinator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_case_assignments", x => x.id);
                    table.ForeignKey(
                        name: "fk_case_assignments_cases_case_id",
                        column: x => x.case_id,
                        principalTable: "cases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "case_notes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    case_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_case_notes", x => x.id);
                    table.ForeignKey(
                        name: "fk_case_notes_cases_case_id",
                        column: x => x.case_id,
                        principalTable: "cases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_case_notes_users_author_user_id",
                        column: x => x.author_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_case_assignments_case_id",
                table: "case_assignments",
                column: "case_id");

            migrationBuilder.CreateIndex(
                name: "ix_case_notes_author_user_id",
                table: "case_notes",
                column: "author_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_case_notes_case_id",
                table: "case_notes",
                column: "case_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "case_assignments");

            migrationBuilder.DropTable(
                name: "case_notes");

            migrationBuilder.DropColumn(
                name: "closed_at",
                table: "cases");

            migrationBuilder.DropColumn(
                name: "closed_by_user_id",
                table: "cases");

            migrationBuilder.DropColumn(
                name: "escalation_reason",
                table: "cases");

            migrationBuilder.DropColumn(
                name: "result_summary",
                table: "cases");
        }
    }
}
